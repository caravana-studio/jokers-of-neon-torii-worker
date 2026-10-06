import { it, expect } from "bun:test";
import { V2TerminalWorker } from "../../src/v2/terminalWorker.js";
it("a broken pack catalog leaves its opening pending while unrelated archived gameplay still applies", async () => {
  const worker = new V2TerminalWorker({
    supabaseUrl: "http://127.0.0.1:55321",
    serviceKey: "test",
    runtimeId: "10000000-0000-0000-0000-000000000001",
    endpointRef: "test",
    worldAddress: "0x1",
    gameSystemAddress: "0x1",
    rpcUrl: "http://127.0.0.1:1",
    toriiUrl: "http://127.0.0.1:1",
  });
  const calls: string[] = [];
  let terminal = true;
  Reflect.set(worker, "db", {
    rpc: async (name: string, args: any) => {
      calls.push(name);
      let data: unknown;
      switch (name) {
        case "pending_commerce_payments":
          throw new Error("COMMERCE_DATABASE_UNAVAILABLE");
        case "pending_free_pack_events":
          data = [];
          break;
        case "pending_pack_openings":
          data = [{ opening_id: "broken" }];
          break;
        case "pack_opening_snapshot":
          data = { definition: {}, seed_hex: "00".repeat(31) };
          break;
        case "pending_terminal_results":
          data = terminal ? [{ event_id: "1" }] : [];
          terminal = false;
          break;
        case "claim_processing_job":
          data = {job_id: "job", lease_token: "token", attempts: 1, target: args.p_target};
          break;
        case "finish_processing_job":
        case "apply_processing_effects":
          data = null;
          break;
        case "next_gameplay_fact":
          data = null;
          break;
        default:
          throw new Error("Unexpected RPC " + name);
      }
      return { data, error: null };
    },
  });
  await expect(worker.replayPending()).rejects.toThrow("INVALID_PACK_CATALOG");
  expect(calls).toContain("apply_processing_effects");
  expect(calls).toContain("next_gameplay_fact");
  expect(calls).not.toContain("resolve_pack_opening");
});
