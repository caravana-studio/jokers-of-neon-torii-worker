import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  keccak256,
  toHex,
  decodeEventLog,
  encodeFunctionData,
  parseTransaction,
  recoverTransactionAddress,
  TransactionReceiptNotFoundError,
  BlockNotFoundError,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
import {
  solidityCardsAbi,
  solidityMintData,
  validateEvmNftProtocol,
  type EvmNftProtocol,
} from "./solidityCards.js";
export const cardsAbi = parseAbi([
  "function mintReward(bytes32 operationId, address recipient, (uint32 cardId,uint32 rarity,uint32 skinId,uint32 skinRarity,uint32 quality,bool marketable)[] reward) returns (uint256)",
  "function mintReceipts(bytes32) view returns (bytes32 payloadHash,uint256 firstTokenId,uint32 count)",
  "event RewardMinted(bytes32 indexed operationId,address indexed recipient,uint256 firstTokenId,uint32 count)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);
export const evmCard = (o: NftOperation) => {
  const c = o.payload.card;
  return {
    cardId: c.card_id,
    rarity: c.rarity,
    skinId: c.skin_id,
    skinRarity: c.skin_rarity,
    quality: c.quality,
    marketable: c.marketable,
  };
};
export const evmMintHash = (o: NftOperation) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        {
          type: "tuple[]",
          components: [
            { name: "cardId", type: "uint32" },
            { name: "rarity", type: "uint32" },
            { name: "skinId", type: "uint32" },
            { name: "skinRarity", type: "uint32" },
            { name: "quality", type: "uint32" },
            { name: "marketable", type: "bool" },
          ],
        },
      ],
      [o.beneficiary as Hex, [evmCard(o)]],
    ),
  );
