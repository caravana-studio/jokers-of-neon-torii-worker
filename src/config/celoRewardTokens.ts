export const CELO_REWARD_TOKENS = {
  usdm: {
    symbol: 'USDm',
    address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    decimals: 18,
  },
  usdt: {
    symbol: 'USDT',
    address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    decimals: 6,
  },
  usdc: {
    symbol: 'USDC',
    address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    decimals: 6,
  },
} as const;

export type CeloRewardTokenId = keyof typeof CELO_REWARD_TOKENS;

export function isCeloRewardTokenId(
  value: string
): value is CeloRewardTokenId {
  return value in CELO_REWARD_TOKENS;
}
