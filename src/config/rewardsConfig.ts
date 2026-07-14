export const PACK_IDS = {
  BASIC_PACK_ID: 41,
  ADVANCED_PACK_ID: 42,
  EPIC_PACK_ID: 43,
  LEGENDARY_PACK_ID: 44,
  COLLECTORS_PACK_ID: 45,
  COLLECTORS_XL_PACK_ID: 46,
} as const;

export type PackId = (typeof PACK_IDS)[keyof typeof PACK_IDS];

export interface PackReward {
  packId: PackId;
  quantity: number;
}

export interface PositionRewards {
  position: number;
  rewards: PackReward[];
}

export interface RankingConfig {
  type: "daily" | "weekly";
  maxPosition: number;
  positions: PositionRewards[];
}

// Default configuration - easily modifiable
export const REWARDS_CONFIG: RankingConfig[] = [
  {
    type: "daily",
    maxPosition: 3,
    positions: [
      // Position 1: 1 EPIC
      {
        position: 1,
        rewards: [{ packId: PACK_IDS.EPIC_PACK_ID, quantity: 1 }],
      },
      // Position 2: 1 ADVANCED
      {
        position: 2,
        rewards: [{ packId: PACK_IDS.ADVANCED_PACK_ID, quantity: 1 }],
      },
      // Position 3: 1 BASIC
      {
        position: 3,
        rewards: [{ packId: PACK_IDS.BASIC_PACK_ID, quantity: 1 }],
      },
    ],
  },
  {
    type: "weekly",
    maxPosition: 5,
    positions: [
      // Position 1: 1 EPIC + 1 LEGENDARY
      {
        position: 1,
        rewards: [
          { packId: PACK_IDS.EPIC_PACK_ID, quantity: 1 },
          { packId: PACK_IDS.LEGENDARY_PACK_ID, quantity: 1 },
        ],
      },
      // Position 2: 2 EPIC
      {
        position: 2,
        rewards: [{ packId: PACK_IDS.EPIC_PACK_ID, quantity: 2 }],
      },
      // Position 3: 1 ADVANCED + 1 EPIC
      {
        position: 3,
        rewards: [
          { packId: PACK_IDS.ADVANCED_PACK_ID, quantity: 1 },
          { packId: PACK_IDS.EPIC_PACK_ID, quantity: 1 },
        ],
      },
      // Positions 4-5: 2 ADVANCED
      {
        position: 4,
        rewards: [{ packId: PACK_IDS.ADVANCED_PACK_ID, quantity: 2 }],
      },
      {
        position: 5,
        rewards: [{ packId: PACK_IDS.ADVANCED_PACK_ID, quantity: 2 }],
      },
    ],
  },
];

/**
 * Get rewards configuration for a specific period type
 */
export function getRewardsConfig(
  type: "daily" | "weekly",
): RankingConfig | undefined {
  return REWARDS_CONFIG.find((config) => config.type === type);
}

/**
 * Get rewards for a specific position in a ranking type
 */
export function getRewardsForPosition(
  type: "daily" | "weekly",
  position: number,
): PackReward[] {
  const config = getRewardsConfig(type);
  if (!config) return [];

  const positionConfig = config.positions.find((p) => p.position === position);
  return positionConfig?.rewards || [];
}
