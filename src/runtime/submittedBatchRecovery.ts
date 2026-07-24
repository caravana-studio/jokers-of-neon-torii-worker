const MEMPOOL_EVICTION_FRAGMENTS = [
  'transaction ttl',
  'evicted from the mempool',
  'mempool eviction',
];

export type SubmittedNonceDecision = 'retry' | 'quarantine';

export function hasExplicitMempoolEviction(errorMessage: string | null): boolean {
  const normalized = errorMessage?.toLowerCase() ?? '';
  return MEMPOOL_EVICTION_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function isSubmittedBatchRecoveryDue(input: {
  submittedAt: string | null;
  errorMessage: string | null;
  timeoutMs: number;
  nowMs?: number;
}): boolean {
  if (hasExplicitMempoolEviction(input.errorMessage)) {
    return true;
  }

  if (!input.submittedAt) return false;
  const submittedAtMs = new Date(input.submittedAt).getTime();
  if (!Number.isFinite(submittedAtMs)) return false;

  return (input.nowMs ?? Date.now()) - submittedAtMs >= input.timeoutMs;
}

export function classifySubmittedNonce(
  submittedNonce: string,
  currentOnchainNonce: { latest: bigint; preConfirmed: bigint },
  explicitlyEvicted = false
): SubmittedNonceDecision {
  let expectedNonce: bigint;
  try {
    expectedNonce = BigInt(submittedNonce);
  } catch {
    return 'quarantine';
  }

  if (
    expectedNonce < 0n
    || currentOnchainNonce.latest < 0n
    || currentOnchainNonce.preConfirmed < 0n
  ) {
    return 'quarantine';
  }

  if (
    currentOnchainNonce.latest > expectedNonce
    || currentOnchainNonce.preConfirmed > expectedNonce
  ) {
    return 'quarantine';
  }

  if (
    currentOnchainNonce.latest === expectedNonce
    && currentOnchainNonce.preConfirmed === expectedNonce
  ) {
    return 'retry';
  }

  // A node-provided eviction signal means the old hash is no longer a
  // candidate for inclusion, so it is safe to retry even if `latest` is
  // temporarily behind. A merely unknown hash is quarantined after the
  // timeout instead, which releases the executor without risking a duplicate.
  return explicitlyEvicted ? 'retry' : 'quarantine';
}
