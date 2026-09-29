import type { OpenedCard } from "../packOpening.js";
export interface NftOperation {
  operation_id: string;
  chain_key: string;
  deployment_id: string;
  collection_id: string;
  contract_address: string;
  abi_hash: string;
  beneficiary: string;
  payload: { protocol: "mint-card-v1"; card: OpenedCard };
  payload_hash: string;
  status: string;
}
export interface Executor {
  executor_id: string;
  chain_key: string;
  address: string;
  signer_ref: string;
  status: string;
  adapter_key: "evm" | "starknet";
  network_id: string;
  confirmation_policy: {
    confirmations: number;
    finality: "finalized" | "ACCEPTED_ON_L1" | "local";
  };
  chain_status: string;
}
export interface SignedMint {
  nonce: string;
  tx_hash: string;
  signed_payload: Record<string, unknown>;
}
export interface NftSubmission extends SignedMint {
  submission_id: string;
  executor_id: string;
  status: string;
  operation: NftOperation;
  confirmed_block: { number: string; hash: string } | null;
}
export interface MintEvidence {
  operation_id: string;
  tx_hash: string;
  contract_address: string;
  recipient: string;
  token_id: string;
  card: OpenedCard;
  block_number: string;
  block_hash: string;
  event_index: number;
}
export type Observation =
  | { kind: "missing" | "pending" | "reverted" }
  | { kind: "confirmed"; evidence: MintEvidence };
export interface NftAdapter {
  ready(executor: Executor): Promise<void>;
  prepare(operation: NftOperation): Promise<SignedMint>;
  broadcast(submission: NftSubmission): Promise<void>;
  observe(submission: NftSubmission): Promise<Observation>;
  canonicalBlock(number: string): Promise<string | null>;
  nonceConsumed(submission: NftSubmission): Promise<boolean>;
}
export function operationId(id: string): bigint {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
    throw new Error("INVALID_OPERATION_ID");
  const n = BigInt("0x" + id.replaceAll("-", ""));
  if (n === 0n) throw new Error("INVALID_OPERATION_ID");
  return n;
}
export const normalizeAddress = (
  adapter: Executor["adapter_key"],
  s: string,
) => {
  if (
    !/^0x[0-9a-f]+$/i.test(s) ||
    BigInt(s) <= 0n ||
    BigInt(s) >= (adapter === "evm" ? 1n << 160n : 1n << 251n)
  )
    throw new Error("INVALID_SETTLEMENT_ADDRESS");
  return (
    "0x" +
    BigInt(s)
      .toString(16)
      .padStart(adapter === "evm" ? 40 : 64, "0")
  );
};
export function validateOperation(o: NftOperation): void {
  operationId(o.operation_id);
  const c = o.payload.card;
  if (
    o.payload.protocol !== "mint-card-v1" ||
    !c ||
    ![
      c.item_id,
      c.item_type,
      c.card_id,
      c.rarity,
      c.skin_id,
      c.skin_rarity,
      c.quality,
    ].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) ||
    c.item_type > 3 ||
    c.rarity > 4 ||
    c.skin_rarity > 4 ||
    c.quality < 1 ||
    c.quality > 10 ||
    typeof c.marketable !== "boolean"
  )
    throw new Error("INVALID_MINT_CARD");
}
export function validatePolicy(e: Executor, rpcUrl: string): void {
  const p = e.confirmation_policy;
  if (
    !p ||
    !Number.isSafeInteger(p.confirmations) ||
    p.confirmations < 1 ||
    p.confirmations > 100000
  )
    throw new Error("CONFIRMATION_POLICY_REQUIRED");
  if (p.finality === "local") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(rpcUrl).hostname))
      throw new Error("LOCAL_FINALITY_REQUIRES_LOOPBACK");
  } else if (
    p.finality !== (e.adapter_key === "evm" ? "finalized" : "ACCEPTED_ON_L1")
  )
    throw new Error("INVALID_FINALITY_POLICY");
}
