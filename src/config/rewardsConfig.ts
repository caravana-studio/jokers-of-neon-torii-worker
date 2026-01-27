export const PACK_IDS = {
  BASIC_PACK_ID: 1,
  ADVANCED_PACK_ID: 2,
  EPIC_PACK_ID: 3,
  LEGENDARY_PACK_ID: 4,
  COLLECTORS_PACK_ID: 5,
  COLLECTORS_XL_PACK_ID: 6,
} as const;

export type PackId = typeof PACK_IDS[keyof typeof PACK_IDS];

export interface PackReward {
  packId: PackId;
  quantity: number;
}

export interface PositionRewards {
  position: number;
  rewards: PackReward[];
}

export interface RankingConfig {
  type: 'daily' | 'weekly';
  maxPosition: number;
  positions: PositionRewards[];
}

// Default configuration - easily modifiable
export const REWARDS_CONFIG: RankingConfig[] = [
  {
    type: 'daily',
    maxPosition: 5,
    positions: [
      { position: 1, rewards: [{ packId: 2, quantity: 2 }] },  // 2 ADVANCED
      { position: 2, rewards: [{ packId: 2, quantity: 1 }, { packId: 1, quantity: 1 }] },  // 1 ADVANCED + 1 BASIC
      { position: 3, rewards: [{ packId: 1, quantity: 1 }] },  // 1 BASIC
      { position: 4, rewards: [{ packId: 1, quantity: 1 }] },  // 1 BASIC
      { position: 5, rewards: [{ packId: 1, quantity: 1 }] },  // 1 BASIC
    ]
  },
  {
    type: 'weekly',
    maxPosition: 20,
    positions: [
      // Position 1: LEGENDARY
      { position: 1, rewards: [{ packId: 4, quantity: 1 }] },
      // Positions 2-3: EPIC
      { position: 2, rewards: [{ packId: 3, quantity: 1 }] },
      { position: 3, rewards: [{ packId: 3, quantity: 1 }] },
      // Positions 4-10: ADVANCED
      { position: 4, rewards: [{ packId: 2, quantity: 1 }] },
      { position: 5, rewards: [{ packId: 2, quantity: 1 }] },
      { position: 6, rewards: [{ packId: 2, quantity: 1 }] },
      { position: 7, rewards: [{ packId: 2, quantity: 1 }] },
      { position: 8, rewards: [{ packId: 2, quantity: 1 }] },
      { position: 9, rewards: [{ packId: 2, quantity: 1 }] },
      { position: 10, rewards: [{ packId: 2, quantity: 1 }] },
      // Positions 11-20: BASIC
      { position: 11, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 12, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 13, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 14, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 15, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 16, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 17, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 18, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 19, rewards: [{ packId: 1, quantity: 1 }] },
      { position: 20, rewards: [{ packId: 1, quantity: 1 }] },
    ]
  }
];

/**
 * Get rewards configuration for a specific period type
 */
export function getRewardsConfig(type: 'daily' | 'weekly'): RankingConfig | undefined {
  return REWARDS_CONFIG.find(config => config.type === type);
}

/**
 * Get rewards for a specific position in a ranking type
 */
export function getRewardsForPosition(type: 'daily' | 'weekly', position: number): PackReward[] {
  const config = getRewardsConfig(type);
  if (!config) return [];

  const positionConfig = config.positions.find(p => p.position === position);
  return positionConfig?.rewards || [];
}
