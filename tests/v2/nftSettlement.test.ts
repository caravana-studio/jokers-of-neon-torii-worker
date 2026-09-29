import { it, expect, mock } from "bun:test";
import { NftSettlementWorker } from "../../src/v2/settlement/worker.js";
import {
  validatePolicy,
  validateOperation,
  operationId,
  type NftAdapter,
  type NftSubmission,
  type Executor,
  type NftOperation,
} from "../../src/v2/settlement/types.js";
const id = "10000000-0000-0000-0000-000000000001";
const e: Executor = {
  executor_id: id,
  chain_key: "local:evm",
  adapter_key: "evm",
  network_id: "31337",
  address: "0x" + "01".repeat(20),
  status: "ready",
  chain_status: "enabled",
  signer_ref: "test",
  confirmation_policy: { confirmations: 1, finality: "local" },
};
const op: NftOperation = {
  operation_id: id,
  chain_key: e.chain_key,
  collection_id: id,
  deployment_id: id,
  contract_address: "0x" + "02".repeat(20),
  beneficiary: e.address,
  payload_hash: "ab".repeat(32),
  abi_hash: "ab".repeat(32),
  status: "pending",
  payload: {
    protocol: "mint-card-v1",
    card: {
      item_id: 1,
      item_type: 1,
      card_id: 101,
      rarity: 1,
      skin_id: 0,
      skin_rarity: 0,
      quality: 7,
      marketable: false,
    },
  },
};
const submission: NftSubmission = {
  submission_id: id,
  executor_id: id,
  status: "prepared",
  nonce: "0",
  tx_hash: "0x123",
  signed_payload: { raw: "frozen" },
  confirmed_block: null,
  operation: op,
};
function fixture(
  pending: NftSubmission[] = [],
  next: NftOperation | null = null,
) {
  const calls: string[] = [];
  let failPrepare = false;
  const executor = { ...e };
  const db = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "prepare_nft_submission" && failPrepare)
        return { data: null, error: { message: "DB_UNAVAILABLE" } };
      return {
        data:
          name === "nft_executor"
            ? executor
            : name === "pending_nft_submissions"
              ? pending
              : name === "next_nft_operation"
                ? next
                : null,
        error: null,
      };
    },
  };
  const adapter: NftAdapter = {
    ready: mock(async () => {}),
    prepare: mock(async () => ({
      nonce: submission.nonce,
      tx_hash: submission.tx_hash,
      signed_payload: submission.signed_payload,
    })),
    broadcast: mock(async () => {}),
    observe: mock(async () => ({ kind: "missing" })),
    canonicalBlock: mock(async () => null),
    nonceConsumed: mock(async () => false),
  };
  return {
    worker: new NftSettlementWorker(db as any, id, adapter),
    adapter,
    calls,
    executor,
    fail: () => {
      failPrepare = true;
    },
  };
}
it("persists a signed transaction before a later poll can send; a failed commit never broadcasts", async () => {
  const f = fixture([], op);
  f.fail();
  await expect(f.worker.pollOnce()).rejects.toThrow("DB_UNAVAILABLE");
  expect(f.adapter.broadcast).not.toHaveBeenCalled();
  expect(f.calls).toContain("prepare_nft_submission");
});
it("an unavailable canonical block RPC never invents a reorg", async () => {
  const f = fixture([
    {
      ...submission,
      status: "confirmed",
      confirmed_block: { number: "10", hash: "0xabc" },
    },
  ]);
  f.adapter.canonicalBlock = mock(async () => {
    throw new Error("RPC_OFFLINE");
  });
  expect((await f.worker.pollOnce()).errors).toBe(1);
  expect(f.calls).not.toContain("orphan_nft_submission");
  expect(f.calls).not.toContain("quarantine_nft_submission");
  expect(f.adapter.broadcast).not.toHaveBeenCalled();
});
it("pending finality, a reverted receipt and a consumed unknown nonce never confirm or create another mint", async () => {
  for (const kind of ["pending", "reverted", "missing"] as const) {
    const f = fixture([submission]);
    f.adapter.observe = mock(async () => ({ kind }));
    f.adapter.nonceConsumed = mock(async () => true);
    await f.worker.pollOnce();
    expect(f.calls).not.toContain("confirm_nft_submission");
    expect(f.adapter.broadcast).not.toHaveBeenCalled();
    expect(f.adapter.prepare).not.toHaveBeenCalled();
    expect(f.calls.includes("quarantine_nft_submission")).toBe(
      kind !== "pending",
    );
  }
});
it("disabled executors observe but never broadcast existing signed transactions", async () => {
  const f = fixture([submission]);
  f.executor.status = "disabled";
  await f.worker.pollOnce();
  expect(f.adapter.observe).toHaveBeenCalledTimes(1);
  expect(f.adapter.broadcast).not.toHaveBeenCalled();
});
it("a canonical event mismatch is quarantined instead of shown as confirmed", async () => {
  const f = fixture([submission]);
  f.adapter.observe = mock(async () => {
    throw new Error("MINT_EVENT_MISMATCH");
  });
  await f.worker.pollOnce();
  expect(f.calls).toContain("quarantine_nft_submission");
  expect(f.calls).not.toContain("confirm_nft_submission");
});
it("requires explicit finality, forbids local shortcuts on public RPCs and keeps full operation IDs", () => {
  expect(operationId("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(
    (1n << 128n) - 1n,
  );
  expect(() => validatePolicy(e, "https://rpc.example.invalid")).toThrow(
    "LOCAL_FINALITY_REQUIRES_LOOPBACK",
  );
  expect(() =>
    validatePolicy(
      {
        ...e,
        confirmation_policy: { confirmations: 0, finality: "finalized" },
      },
      "https://rpc.example.invalid",
    ),
  ).toThrow("CONFIRMATION_POLICY_REQUIRED");
  validatePolicy(
    { ...e, confirmation_policy: { confirmations: 1, finality: "finalized" } },
    "https://rpc.example.invalid",
  );
  expect(() =>
    validateOperation({
      ...op,
      payload: { ...op.payload, card: { ...op.payload.card, quality: 11 } },
    }),
  ).toThrow("INVALID_MINT_CARD");
});
