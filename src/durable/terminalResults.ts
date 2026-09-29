import type { SupabaseClient } from "@supabase/supabase-js";

function unsigned(value: unknown, max: bigint): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("UNSAFE_INTEGER");
  if (
    !["string", "bigint", "number"].includes(typeof value) ||
    !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(String(value))
  )
    throw new Error("INVALID_INTEGER");
  const n = BigInt(String(value));
  if (n < 0n || n > max) throw new Error("INTEGER_OUT_OF_RANGE");
  return n.toString();
}
export function parseGlobalGameId(value: unknown): string {
  const id = unsigned(value, 9223372036854775807n);
  if (id === "0") throw new Error("INVALID_GAME_ID");
  return id;
}
export interface HistoricalGame {
  runtime_id: string;
  world_address: string;
  player_account: string;
  profile_id: string;
  context: {
    rules_version: string;
    season_id: number;
    tier: number;
    is_tournament: boolean;
    player_name: string;
  };
}
export interface TerminalResult {
  schema_version: 1;
  category: string;
  level: number;
  round: number;
  score: string;
  player_name: string;
  is_tournament: boolean;
}
export function parseTerminalEvent(
  raw: Record<string, unknown>,
  runtimeId: string,
  game: HistoricalGame,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      runtimeId,
    )
  )
    throw new Error("INVALID_RUNTIME_ID");
  const expectedRuntime = BigInt(`0x${runtimeId.replace(/-/g, "")}`);
  if (
    expectedRuntime === 0n ||
    game.runtime_id !== runtimeId ||
    BigInt(unsigned(raw.runtime_id, (1n << 128n) - 1n)) !== expectedRuntime
  )
    throw new Error("EVENT_RUNTIME_MISMATCH");
  if (
    BigInt(unsigned(raw.player, (1n << 251n) - 1n)) !==
    BigInt(game.player_account)
  )
    throw new Error("EVENT_PLAYER_MISMATCH");
  const isTournament =
    raw.is_tournament === true ||
    raw.is_tournament === "true" ||
    raw.is_tournament === 1 ||
    raw.is_tournament === "1";
  const isNormal =
    raw.is_tournament === false ||
    raw.is_tournament === "false" ||
    raw.is_tournament === 0 ||
    raw.is_tournament === "0";
  if (
    (!isTournament && !isNormal) ||
    isTournament !== game.context.is_tournament
  )
    throw new Error("EVENT_MODE_MISMATCH");
  const gameId = parseGlobalGameId(raw.game_id);
  const timestamp = Number(unsigned(raw.finished_at, 253402300799n));
  if (timestamp === 0) throw new Error("MISSING_SOURCE_TIMESTAMP");
  const result: TerminalResult = {
    schema_version: 1,
    category: `${game.context.rules_version}:season:${game.context.season_id}:${isTournament ? "tournament" : "normal"}:tier:${game.context.tier}`,
    level: Number(unsigned(raw.level, 2147483647n)),
    round: Number(unsigned(raw.round, 2147483647n)),
    score: unsigned(raw.score, 9223372036854775807n),
    player_name: game.context.player_name,
    is_tournament: isTournament,
  };
  return {
    gameId,
    occurredAt: new Date(timestamp * 1000).toISOString(),
    result,
  };
}
export interface TerminalResultStore {
  getGame(gameId: string): Promise<HistoricalGame>;
  archive(input: {
    runtimeId: string;
    worldAddress: string;
    gameId: string;
    occurredAt: string;
    payload: TerminalResult;
  }): Promise<string>;
  finish(eventId: string, result: TerminalResult): Promise<void>;
}
/** The caller advances its checkpoint only after this resolves. A failure after archive
 * is safe to retry: archive and finish both use durable conflict-checked identities. */
export async function ingestTerminalResult(
  store: TerminalResultStore,
  runtimeId: string,
  worldAddress: string,
  raw: Record<string, unknown>,
) {
  const id = parseGlobalGameId(raw.game_id);
  const game = await store.getGame(id);
  if (BigInt(game.world_address) !== BigInt(worldAddress))
    throw new Error("EVENT_WORLD_MISMATCH");
  const parsed = parseTerminalEvent(raw, runtimeId, game);
  const eventId = await store.archive({
    runtimeId,
    worldAddress: game.world_address,
    gameId: id,
    occurredAt: parsed.occurredAt,
    payload: parsed.result,
  });
  await store.finish(eventId, parsed.result);
}
export class SupabaseTerminalResultStore implements TerminalResultStore {
  constructor(private readonly db: SupabaseClient) {}
  async getGame(id: string): Promise<HistoricalGame> {
    const { data, error } = await this.db
      .from("durable_games")
      .select("runtime_id,world_address,player_account,profile_id,context")
      .eq("game_id", id)
      .single();
    if (error || !data)
      throw new Error(`DURABLE_GAME_NOT_FOUND: ${error?.message}`);
    return data as HistoricalGame;
  }
  async archive(input: {
    runtimeId: string;
    worldAddress: string;
    gameId: string;
    occurredAt: string;
    payload: TerminalResult;
  }): Promise<string> {
    const { data, error } = await this.db.rpc("durable_record_game_event", {
      p_runtime_id: input.runtimeId,
      p_world_address: input.worldAddress,
      p_game_id: input.gameId,
      p_event_key: `terminal:${input.gameId}`,
      p_occurred_at: input.occurredAt,
      p_payload: input.payload,
    });
    if (error || typeof data !== "string")
      throw new Error(`DURABLE_ARCHIVE_FAILED: ${error?.message}`);
    return data;
  }
  async replayPending(runtimeId: string): Promise<number> {
    let processed = 0;
    while (true) {
      const { data, error } = await this.db
        .from("durable_game_events")
        .select("id,payload")
        .eq("runtime_id", runtimeId)
        .like("event_key", "terminal:%")
        .is("applied_at", null)
        .order("received_at")
        .order("id")
        .limit(100);
      if (error) throw new Error(`DURABLE_REPLAY_FAILED: ${error.message}`);
      if (!data?.length) return processed;
      for (const event of data) {
        await this.finish(event.id, event.payload as TerminalResult);
        processed++;
      }
    }
  }
  async finish(eventId: string, result: TerminalResult): Promise<void> {
    if (result.schema_version !== 1)
      throw new Error("UNSUPPORTED_RESULT_VERSION");
    const { error } = await this.db.rpc("durable_finish_game", {
      p_event_id: eventId,
      p_result: result,
      p_operations: [],
    });
    if (error) throw new Error(`DURABLE_FINISH_FAILED: ${error.message}`);
  }
}
