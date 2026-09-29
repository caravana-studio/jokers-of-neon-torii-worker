import {
  Account,
  RpcProvider,
  hash,
  ETransactionVersion,
  shortString,
  stark,
} from "starknet";
import {
  operationId,
  normalizeAddress,
  validateOperation,
  validatePolicy,
  type Executor,
  type NftOperation,
  type NftSubmission,
  type NftAdapter,
  type Observation,
  type SignedMint,
} from "./types.js";
const hex = (n: unknown) => "0x" + BigInt(n as string).toString(16);
const jsonSafe = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? hex(x) : x)));
export function starkCardFields(o: NftOperation): string[] {
  const c = o.payload.card;
  return [
    c.item_id,
    c.item_type,
    c.card_id,
    c.rarity,
    c.skin_id,
    c.skin_rarity,
    c.quality,
    c.marketable ? 1 : 0,
  ].map(String);
}
export const starkMintHash = (o: NftOperation) =>
  hash.computePoseidonHashOnElements([
    shortString.encodeShortString("mint-card-v1"),
    o.beneficiary,
    "1",
    ...starkCardFields(o),
  ]);
class RpcError extends Error {
  constructor(readonly code: number) {
    super("STARKNET_RPC_" + code);
  }
}
export class StarknetNftAdapter implements NftAdapter {
  private readonly provider: RpcProvider;
  private readonly account: Account;
  private executor?: Executor;
  private chainId?: Awaited<ReturnType<RpcProvider["getChainId"]>>;
  constructor(
    private readonly rpcUrl: string,
    address: string,
    privateKey: string,
  ) {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
    this.account = new Account({
      provider: this.provider,
      address,
      signer: privateKey,
      cairoVersion: "1",
    });
  }
  async ready(e: Executor) {
    validatePolicy(e, this.rpcUrl);
    this.chainId = await this.provider.getChainId();
    if (
      e.adapter_key !== "starknet" ||
      normalizeAddress("starknet", e.address) !==
        normalizeAddress("starknet", this.account.address) ||
      BigInt(e.network_id) !== BigInt(this.chainId)
    )
      throw new Error("SETTLEMENT_EXECUTOR_MISMATCH");
    this.executor = e;
  }
  private async rpc(method: string, params: unknown): Promise<any> {
    const r = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("STARKNET_RPC_HTTP");
    const v = (await r.json()) as any;
    if (v.error) throw new RpcError(v.error.code);
    return v.result;
  }
  private transactionHash(t: any): string {
    return hash.calculateInvokeTransactionHash({
      senderAddress: t.sender_address,
      compiledCalldata: t.calldata,
      version: ETransactionVersion.V3,
      chainId: this.chainId!,
      nonce: t.nonce,
      resourceBounds: Object.fromEntries(
        Object.entries(t.resource_bounds).map(([key, value]) => [
          key,
          {
            max_amount: BigInt((value as any).max_amount),
            max_price_per_unit: BigInt((value as any).max_price_per_unit),
          },
        ]),
      ) as any,
      tip: BigInt(t.tip),
      paymasterData: t.paymaster_data,
      accountDeploymentData: t.account_deployment_data,
      nonceDataAvailabilityMode: 0,
      feeDataAvailabilityMode: 0,
    });
  }
  async prepare(o: NftOperation): Promise<SignedMint> {
    if (!this.executor || o.chain_key !== this.executor.chain_key)
      throw new Error("SETTLEMENT_NOT_READY");
    validateOperation(o);
    const call = {
      contractAddress: o.contract_address,
      entrypoint: "mint_reward",
      calldata: [
        operationId(o.operation_id).toString(),
        o.beneficiary,
        "1",
        ...starkCardFields(o),
      ],
    };
    const nonce = await this.account.getNonce("latest");
    const fee = await this.account.estimateInvokeFee(call, { nonce, tip: 0n });
    const [inv] = await this.account.accountInvocationsFactory(
      [{ type: "INVOKE", payload: [call] }],
      {
        nonce,
        tip: 0n,
        versions: [ETransactionVersion.V3],
        resourceBounds: fee.resourceBounds,
        nonceDataAvailabilityMode: "L1",
        feeDataAvailabilityMode: "L1",
        paymasterData: [],
        accountDeploymentData: [],
        skipValidate: false,
      },
    );
    const transaction = jsonSafe({
      type: "INVOKE",
      sender_address: this.account.address,
      version: "0x3",
      calldata: (inv.calldata as string[]).map(hex),
      signature: stark.signatureToHexArray(inv.signature!),
      nonce: hex(nonce),
      resource_bounds: inv.resourceBounds,
      tip: "0x0",
      paymaster_data: [],
      account_deployment_data: [],
      nonce_data_availability_mode: "L1",
      fee_data_availability_mode: "L1",
    });
    return {
      nonce: BigInt(nonce).toString(),
      tx_hash: hex(this.transactionHash(transaction)),
      signed_payload: { adapter: "starknet", transaction },
    };
  }
  async broadcast(s: NftSubmission) {
    const t = s.signed_payload.transaction as any;
    if (
      s.signed_payload.adapter !== "starknet" ||
      hex(this.transactionHash(t)) !== s.tx_hash
    )
      throw new Error("SIGNED_PAYLOAD_MISMATCH");
    const result = await this.rpc("starknet_addInvokeTransaction", {
      invoke_transaction: t,
    });
    if (hex(result.transaction_hash) !== s.tx_hash)
      throw new Error("TRANSACTION_HASH_MISMATCH");
  }
  async canonicalBlock(number: string) {
    if (!Number.isSafeInteger(Number(number)))
      throw new Error("INVALID_BLOCK_NUMBER");
    let b;
    try {
      b = await this.rpc("starknet_getBlockWithTxHashes", {
        block_id: { block_number: Number(number) },
      });
    } catch (e) {
      if (e instanceof RpcError && e.code === 24) {
        if ((await this.provider.getBlockNumber()) < Number(number))
          return null;
        throw new Error("CANONICAL_HISTORY_UNAVAILABLE");
      }
      throw e;
    }
    if (!b.block_hash) throw new Error("CANONICAL_BLOCK_REQUIRED");
    return hex(b.block_hash);
  }
  async nonceConsumed(s: NftSubmission) {
    return BigInt(await this.account.getNonce("latest")) > BigInt(s.nonce);
  }
  async observe(s: NftSubmission): Promise<Observation> {
    let receipt;
    try {
      receipt = await this.rpc("starknet_getTransactionReceipt", {
        transaction_hash: s.tx_hash,
      });
    } catch (e) {
      if (e instanceof RpcError && e.code === 29) return { kind: "missing" };
      throw e;
    }
    if (!receipt.block_hash || !Number.isSafeInteger(receipt.block_number))
      return { kind: "pending" };
    const p = this.executor!.confirmation_policy;
    if (p.finality !== "local" && receipt.finality_status !== "ACCEPTED_ON_L1")
      return { kind: "pending" };
    if (
      p.finality === "local" &&
      !["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"].includes(receipt.finality_status)
    )
      return { kind: "pending" };
    const head = await this.provider.getBlockNumber();
    if (head - receipt.block_number + 1 < p.confirmations)
      return { kind: "pending" };
    if (
      (await this.canonicalBlock(String(receipt.block_number))) !==
      hex(receipt.block_hash)
    )
      return { kind: "pending" };
    if (receipt.execution_status === "REVERTED") return { kind: "reverted" };
    if (receipt.execution_status !== "SUCCEEDED")
      throw new Error("INVALID_EXECUTION_STATUS");
    const o = s.operation;
    const events = (receipt.events as any[])
      .map((event, index) => ({ event, index }))
      .filter(
        (x) =>
          normalizeAddress("starknet", x.event.from_address) ===
          o.contract_address,
      );
    const matches = events.filter(
      ({ event: e }) =>
        e.keys.length === 3 &&
        BigInt(e.keys[0]) ===
          BigInt(hash.getSelectorFromName("RewardMinted")) &&
        BigInt(e.keys[1]) === operationId(o.operation_id),
    );
    if (matches.length !== 1) throw new Error("MINT_EVENT_MISMATCH");
    const { event, index } = matches[0];
    if (
      event.data.length !== 4 ||
      normalizeAddress("starknet", event.keys[2]) !== o.beneficiary ||
      BigInt(event.data[2]) !== 1n ||
      BigInt(event.data[3]) !== BigInt(starkMintHash(o))
    )
      throw new Error("MINT_EVENT_MISMATCH");
    const token = BigInt(event.data[0]) + (BigInt(event.data[1]) << 128n);
    if (
      !events.some(
        ({ event: e }) =>
          e.keys.length === 5 &&
          BigInt(e.keys[0]) === BigInt(hash.getSelectorFromName("Transfer")) &&
          BigInt(e.keys[1]) === 0n &&
          BigInt(e.keys[2]) === BigInt(o.beneficiary) &&
          BigInt(e.keys[3]) + (BigInt(e.keys[4]) << 128n) === token,
      )
    )
      throw new Error("MINT_TRANSFER_MISMATCH");
    const saved = await this.provider.callContract(
      {
        contractAddress: o.contract_address,
        entrypoint: "get_mint_receipt",
        calldata: [operationId(o.operation_id).toString()],
      },
      receipt.block_hash,
    );
    if (
      saved.length !== 4 ||
      BigInt(saved[0]) !== BigInt(starkMintHash(o)) ||
      BigInt(saved[1]) + (BigInt(saved[2]) << 128n) !== token ||
      BigInt(saved[3]) !== 1n
    )
      throw new Error("MINT_RECEIPT_MISMATCH");
    return {
      kind: "confirmed",
      evidence: {
        operation_id: o.operation_id,
        tx_hash: s.tx_hash,
        contract_address: o.contract_address,
        recipient: o.beneficiary,
        token_id: token.toString(),
        card: o.payload.card,
        block_number: String(receipt.block_number),
        block_hash: hex(receipt.block_hash),
        event_index: index,
      },
    };
  }
}
