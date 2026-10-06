import { ProcessingJobs, ProcessingFailure, type Lease } from './processingJobs.js';
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
  private readonly jobs: ProcessingJobs;
  constructor(private readonly config: WorkerConfig) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.runtimeId)
      || BigInt('0x' + config.runtimeId.replaceAll('-', '')) === 0n) throw new Error('INVALID_RUNTIME_ID');
    this.db = createClient(config.supabaseUrl, config.serviceKey, {
      db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false },
    });
    this.provider = new RpcProvider({ nodeUrl: config.rpcUrl });
    this.jobs = new ProcessingJobs((name, args) => this.rpc(name, args));
  }
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async ready(): Promise<void> {
    const { data, error } = await this.db.from('schema_version').select('release_key,protocol_version');
    if (error || !['recoverable-processing-v2', 'greenfield-v2', 'game-lifecycle-v2', 'gameplay-progression-v2', 'mission-schedule-reads-v2', 'free-pack-rewards-v2', 'pack-openings-v2', 'starknet-commerce-v2'].every(key => data?.some(r => r.release_key === key && r.protocol_version === 2)))
      throw new Error('V2_SCHEMA_VERSION_REQUIRED');
    for (const kind of ['gameplay-ingestion', 'gameplay-progression', 'terminal-result', 'free-pack-progression']) await this.jobs.ready(kind);
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
      () => this.replayTerminal(),
      () => this.replayProgression(),
    ]) {
      try { applied += await process(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : 'PROCESSOR_FAILED').join('; '));
    return applied;
  }
  private async replayTerminal(): Promise<number> {
    let applied = 0;
    const errors: unknown[] = [];
    const events = await this.rpc<{ event_id: string }[]>('pending_terminal_results', { p_runtime_id: this.config.runtimeId });
    for (const event of events) {
      try {
        const done = await this.jobs.run('terminal-result', event.event_id, { event_id: event.event_id }, async lease => {
          await this.jobs.apply(lease, 'terminal-result', event, {});
          return { result: true, completed: true };
        });
        if (done) applied++;
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'TERMINAL_PROCESSING_BLOCKED');
    return applied;
  }
  private async replayProgression(): Promise<number> {
    return await this.jobs.run('gameplay-progression', this.config.runtimeId, { runtime_id: this.config.runtimeId }, async lease => {
      let applied = 0;
      let eventId: string | null = null;
      let stage = 'next_fact';
      try {
        // Bounded work per lease. Each effect commit checks its fencing token.
        while (applied < 100) {
          stage = 'next_fact'; eventId = null;
          const next = await this.rpc<{ event_id: string } | null>('next_gameplay_fact', { p_runtime_id: this.config.runtimeId });
          if (!next) break;
          eventId = next.event_id;
          stage = 'prepare_missions';
          await this.rpc('prepare_gameplay_missions', { p_event_id: eventId });
          stage = 'snapshot';
          const snapshot = await this.rpc<Snapshot>('gameplay_progression_snapshot', { p_event_id: eventId });
          stage = 'reduce';
          const effects = reduceProgression(snapshot);
          stage = 'commit';
          await this.jobs.apply(lease, 'gameplay-progression', snapshot, effects);
          applied++;
        }
        return { result: applied, completed: false };
      } catch (error) {
        let stream: unknown = null;
        try { stream = await this.rpc('gameplay_stream_status', { p_runtime_id: this.config.runtimeId }); } catch { /* DB outage */ }
        throw new ProcessingFailure(error instanceof Error ? error.message : 'PROGRESSION_FAILED',
          { runtime_id: this.config.runtimeId, event_id: eventId, stage, stream });
      }
    }) ?? 0;
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
    return await this.jobs.run('gameplay-ingestion', this.config.runtimeId, { runtime_id: this.config.runtimeId }, async lease => {
      try { return { result: await this.archivePage(lease), completed: false }; }
      catch (error) {
        let stream: unknown = null;
        try { stream = await this.rpc('gameplay_stream_status', { p_runtime_id: this.config.runtimeId }); } catch { /* DB outage */ }
        throw new ProcessingFailure(error instanceof Error ? error.message : 'INGESTION_FAILED',
          { runtime_id: this.config.runtimeId, stage: 'ingestion', stream,
            ...(error instanceof ProcessingFailure ? error.context : {}) });
      }
    }) ?? { archived: 0, hasMore: false };
  }
  private async archivePage(lease: Lease): Promise<{ archived: number; hasMore: boolean }> {
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
        try {
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
        } catch (error) {
          throw new ProcessingFailure(error instanceof Error ? error.message : 'INVALID_SOURCE_EVENT',
            { source_cursor: edge.cursor, source_event_id: edge.node.id });
        }
      }
    }
    // No cursor cached in memory: losing the response or a CAS conflict starts from DB on the next poll.
    await this.rpc('ingest_processing_batch', { p_job: lease.job_id, p_token: lease.lease_token, p_expected_revision: state.revision,
      p_cursor: { before: page.edges[page.edges.length - 1].cursor }, p_events: events });
    return { archived: events.length, hasMore: page.pageInfo.hasNextPage };
  }
}
