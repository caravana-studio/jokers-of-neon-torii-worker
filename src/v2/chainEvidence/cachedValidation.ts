/** One successful configuration check per adapter instance (and immutable RPC endpoint).
 * Concurrent callers share the check; failures and replaced configurations are never retained.
 * Use only for configuration, never for ownership, receipts, finality or other live evidence.
 */
export class CachedValidation {
  private current?: { key: string; promise: Promise<void> };

  async check(key: string, validate: () => Promise<void>): Promise<void> {
    if (this.current?.key === key) return this.current.promise;
    const entry = { key, promise: Promise.resolve().then(validate) };
    this.current = entry;
    try { await entry.promise; }
    catch (error) {
      if (this.current === entry) this.current = undefined;
      throw error;
    }
  }
}
