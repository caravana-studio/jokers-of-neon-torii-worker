import { CommerceWorker } from './commerceWorker.js';
import { PackOpeningWorker } from './packOpeningWorker.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RpcProvider } from 'starknet';
import { parseGlobalGameId, parseTerminalEvent, type HistoricalGame } from '../durable/terminalResults.js';

import { parseGameplayFact } from './gameplayFacts.js';
import { reduceProgression, type Snapshot } from './progression.js';

import { FreePackWorker } from './freePackWorker.js';

const CONSUMER = 'gameplay-facts-v1';
// Torii last/before walks oldest → newest, including events arriving after restart.
const QUERY = `query TerminalEvents($last: Int!, $before: Cursor) {
  eventMessages(last: $last, before: $before) {
    pageInfo { hasNextPage endCursor }
    edges { cursor node { id models {
      __typename
      ... on jokers_of_neon_core_DurableGameFactEvent {
        runtime_id sequence game_id player kind amount subject detail flags occurred_at
      }
      ... on jokers_of_neon_core_DurableGameResultEvent {
        game_id runtime_id player player_name level round score is_tournament finished_at
      }
    } } }
  }
}`;
export interface WorkerConfig {
  supabaseUrl: string; serviceKey: string; runtimeId: string; endpointRef: string;
  worldAddress: string; gameSystemAddress: string; rpcUrl: string; toriiUrl: string;
}
interface State {
  runtime_id: string; world_address: string; endpoint_ref: string; status: string;
  ingress_closed_at: string | null; cursor: { before?: string; after?: string }; revision: string;
}
interface Edge { cursor: string; node: { id: string; models: Record<string, unknown>[] } }
/** Polling is the durable source: events and cursor commit together, replay needs only DB. */
export class V2TerminalWorker {
  private readonly db: SupabaseClient<any, 'api'>;
  private readonly provider: RpcProvider;
  constructor(private readonly config: WorkerConfig) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.runtimeId)
      || BigInt('0x' + config.runtimeId.replaceAll('-', '')) === 0n) throw new Error('INVALID_RUNTIME_ID');
    this.db = createClient(config.supabaseUrl, config.serviceKey, {
      db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false },
    });
    this.provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  }
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async ready(): Promise<void> {
    const { data, error } = await this.db.from('schema_version').select('release_key,protocol_version');
    if (error || !['greenfield-v2', 'game-lifecycle-v2', 'gameplay-progression-v2', 'mission-schedule-reads-v2', 'free-pack-rewards-v2', 'pack-openings-v2', 'starknet-commerce-v2'].every(key => data?.some(r => r.release_key === key && r.protocol_version === 2)))
      throw new Error('V2_SCHEMA_VERSION_REQUIRED');
  }
  async replayPending(): Promise<number> {
    let applied = 0;
    const errors: unknown[] = [];
    // A failed reward processor must not block unrelated archived gameplay.
    // Keep profile updates sequential to avoid unnecessary snapshot conflicts.
    for (const process of [
      () => new CommerceWorker(this.db).replayPending(),
      () => new FreePackWorker(this.db).replayPending(),
      () => new PackOpeningWorker(this.db).replayPending(),
      () => this.replayGameplay(),
    ]) {
      try { applied += await process(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : 'PROCESSOR_FAILED').join('; '));
    return applied;
  }
  private async replayGameplay(): Promise<number> {
    let applied = 0;
    while (true) {
      const events = await this.rpc<{ event_id: string }[]>('pending_terminal_results', { p_runtime_id: this.config.runtimeId });
      if (!events.length) break;
      for (const event of events) {
        await this.rpc('apply_terminal_result', { p_event_id: event.event_id });
        applied++;
      }
    }
    return applied + await this.replayProgression();
  }
  private async replayProgression(): Promise<number> {
    let applied = 0;
    while (true) {
      const next = await this.rpc<{ event_id: string } | null>('next_gameplay_fact', { p_runtime_id: this.config.runtimeId });
      if (!next) return applied;
      await this.rpc('prepare_gameplay_missions', { p_event_id: next.event_id });
      const snapshot = await this.rpc<Snapshot>('gameplay_progression_snapshot', { p_event_id: next.event_id });
      await this.rpc('apply_gameplay_progression', { p_snapshot: snapshot, p_effects: reduceProgression(snapshot) });
      applied++;
    }
  }
  async pollOnce(): Promise<{ archived: number; applied: number; hasMore: boolean }> {
    let batch = { archived: 0, hasMore: false };
    let archiveError: unknown;
    try { batch = await this.archiveNextPage(); } catch (error) { archiveError = error; }
    // An unavailable runtime must never prevent applying already archived facts.
    const applied = await this.replayPending();
    if (archiveError) throw archiveError;
    return { ...batch, applied };
  }
  /** Separate durable boundary: a crash here leaves archived facts available to replay. */
  async archiveNextPage(): Promise<{ archived: number; hasMore: boolean }> {
    const state = await this.rpc<State>('runtime_ingestion_state', {
      p_runtime_id: this.config.runtimeId, p_consumer_key: CONSUMER,
    });
    if (!state || state.endpoint_ref !== this.config.endpointRef
      || BigInt(state.world_address) !== BigInt(this.config.worldAddress)) throw new Error('WORKER_RUNTIME_MISMATCH');
    if (state.status === 'retired' || state.ingress_closed_at) return { archived: 0, hasMore: false };
    if (!['active', 'closing'].includes(state.status)) throw new Error('RUNTIME_NOT_READY');
    const configured = await this.provider.callContract({ contractAddress: this.config.gameSystemAddress,
      entrypoint: 'get_durable_runtime', calldata: [] });
    if (BigInt(configured[0]) !== BigInt('0x' + this.config.runtimeId.replaceAll('-', ''))) throw new Error('RUNTIME_REPLACED');
    const response = await fetch(this.config.toriiUrl.replace(/\/$/, '') + '/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { last: 100, before: state.cursor.before ?? state.cursor.after ?? null } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('TORII_HTTP_ERROR');
    const body = await response.json() as { errors?: unknown; data?: { eventMessages: {
      edges: Edge[]; pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } } };
    if (body.errors || !body.data?.eventMessages) throw new Error('TORII_QUERY_ERROR');
    const page = body.data.eventMessages;
    if (!page.edges.length) return { archived: 0, hasMore: false };
    const events: unknown[] = [];
    for (const edge of page.edges) {
      if (typeof edge.cursor !== 'string' || !edge.cursor) throw new Error('TORII_CURSOR_REQUIRED');
      for (const raw of edge.node.models) {
        if (!['jokers_of_neon_core_DurableGameResultEvent', 'jokers_of_neon_core_DurableGameFactEvent'].includes(String(raw.__typename))) continue;
        const gameId = parseGlobalGameId(raw.game_id);
        const game = await this.rpc<HistoricalGame & { chain_key: string }>('game_receipt', { p_game_id: gameId });
        if (!game || BigInt(game.world_address) !== BigInt(state.world_address)) throw new Error('EVENT_WORLD_MISMATCH');
        if (raw.__typename === 'jokers_of_neon_core_DurableGameFactEvent') {
          const parsed = parseGameplayFact(raw, this.config.runtimeId, game);
          events.push({ source_key: 'fact:' + parsed.fact.sequence, kind: 'game.fact', schema_version: 1,
            profile_id: game.profile_id, chain_key: game.chain_key, game_id: gameId,
            payload: parsed.fact, occurred_at: parsed.occurredAt });
          continue;
        }
        const parsed = parseTerminalEvent(raw, this.config.runtimeId, game);
        events.push({ source_key: 'terminal:' + gameId, kind: 'game.terminal', schema_version: 1,
          profile_id: game.profile_id, chain_key: game.chain_key, game_id: gameId,
          payload: parsed.result, occurred_at: parsed.occurredAt });
      }
    }
    // No cursor cached in memory: losing the response or a CAS conflict starts from DB on the next poll.
    await this.rpc('ingest_runtime_batch', { p_runtime_id: this.config.runtimeId,
      p_consumer_key: CONSUMER, p_expected_revision: state.revision,
      p_cursor: { before: page.edges[page.edges.length - 1].cursor }, p_events: events });
    return { archived: events.length, hasMore: page.pageInfo.hasNextPage };
  }
}
