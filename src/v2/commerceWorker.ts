import type { SupabaseClient } from "@supabase/supabase-js";
/** Provider evidence is already authenticated and durable. No Katana or payment side effects. */
export class CommerceWorker {
  constructor(private readonly db: SupabaseClient<any, "api">) {}
  async replayPending(): Promise<number> {
    const { data, error } = await this.db.rpc("pending_commerce_payments");
    if (error) throw new Error(error.message);
    let count = 0;
    for (const { receipt_id } of data as { receipt_id: string }[]) {
      const applied = await this.db.rpc("process_commerce_payment", {
        p_receipt: receipt_id,
      });
      if (applied.error) throw new Error(applied.error.message);
      if (applied.data?.status === "fulfilled") count++;
    }
    return count;
  }
}
