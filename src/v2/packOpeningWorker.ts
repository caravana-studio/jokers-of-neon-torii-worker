import type { SupabaseClient } from "@supabase/supabase-js";
import { openPack, type PackContents } from "./packOpening.js";
import { ProcessingJobs } from "./processingJobs.js";
export class PackOpeningWorker {
  private readonly jobs: ProcessingJobs;
  constructor(private readonly db: SupabaseClient<any, "api">) {
    this.jobs = new ProcessingJobs((name, args) => this.rpc(name, args));
  }
  private async rpc<T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async replayPending(): Promise<number> {
    let count = 0;
    const errors: unknown[] = [];
      const pending = await this.rpc<{ opening_id: string }[]>(
        "pending_pack_openings",
      );
      if (!pending.length) return count;
      for (const { opening_id } of pending) {
        try {
        const result = await this.jobs.run("pack-opening", opening_id, { opening_id }, async lease => {
        const snapshot = await this.rpc<{
          definition: PackContents;
          seed_hex: string;
        }>("pack_opening_snapshot", { p_opening_id: opening_id });
        await this.rpc("resolve_leased_pack_opening", {
          p_job: lease.job_id,
          p_token: lease.lease_token,
          p_opening_id: opening_id,
          p_cards: openPack(snapshot.definition, snapshot.seed_hex),
        });
        return { result: true, completed: true };
        });
        if (result) count++;
        } catch (error) { errors.push(error); }
      }
    if (errors.length) throw new AggregateError(errors, "PACK_OPENING_RECOVERY_FAILED");
    return count;
  }
}
