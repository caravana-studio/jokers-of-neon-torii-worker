import type { SupabaseClient } from "@supabase/supabase-js";
import { RpcProvider } from "starknet";
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseTransaction, recoverTransactionAddress, TransactionReceiptNotFoundError, type Hex, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tagCeloCalldata } from "../../utils/celoAttribution.js";
import type { Lease } from "../processingJobs.js";
import { profileAbi, profileCalldata, profileSnapshot, type ProfileGameSource, type ProfilePayload } from "./profileProtocol.js";
import { validatePolicy, type Executor } from "./types.js";

export interface ProfileMirrorConfig {
  /** Must be explicitly true, in addition to the database switch, before any broadcast. */
  enabled?: boolean;
  contractAddress: Hex;
  runtimes: { runtimeId: string; rpcUrl: string; gameSystemAddress: string; gameViewsAddress: string }[];
}
interface Operation {
  operation_id: string; chain_key: string; contract_address: Hex; beneficiary: string;
  payload: ProfilePayload; payload_hash: string;
}
interface Submission {
  submission_id: string; executor_id: string; nonce: string; status: string;
  tx_hash: Hex; signed_payload: { raw: TransactionSerialized }; operation: Operation;
  block_number: string | null; block_hash: Hex | null; finalized: boolean;
}
/** Runs inside the existing NFT nonce lease. Never invent a replacement for an uncertain additive call. */
export class ProfileMirror {
  private readonly account;
  private readonly client;
  private readonly wallet;
  private executor?: Executor;
  private nextCaptureAt = 0;
  private enabled = false;
  constructor(private readonly db: SupabaseClient<any, "api">, private readonly executorId: string,
    private readonly rpcUrl: string, key: Hex, private readonly config: ProfileMirrorConfig) {
    this.account = privateKeyToAccount(key);
    const transport = http(rpcUrl, { timeout: 15000, retryCount: 0 });
    this.client = createPublicClient({ transport });
    this.wallet = createWalletClient({ account: this.account, transport });
  }
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async ready(e: Executor) {
    validatePolicy(e, this.rpcUrl);
    const target = await this.rpc<{ contract_address: string; chain_key: string; enabled: boolean } | null>("profile_mirror_target", { p_executor_id: this.executorId });
    if (!target || target.contract_address.toLowerCase() !== this.config.contractAddress.toLowerCase() || target.chain_key !== e.chain_key ||
      e.adapter_key !== "evm" || e.executor_id !== this.executorId || e.address.toLowerCase() !== this.account.address.toLowerCase())
      throw new Error("PROFILE_EXECUTOR_MISMATCH");
    if (await this.client.getChainId() !== Number(e.network_id)) throw new Error("PROFILE_CHAIN_MISMATCH");
    const owner = await this.client.readContract({ address: this.config.contractAddress, abi: profileAbi, functionName: "owner" });
    if (owner.toLowerCase() !== this.account.address.toLowerCase()) throw new Error("PROFILE_OWNER_MISMATCH");
    this.executor = e;
    this.enabled = this.config.enabled === true && target.enabled === true;
  }
  private data(o: Operation): Hex {
    if (!this.executor || o.chain_key !== this.executor.chain_key || o.contract_address.toLowerCase() !== this.config.contractAddress.toLowerCase())
      throw new Error("PROFILE_OPERATION_MISMATCH");
    return tagCeloCalldata(profileCalldata(o.payload, o.beneficiary), this.executor.network_id);
  }
  private async raw(s: Submission) {
    const raw = s.signed_payload.raw;
    const tx = parseTransaction(raw);
    if (!this.executor || s.executor_id !== this.executorId || tx.to?.toLowerCase() !== this.config.contractAddress.toLowerCase() ||
      BigInt(tx.chainId ?? 0) !== BigInt(this.executor.network_id) || BigInt(tx.nonce ?? -1) !== BigInt(s.nonce) ||
      (tx.value ?? 0n) !== 0n || tx.data !== this.data(s.operation) || keccak256(raw) !== s.tx_hash ||
      (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() !== this.account.address.toLowerCase())
      throw new Error("PROFILE_SIGNED_PAYLOAD_MISMATCH");
    return raw;
  }
  private async send(s: Submission) {
    // Re-read immediately before a send, including retries of previously signed bytes.
    // A disabled mirror must not rebroadcast a transaction prepared before the pause.
    const target = await this.rpc<{ enabled: boolean } | null>("profile_mirror_target", { p_executor_id: this.executorId });
    if (this.config.enabled !== true || target?.enabled !== true) return false;
    const hash = await this.client.sendRawTransaction({ serializedTransaction: await this.raw(s) });
    if (hash !== s.tx_hash) throw new Error("PROFILE_TRANSACTION_HASH_MISMATCH");
    await this.note(s, "submitted");
    return true;
  }
  private note(s: Submission, state: string, evidence: unknown = null) {
    return this.rpc("note_profile_submission", { p_submission_id: s.submission_id, p_state: state, p_evidence: evidence });
  }
  private async observe(s: Submission, finality = false): Promise<boolean> {
    await this.raw(s);
    let receipt;
    try { receipt = await this.client.getTransactionReceipt({ hash: s.tx_hash }); }
    catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
      if (s.block_hash || BigInt(await this.client.getTransactionCount({ address: this.account.address, blockTag: "latest" })) > BigInt(s.nonce)) {
        await this.note(s, "review");
      } else if (this.enabled && this.executor?.status === "ready" && this.executor.chain_status === "enabled") await this.send(s);
      return false;
    }
    const canonical = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.status !== "success" || canonical.hash !== receipt.blockHash || (s.block_hash && s.block_hash !== receipt.blockHash)) {
      await this.note(s, "review"); return false;
    }
    const expected = { setGameData: "GameDataSet", setRoundData: "RoundDataSet", addPlayerStats: "PlayerStatsAdded", syncProgression: "ProgressionSynced" }[s.operation.payload.method];
    const log = receipt.logs.find(log => {
      if (log.address.toLowerCase() !== this.config.contractAddress.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: profileAbi, data: log.data, topics: log.topics });
        if (event.eventName !== expected || event.args.player.toLowerCase() !== s.operation.beneficiary.toLowerCase()) return false;
        if ("gameId" in event.args && event.args.gameId !== Number(s.operation.payload.args[0])) return false;
        if ("roundId" in event.args && event.args.roundId !== Number(s.operation.payload.args[1])) return false;
        return true;
      } catch { return false; }
    });
    if (!log) { await this.note(s, "review"); throw new Error("PROFILE_RECEIPT_MISMATCH"); }
    const head = await this.client.getBlock({ blockTag: finality && this.executor!.confirmation_policy.finality !== "local" ? "finalized" : "latest" });
    if (head.number < receipt.blockNumber + BigInt(finality ? 0 : this.executor!.confirmation_policy.confirmations - 1)) return false;
    await this.note(s, finality ? "finalized" : "confirmed", {
      tx_hash: s.tx_hash, contract_address: this.config.contractAddress.toLowerCase(),
      block_number: receipt.blockNumber.toString(), block_hash: receipt.blockHash, event_index: log.logIndex,
    });
    return true;
  }
  async capture(): Promise<number> {
    if (!this.enabled) return 0;
    const sources = await this.rpc<ProfileGameSource[]>("profile_mirror_work", { p_executor_id: this.executorId });
    let errors = 0;
    for (const source of sources) {
      try {
        const config = this.config.runtimes.find(r => r.runtimeId === source.runtime_id);
        if (!config) throw new Error("PROFILE_RUNTIME_CONFIGURATION_REQUIRED");
        const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
        const runtime = await provider.callContract({ contractAddress: config.gameSystemAddress, entrypoint: "get_durable_runtime", calldata: [] });
        if (BigInt(runtime[0]) !== BigInt("0x" + source.runtime_id.replaceAll("-", ""))) throw new Error("PROFILE_RUNTIME_REPLACED");
        const [game, specials, stats] = await Promise.all(["get_game_data", "get_special_cards", "get_player_stats"].map(entrypoint =>
          provider.callContract({ contractAddress: config.gameViewsAddress, entrypoint, calldata: [source.game_id] })));
        const snapshot = profileSnapshot(source, game, specials, stats);
        // This contract has no runtime namespace: never overwrite a previous deployment's game ID.
        try {
          await this.client.readContract({ address: this.config.contractAddress, abi: profileAbi, functionName: "getGameData", args: [Number(source.game_id)] });
          throw new Error("PROFILE_GAME_ID_ALREADY_EXISTS");
        } catch (error) {
          if ((error as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName !== "GameNotFound") throw error;
        }
        await this.rpc("capture_profile_game", { p_executor_id: this.executorId, p_game_id: source.game_id, p_snapshot: snapshot });
      } catch (error) {
        errors++;
        console.error("V2 Profile snapshot pending", { gameId: source.game_id, code: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "PROFILE_SNAPSHOT_UNAVAILABLE" });
      }
    }
    return errors;
  }
  async pollLeased(lease: Lease, e: Executor, allowPrepare = true) {
    const result = { prepared: 0, confirmed: 0, errors: 0 };
    await this.ready(e);
    if (this.enabled && Date.now() >= this.nextCaptureAt) {
      this.nextCaptureAt = Date.now() + 30000;
      result.errors += await this.capture();
    }
    const pending = await this.rpc<Submission[]>("pending_profile_submissions", { p_executor_id: this.executorId, p_finality: false });
    for (const s of pending) {
      try { if (await this.observe(s)) result.confirmed++; }
      catch (error) {
        result.errors++;
        if (error instanceof Error && ["PROFILE_SIGNED_PAYLOAD_MISMATCH", "PROFILE_TRANSACTION_HASH_MISMATCH", "PROFILE_OPERATION_MISMATCH"].includes(error.message)) await this.note(s, "review");
      }
    }
    if (!this.enabled || !allowPrepare || e.status !== "ready" || e.chain_status !== "enabled") return result;
    const operation = await this.rpc<Operation | null>("next_profile_operation", { p_executor_id: this.executorId });
    if (!operation) return result;
    const request = await this.wallet.prepareTransactionRequest({ account: this.account, to: operation.contract_address, data: this.data(operation), chain: null });
    const raw = await this.wallet.signTransaction({ ...request, chain: null });
    const persisted = await this.rpc<Submission>("prepare_profile_submission", {
      p_job: lease.job_id, p_token: lease.lease_token, p_executor_id: this.executorId,
      p_operation_id: operation.operation_id, p_operation_hash: operation.payload_hash,
      p_nonce: String(request.nonce), p_signed_payload: { raw }, p_tx_hash: keccak256(raw),
    });
    if (await this.send(persisted)) result.prepared++;
    return result;
  }
  async reconcileFinality() {
    const pending = await this.rpc<Submission[]>("pending_profile_submissions", { p_executor_id: this.executorId, p_finality: true });
    let errors = 0;
    for (const s of pending) { try { await this.observe(s, true); } catch { errors++; } }
    return errors;
  }
}
