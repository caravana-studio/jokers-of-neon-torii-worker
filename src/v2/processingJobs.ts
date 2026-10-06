import { randomUUID } from 'node:crypto';

/** Wire contract shared with the worker; PostgreSQL owns scheduling and fencing. */
export const PROCESSING_CONTRACT = 'processing-v1';
export interface Lease { job_id: string; lease_token: string; attempts: number; target: Record<string, string> }
export type ProcessingRpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export class ProcessingFailure extends Error {
  constructor(message: string, readonly context: Record<string, unknown>) { super(message); }
}
export class ProcessingJobs {
  private readonly owner = randomUUID();
  constructor(private readonly rpc: ProcessingRpc) {}
  async ready(kind: string) {
    await this.rpc('assert_processing_contract', { p_kind: kind, p_version: PROCESSING_CONTRACT });
  }
  async run<T>(kind: string, key: string, target: Record<string, string>,
    action: (lease: Lease) => Promise<{ result: T; completed: boolean }>): Promise<T | undefined> {
    const lease = await this.rpc<Lease | null>('claim_processing_job', {
      p_kind: kind, p_key: key, p_target: target, p_owner: this.owner, p_version: PROCESSING_CONTRACT,
    });
    if (!lease) return undefined;
    try {
      const { result, completed } = await action(lease);
      await this.rpc('finish_processing_job', { p_job: lease.job_id, p_token: lease.lease_token,
        p_outcome: completed ? 'completed' : 'idle' });
      return result;
    } catch (error) {
      // Error codes/context only; never persist RPC bodies, headers, keys or signed payloads.
      const code = error instanceof Error ? error.message.match(/^[A-Z][A-Z0-9_]+/)?.[0] ?? 'PROCESSOR_FAILED' : 'PROCESSOR_FAILED';
      try {
        await this.rpc('finish_processing_job', { p_job: lease.job_id, p_token: lease.lease_token,
          p_outcome: 'failed', p_error: { code, ...(error instanceof ProcessingFailure ? error.context : {}) } });
      } catch { /* Lease expiry or DB outage: the expired lease remains recoverable. */ }
      throw error;
    }
  }
  apply(lease: Lease, kind: string, snapshot: unknown, effects: unknown) {
    return this.rpc('apply_processing_effects', { p_job: lease.job_id, p_token: lease.lease_token,
      p_kind: kind, p_version: PROCESSING_CONTRACT, p_snapshot: snapshot, p_effects: effects });
  }
}
