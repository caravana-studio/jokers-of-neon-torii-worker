const lockQueues = new Map<string, Promise<void>>();

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase() || 'unknown';
}

export async function withStarknetWriteLock<T>(
  address: string,
  task: () => Promise<T>
): Promise<T> {
  const key = normalizeAddress(address);
  const previous = lockQueues.get(key) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  lockQueues.set(key, queued);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (lockQueues.get(key) === queued) {
      lockQueues.delete(key);
    }
  }
}
