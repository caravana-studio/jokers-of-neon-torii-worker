import type { SupabaseClient } from "@supabase/supabase-js";
import { ProcessingJobs, type Lease } from "../processingJobs.js";
import type {
  Executor,
  NftAdapter,
  NftOperation,
  NftSubmission,
} from "./types.js";
/** Every network send uses a signed payload that has already committed to PostgreSQL. */
export class NftSettlementWorker {
  private readonly jobs: ProcessingJobs;
  constructor(
    private readonly db: SupabaseClient<any, "api">,
    private readonly executorId: string,
    private readonly adapter: NftAdapter,
  ) { this.jobs = new ProcessingJobs((name, args) => this.rpc(name, args)); }
  private async rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async ready() {
    const e = await this.rpc<Executor>("nft_executor", {
      p_executor_id: this.executorId,
    });
    if (!e) throw new Error("NFT_EXECUTOR_REQUIRED");
    await this.adapter.ready(e);
    await this.jobs.ready("nft-executor");
  }
  async pollOnce(): Promise<{
    prepared: number;
    confirmed: number;
    errors: number;
  }> {
    return await this.jobs.run("nft-executor", this.executorId, { executor_id: this.executorId }, async lease => ({
      result: await this.pollLeased(lease), completed: false,
    })) ?? { prepared: 0, confirmed: 0, errors: 0 };
  }
  private async pollLeased(lease: Lease) {
    const result = { prepared: 0, confirmed: 0, errors: 0 };
    const executor = await this.rpc<Executor>("nft_executor", {
      p_executor_id: this.executorId,
    });
    if (!executor) throw new Error("NFT_EXECUTOR_REQUIRED");
    await this.adapter.ready(executor);
    const maySend =
      executor.status === "ready" && executor.chain_status === "enabled";
    const pending = await this.rpc<NftSubmission[]>("pending_nft_submissions", {
      p_executor_id: this.executorId,
    });
    for (const s of pending) {
      let delay = 2,
        code: string | null = null;
      try {
        const seen = await this.adapter.observe(s);
        if (seen.kind === "confirmed") {
          await this.rpc("confirm_nft_submission", {
            p_submission_id: s.submission_id,
            p_evidence: seen.evidence,
          });
          result.confirmed++;
          delay = 30;
        } else if (
          seen.kind === "reverted" ||
          (seen.kind === "missing" && (await this.adapter.nonceConsumed(s)))
        ) {
          await this.rpc("quarantine_nft_submission", {
            p_submission_id: s.submission_id,
          });
          code =
            seen.kind === "reverted"
              ? "TRANSACTION_REVERTED"
              : "NONCE_REQUIRES_RECONCILIATION";
          delay = 60;
        } else if (seen.kind === "missing" && maySend) {
          await this.adapter.broadcast(s);
          await this.rpc("note_nft_submitted", {
            p_submission_id: s.submission_id,
          });
        }
      } catch (error) {
        result.errors++;
        code =
          error instanceof Error && /^[A-Z0-9_]{1,120}$/.test(error.message)
            ? error.message
            : "SETTLEMENT_OBSERVATION_OR_SEND_FAILED";
        if (
          [
            "MINT_EVENT_MISMATCH",
            "MINT_TRANSFER_MISMATCH",
            "MINT_RECEIPT_MISMATCH",
            "SIGNED_PAYLOAD_MISMATCH",
            "TRANSACTION_HASH_MISMATCH",
          ].includes(code)
        )
          await this.rpc("quarantine_nft_submission", {
            p_submission_id: s.submission_id,
          });
      } finally {
        await this.rpc("defer_nft_submission", {
          p_submission_id: s.submission_id,
          p_seconds: delay,
          p_error_code: code,
        });
      }
    }
    const operation = await this.rpc<NftOperation | null>(
      "next_nft_operation",
      { p_executor_id: this.executorId },
    );
    if (operation && maySend) {
      const signed = await this.adapter.prepare(operation);
      const submission = await this.rpc<NftSubmission>("prepare_leased_nft_submission", {
        p_job: lease.job_id,
        p_token: lease.lease_token,
        p_executor_id: this.executorId,
        p_operation_id: operation.operation_id,
        p_operation_hash: operation.payload_hash,
        p_nonce: signed.nonce,
        p_signed_payload: signed.signed_payload,
        p_tx_hash: signed.tx_hash,
      });
      // Only send the persisted payload (a competing retry may have won).
      await this.adapter.broadcast(submission);
      await this.rpc("note_nft_submitted", { p_submission_id: submission.submission_id });
      result.prepared++;
    }
    return result;
  }
  /** Separate budget/cadence: no nonce lease and no work after finalization. */
  async reconcileFinality(): Promise<number> {
    const pending = await this.rpc<NftSubmission[]>("pending_nft_finality", { p_executor_id: this.executorId });
    let errors = 0;
    for (let offset = 0; offset < pending.length; offset += 4)
      await Promise.all(pending.slice(offset, offset + 4).map(async s => {
        if (!s.confirmed_block) return;
        try {
          const canonical = await this.adapter.canonicalBlock(s.confirmed_block.number);
          // null can mean a lagging provider, never proof of a reorg.
          if (canonical !== null && canonical !== s.confirmed_block.hash) {
            await this.rpc("orphan_nft_submission", {
              p_submission_id: s.submission_id, p_block_hash: s.confirmed_block.hash,
            });
          } else {
            await this.rpc("note_nft_finality", {
              p_submission_id: s.submission_id, p_block_hash: s.confirmed_block.hash,
              p_finalized: canonical !== null && await this.adapter.finalized(s),
            });
          }
        } catch {
          errors++;
          await this.rpc("note_nft_finality", {
            p_submission_id: s.submission_id, p_block_hash: s.confirmed_block.hash, p_finalized: false,
          }).catch(() => {});
        }
      }));
    return errors;
  }
}
