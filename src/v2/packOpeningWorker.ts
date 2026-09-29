import type { SupabaseClient } from "@supabase/supabase-js";
import { openPack, type PackContents } from "./packOpening.js";
export class PackOpeningWorker {
  constructor(private readonly db: SupabaseClient<any, "api">) {}
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
    while (true) {
      const pending = await this.rpc<{ opening_id: string }[]>(
        "pending_pack_openings",
      );
      if (!pending.length) return count;
      for (const { opening_id } of pending) {
        const snapshot = await this.rpc<{
          definition: PackContents;
          seed_hex: string;
        }>("pack_opening_snapshot", { p_opening_id: opening_id });
        await this.rpc("resolve_pack_opening", {
          p_opening_id: opening_id,
          p_cards: openPack(snapshot.definition, snapshot.seed_hex),
        });
        count++;
      }
    }
  }
}
