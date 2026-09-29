import { test, expect } from "bun:test";
import {
  ingestTerminalResult,
  parseGlobalGameId,
  parseTerminalEvent,
  type HistoricalGame,
} from "../src/durable/terminalResults";
const runtimeId = "00000000-0000-0000-0000-000000000001";
const game: HistoricalGame = {
  runtime_id: runtimeId,
  world_address: "0xabc",
  player_account: "0x123",
  profile_id: "celo-profile",
  context: {
    rules_version: "v1",
    season_id: 4,
    tier: 0,
    is_tournament: false,
    player_name: "Neon",
  },
};
const event = {
  game_id: "9007199254740993",
  runtime_id: "1",
  player: "0x123",
  level: "4",
  round: "3",
  score: "100",
  finished_at: "1780000000",
  is_tournament: false,
};
test("global ID is never converted through Number", () => {
  expect(parseGlobalGameId(event.game_id)).toBe(event.game_id);
  expect(() => parseGlobalGameId(9007199254740992)).toThrow();
});
test("runtime and historical owner checked, regardless of current burner assignment", () => {
  const parsed = parseTerminalEvent(event, runtimeId, game);
  expect(parsed.result.category).toBe("v1:season:4:normal:tier:0");
  expect(() =>
    parseTerminalEvent({ ...event, player: "0x999" }, runtimeId, game),
  ).toThrow("EVENT_PLAYER_MISMATCH");
  expect(() =>
    parseTerminalEvent({ ...event, runtime_id: "2" }, runtimeId, game),
  ).toThrow("EVENT_RUNTIME_MISMATCH");
});
test("archive precedes apply; failed archive cannot be acknowledged", async () => {
  const calls: string[] = [];
  await expect(
    ingestTerminalResult(
      {
        getGame: async () => game,
        archive: async () => {
          calls.push("archive");
          throw new Error("DB unavailable");
        },
        finish: async () => {
          calls.push("finish");
        },
      },
      runtimeId,
      "0xabc",
      event,
    ),
  ).rejects.toThrow("DB unavailable");
  expect(calls).toEqual(["archive"]);
});
test("replay uses complete archived facts without any Katana or burner RPC", async () => {
  const calls: string[] = [];
  await ingestTerminalResult(
    {
      getGame: async () => game,
      archive: async (input) => {
        calls.push("archive");
        expect(input.gameId).toBe(event.game_id);
        return "event-1";
      },
      finish: async (_id, result) => {
        calls.push("finish");
        expect(result.score).toBe("100");
      },
    },
    runtimeId,
    "0xabc",
    event,
  );
  expect(calls).toEqual(["archive", "finish"]);
});

test("pending journal can finish after Katana disappears, using only database payload", async () => {
  const { SupabaseTerminalResultStore } = await import(
    "../src/durable/terminalResults"
  );
  const payload = parseTerminalEvent(event, runtimeId, game).result;
  let pending = true;
  const tables: string[] = [];
  const query: any = {};
  for (const method of ["select", "eq", "like", "is", "order"])
    query[method] = () => query;
  query.limit = async () => ({
    data: pending ? [{ id: "saved-event", payload }] : [],
    error: null,
  });
  const db: any = {
    from(table: string) {
      tables.push(table);
      return query;
    },
    async rpc(name: string, params: any) {
      expect(name).toBe("durable_finish_game");
      expect(params.p_result).toEqual(payload);
      pending = false;
      return { error: null };
    },
  };
  expect(
    await new SupabaseTerminalResultStore(db).replayPending(runtimeId),
  ).toBe(1);
  expect(tables).toEqual(["durable_game_events", "durable_game_events"]);
});
