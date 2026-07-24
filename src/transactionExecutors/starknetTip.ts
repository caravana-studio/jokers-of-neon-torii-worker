import type { RpcProvider } from 'starknet';

const TIP_CACHE_TTL_MS = 30_000;
const TIP_ESTIMATE_MAX_BLOCKS = 10;
const TIP_ESTIMATE_MIN_TXS = 5;

let cachedTip: { value: bigint; expiresAt: number } | null = null;
let pendingTipEstimate: Promise<bigint> | null = null;

function formatTipError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function resolveStarknetRecommendedTip(provider: RpcProvider): Promise<bigint> {
  const now = Date.now();

  if (cachedTip && cachedTip.expiresAt > now) {
    return cachedTip.value;
  }

  if (!pendingTipEstimate) {
    pendingTipEstimate = provider
      .getEstimateTip('latest', {
        maxBlocks: TIP_ESTIMATE_MAX_BLOCKS,
        minTxsNecessary: TIP_ESTIMATE_MIN_TXS,
        includeZeroTips: true,
      })
      .then(estimate => {
        const tip = estimate.recommendedTip;
        const samples = estimate.metrics?.transactionsTipsFound.length;
        const blocks = estimate.metrics?.blocksAnalyzed;

        cachedTip = {
          value: tip,
          expiresAt: Date.now() + TIP_CACHE_TTL_MS,
        };

        console.log(
          `[executor] starknet_tip_estimate tip=${tip.toString()} samples=${samples ?? 'unknown'} blocks=${blocks ?? 'unknown'} ttlMs=${TIP_CACHE_TTL_MS}`
        );

        return tip;
      })
      .catch(error => {
        cachedTip = {
          value: 0n,
          expiresAt: Date.now() + TIP_CACHE_TTL_MS,
        };

        console.warn(
          `[executor] starknet_tip_estimate_failed fallbackTip=0 ttlMs=${TIP_CACHE_TTL_MS} error=${formatTipError(error)}`
        );

        return 0n;
      })
      .finally(() => {
        pendingTipEstimate = null;
      });
  }

  return pendingTipEstimate;
}