export class EvmNftAdapter implements NftAdapter {
  private readonly account;
  private readonly client;
  private readonly wallet;
  private executor?: Executor;
  constructor(
    private readonly rpcUrl: string,
    privateKey: Hex,
    private readonly nftProtocol: EvmNftProtocol = "mint-reward-v1",
  ) {
    validateEvmNftProtocol(nftProtocol);
    this.account = privateKeyToAccount(privateKey);
    const transport = http(rpcUrl, { timeout: 15000, retryCount: 0 });
    this.client = createPublicClient({ transport });
    this.wallet = createWalletClient({ account: this.account, transport });
  }
  async ready(e: Executor) {
    validatePolicy(e, this.rpcUrl);
    if (
      e.adapter_key !== "evm" ||
      normalizeAddress("evm", e.address) !==
        this.account.address.toLowerCase() ||
      BigInt(e.network_id) !== BigInt(await this.client.getChainId())
    )
      throw new Error("SETTLEMENT_EXECUTOR_MISMATCH");
    this.executor = e;
  }
  async prepare(o: NftOperation): Promise<SignedMint> {
    if (!this.executor || o.chain_key !== this.executor.chain_key)
      throw new Error("SETTLEMENT_NOT_READY");
    validateOperation(o);
    const request = await this.wallet.prepareTransactionRequest({
      account: this.account,
      to: o.contract_address as Hex,
      data: this.mintData(o),
      chain: null,
    });
    const raw = await this.wallet.signTransaction({ ...request, chain: null });
    return {
      nonce: String(request.nonce),
      tx_hash: keccak256(raw),
      signed_payload: { adapter: "evm", nftProtocol: this.nftProtocol, operationId: o.operation_id, raw },
    };
  }
  private mintData(o: NftOperation): Hex {
    return this.nftProtocol === "mint-cards-v1"
      ? solidityMintData(o)
      : encodeFunctionData({
          abi: cardsAbi,
          functionName: "mintReward",
          args: [toHex(operationId(o.operation_id), { size: 32 }), o.beneficiary as Hex, [evmCard(o)]],
        });
  }
  /** Bind immutable bytes to the operation before either sending or accepting evidence. */
  private async signedTransaction(s: NftSubmission): Promise<Hex> {
    if (!this.executor) throw new Error("SETTLEMENT_NOT_READY");
    try {
      validateOperation(s.operation);
      const raw = s.signed_payload.raw as TransactionSerialized;
      const tx = parseTransaction(raw);
      if (
        s.signed_payload.adapter !== "evm" ||
        (s.signed_payload.nftProtocol ?? "mint-reward-v1") !== this.nftProtocol ||
        (this.nftProtocol === "mint-cards-v1" && s.signed_payload.operationId !== s.operation.operation_id) ||
        keccak256(raw) !== s.tx_hash ||
        s.executor_id !== this.executor.executor_id ||
        s.operation.chain_key !== this.executor.chain_key ||
        BigInt(tx.chainId ?? 0) !== BigInt(this.executor.network_id) ||
        BigInt(tx.nonce ?? -1) !== BigInt(s.nonce) ||
        (tx.value ?? 0n) !== 0n ||
        normalizeAddress("evm", tx.to ?? "") !== normalizeAddress("evm", s.operation.contract_address) ||
        tx.data !== this.mintData(s.operation) ||
        (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() !== this.account.address.toLowerCase()
      ) throw new Error("SIGNED_PAYLOAD_MISMATCH");
      return raw;
    } catch {
      throw new Error("SIGNED_PAYLOAD_MISMATCH");
    }
  }
  async broadcast(s: NftSubmission) {
    const raw = await this.signedTransaction(s);
    const actual = await this.client.sendRawTransaction({
      serializedTransaction: raw,
    });
    if (actual !== s.tx_hash) throw new Error("TRANSACTION_HASH_MISMATCH");
  }
  async canonicalBlock(number: string) {
    try {
      return (await this.client.getBlock({ blockNumber: BigInt(number) })).hash;
    } catch (e) {
      if (e instanceof BlockNotFoundError) {
        if (
          (await this.client.getBlockNumber({ cacheTime: 0 })) < BigInt(number)
        )
          return null;
        throw new Error("CANONICAL_HISTORY_UNAVAILABLE");
      }
      throw e;
    }
  }
  async nonceConsumed(s: NftSubmission) {
    return (
      BigInt(
        await this.client.getTransactionCount({
          address: this.account.address,
          blockTag: "latest",
        }),
      ) > BigInt(s.nonce)
    );
  }
  async observe(s: NftSubmission): Promise<Observation> {
    await this.signedTransaction(s);
    let receipt;
    try {
      receipt = await this.client.getTransactionReceipt({
        hash: s.tx_hash as Hex,
      });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError)
        return { kind: "missing" };
      throw error;
    }
    const policy = this.executor!.confirmation_policy,
      head = await this.client.getBlock({
        blockTag: policy.finality === "local" ? "latest" : "finalized",
      });
    if (
      head.number < receipt.blockNumber ||
      head.number - receipt.blockNumber + 1n < BigInt(policy.confirmations)
    )
      return { kind: "pending" };
    if (
      (await this.canonicalBlock(receipt.blockNumber.toString())) !==
      receipt.blockHash
    )
      return { kind: "pending" };
    if (receipt.status === "reverted") return { kind: "reverted" };
    if (this.nftProtocol === "mint-cards-v1")
      return this.observeSolidityMint(s, receipt);
    const o = s.operation,
      events = receipt.logs
        .filter(
          (l) => l.address.toLowerCase() === o.contract_address.toLowerCase(),
        )
        .flatMap((l) => {
          try {
            return [
              {
                log: l,
                event: decodeEventLog({
                  abi: cardsAbi,
                  data: l.data,
                  topics: l.topics,
                  strict: true,
                }),
              },
            ];
          } catch {
            return [];
          }
        });
    const minted = events.filter(
      (x) =>
        x.event.eventName === "RewardMinted" &&
        x.event.args.operationId ===
          toHex(operationId(o.operation_id), { size: 32 }),
    );
    if (minted.length !== 1) throw new Error("MINT_EVENT_MISMATCH");
    const { log, event } = minted[0];
    if (event.eventName !== "RewardMinted")
      throw new Error("MINT_EVENT_MISMATCH");
    const { recipient, firstTokenId, count } = event.args;
    if (
      normalizeAddress("evm", recipient) !== o.beneficiary ||
      count !== 1 ||
      !events.some(
        (x) =>
          x.event.eventName === "Transfer" &&
          BigInt(x.event.args.from) === 0n &&
          normalizeAddress("evm", x.event.args.to) === o.beneficiary &&
          x.event.args.tokenId === firstTokenId,
      )
    )
      throw new Error("MINT_EVENT_MISMATCH");
    const [payloadHash, first, n] = await this.client.readContract({
      address: o.contract_address as Hex,
      abi: cardsAbi,
      functionName: "mintReceipts",
      args: [toHex(operationId(o.operation_id), { size: 32 })],
      blockNumber: receipt.blockNumber,
    });
    if (payloadHash !== evmMintHash(o) || first !== firstTokenId || n !== 1)
      throw new Error("MINT_RECEIPT_MISMATCH");
    return {
      kind: "confirmed",
      evidence: {
        operation_id: o.operation_id,
        tx_hash: s.tx_hash,
        contract_address: o.contract_address,
        recipient: o.beneficiary,
        token_id: firstTokenId.toString(),
        card: o.payload.card,
        block_number: receipt.blockNumber.toString(),
        block_hash: receipt.blockHash,
        event_index: log.logIndex,
      },
    };
  }
  private async observeSolidityMint(
    s: NftSubmission,
    receipt: Awaited<ReturnType<typeof this.client.getTransactionReceipt>>,
  ): Promise<Observation> {
    const o = s.operation;
    const events = receipt.logs
      .filter((log) => log.address.toLowerCase() === o.contract_address.toLowerCase())
      .flatMap((log) => {
        try {
          return [{ log, event: decodeEventLog({ abi: solidityCardsAbi, data: log.data, topics: log.topics, strict: true }) }];
        } catch { return []; }
      });
    const minted = events.filter((e) => e.event.eventName === "CardMinted");
    const transfers = events.filter((e) => e.event.eventName === "Transfer" && BigInt(e.event.args.from) === 0n);
    if (minted.length !== 1 || transfers.length !== 1) throw new Error("MINT_EVENT_MISMATCH");
    const { event, log } = minted[0];
    const transfer = transfers[0].event;
    if (event.eventName !== "CardMinted" || transfer.eventName !== "Transfer")
      throw new Error("MINT_EVENT_MISMATCH");
    const c = o.payload.card, m = event.args;
    if (
      normalizeAddress("evm", m.recipient) !== o.beneficiary || m.tokenId < 1n || m.count < 1 ||
      m.cardId !== c.card_id || m.rarity !== c.rarity || m.skinId !== c.skin_id ||
      m.skinRarity !== c.skin_rarity || m.quality !== c.quality || m.marketable !== c.marketable ||
      normalizeAddress("evm", transfer.args.to) !== o.beneficiary || transfer.args.tokenId !== m.tokenId
    ) throw new Error("MINT_EVENT_MISMATCH");
    const stats = await this.client.readContract({
      address: o.contract_address as Hex, abi: solidityCardsAbi,
      functionName: "getCardStats", args: [m.tokenId], blockNumber: receipt.blockNumber,
    });
    // Ownership may have changed later in this block. The mint Transfer proves delivery;
    // immutable stats verify content without confusing delivery with current ownership.
    if (
      stats.tokenId !== m.tokenId || stats.count !== m.count || stats.cardId !== c.card_id ||
      stats.rarity !== c.rarity || stats.skinId !== c.skin_id || stats.skinRarity !== c.skin_rarity ||
      stats.quality !== c.quality || stats.marketable !== c.marketable
    ) throw new Error("MINT_RECEIPT_MISMATCH");
    return { kind: "confirmed", evidence: {
      operation_id: o.operation_id, tx_hash: s.tx_hash, contract_address: o.contract_address,
      recipient: o.beneficiary, token_id: m.tokenId.toString(), card: o.payload.card,
      block_number: receipt.blockNumber.toString(), block_hash: receipt.blockHash, event_index: log.logIndex,
    } };
  }
}
