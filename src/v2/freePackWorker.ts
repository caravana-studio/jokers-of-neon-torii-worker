import type { SupabaseClient } from "@supabase/supabase-js";
import { reduceFreePackProgression, type Snapshot } from "./progression.js";

/** No chain/runtime dependencies. Command events remain replayable after Katana is discarded. */
export class FreePackWorker {
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
    let applied = 0;
    while (true) {
      const events = await this.rpc<{ event_id: string }[]>(
        "pending_free_pack_events",
      );
      if (!events.length) return applied;
      for (const event of events) {
        const snapshot = await this.rpc<Snapshot>(
          "free_pack_progression_snapshot",
          { p_event_id: event.event_id },
        );
        await this.rpc("apply_free_pack_progression", {
          p_snapshot: snapshot,
          p_effects: reduceFreePackProgression(snapshot),
        });
        applied++;
      }
    }
  }
}
