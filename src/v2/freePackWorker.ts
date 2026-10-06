import type { SupabaseClient } from '@supabase/supabase-js';
import { reduceFreePackProgression, type Snapshot } from './progression.js';
import { ProcessingJobs, ProcessingFailure } from './processingJobs.js';

/** Archived command evidence survives Katana; commits include tracks atomically. */
export class FreePackWorker {
  constructor(private readonly db: SupabaseClient<any, 'api'>) {}
  private async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async replayPending(): Promise<number> {
    const jobs = new ProcessingJobs((name, args) => this.rpc(name, args));
    const events = await this.rpc<{ event_id: string }[]>('pending_free_pack_events');
    let applied = 0;
    const errors: unknown[] = [];
    for (const event of events) {
      try {
        const done = await jobs.run('free-pack-progression', event.event_id, { event_id: event.event_id }, async lease => {
          const snapshot = await this.rpc<Snapshot>('free_pack_progression_snapshot', { p_event_id: event.event_id });
          await jobs.apply(lease, 'free-pack-progression', snapshot, reduceFreePackProgression(snapshot));
          return { result: true, completed: true };
        });
        if (done) applied++;
      } catch (error) {
        errors.push(new ProcessingFailure(error instanceof Error ? error.message : 'FREE_PACK_PROGRESSION_FAILED', event));
      }
    }
    if (errors.length) throw new AggregateError(errors, 'FREE_PACK_PROGRESSION_BLOCKED');
    return applied;
  }
}
