import { env } from './env.js';
import {
  buildGameDataCalldata,
  buildPlayerStatsCalldata,
  buildRoundDataCalldata,
  getGameData,
  getGameSpecials,
  getPlayerStats,
} from './starknetExecutor.js';
import type { EnqueueTransactionParams, SupportedBlockchain } from './transactionQueueTypes.js';

export interface MissionCompletedEventData {
  player: string;
  missionId: string;
  missionType: string;
}

export interface GameEventData {
  player: string;
  gameId: number;
}

export interface LevelPassedEventData extends GameEventData {
  previousLevel: number;
  newLevel: number;
}

export interface ProgressionUpdatedEventData {
  player: string;
  tier: number;
  totalRuns: number;
  maxLevel: number;
  maxRound: number;
}

export interface BlockchainEventHandler {
  blockchain: SupportedBlockchain;
  buildMissionCompletedTransactions(event: MissionCompletedEventData): Promise<EnqueueTransactionParams[]>;
  buildCreateGameTransactions(event: GameEventData): Promise<EnqueueTransactionParams[]>;
  buildPlayWinGameTransactions(event: GameEventData): Promise<EnqueueTransactionParams[]>;
  buildPlayGameOverTransactions(event: GameEventData): Promise<EnqueueTransactionParams[]>;
  buildLevelPassedTransactions(event: LevelPassedEventData): Promise<EnqueueTransactionParams[]>;
  buildProgressionUpdatedTransactions(event: ProgressionUpdatedEventData): Promise<EnqueueTransactionParams[]>;
}

function buildCreateGameStats(player: string): string[] {
  return [
    player,
    '1',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
  ];
}

function buildGameWonStats(player: string): string[] {
  return [player, '0', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
}

function warnNoop(blockchain: SupportedBlockchain, eventName: string): EnqueueTransactionParams[] {
  console.warn(`⚠️  ${blockchain} handler has no implementation for ${eventName} yet`);
  return [];
}

const starknetEventHandler: BlockchainEventHandler = {
  blockchain: 'starknet',

  async buildMissionCompletedTransactions(event) {
    if (!env.XP_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      return [];
    }

    return [{
      blockchain: 'starknet',
      contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_daily_mission_xp',
      calldata: [event.player, event.missionType],
    }];
  },

  async buildCreateGameTransactions(event) {
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      return [];
    }

    return [{
      blockchain: 'starknet',
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_stats',
      calldata: buildCreateGameStats(event.player),
    }];
  },

  async buildPlayWinGameTransactions(event) {
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      return [];
    }

    const { game, round } = await getGameData(event.gameId);
    const specials = await getGameSpecials(event.gameId);

    return [
      {
        blockchain: 'starknet',
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'set_round_data',
        calldata: buildRoundDataCalldata(game, round, event.player),
      },
      {
        blockchain: 'starknet',
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'set_game_data',
        calldata: buildGameDataCalldata(game, specials),
      },
    ];
  },

  async buildPlayGameOverTransactions(event) {
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      return [];
    }

    const { game } = await getGameData(event.gameId);
    const specials = await getGameSpecials(event.gameId);
    const playerStats = await getPlayerStats(event.gameId);

    return [
      {
        blockchain: 'starknet',
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'set_game_data',
        calldata: buildGameDataCalldata(game, specials),
      },
      {
        blockchain: 'starknet',
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'add_stats',
        calldata: buildPlayerStatsCalldata(event.player, playerStats),
      },
    ];
  },

  async buildLevelPassedTransactions(event) {
    if (!env.XP_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      return [];
    }

    const transactions: EnqueueTransactionParams[] = [
      {
        blockchain: 'starknet',
        contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'add_level_completion_xp',
        calldata: [event.player, event.previousLevel.toString()],
      },
    ];

    if (event.newLevel === 4 && env.PROFILE_SYSTEM_CONTRACT_ADDRESS) {
      transactions.push({
        blockchain: 'starknet',
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'add_stats',
        calldata: buildGameWonStats(event.player),
      });
    }

    return transactions;
  },

  async buildProgressionUpdatedTransactions(event) {
    if (!env.PROGRESSION_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      return [];
    }

    return [{
      blockchain: 'starknet',
      contractAddress: env.PROGRESSION_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'sync_progression',
      calldata: [
        event.player,
        event.tier.toString(),
        event.totalRuns.toString(),
        event.maxLevel.toString(),
        event.maxRound.toString(),
      ],
    }];
  },
};

const celoEventHandler: BlockchainEventHandler = {
  blockchain: 'celo',

  async buildMissionCompletedTransactions() {
    return warnNoop('celo', 'MissionCompletedEvent');
  },

  async buildCreateGameTransactions() {
    return warnNoop('celo', 'CreateGameEvent');
  },

  async buildPlayWinGameTransactions() {
    return warnNoop('celo', 'PlayWinGameEvent');
  },

  async buildPlayGameOverTransactions() {
    return warnNoop('celo', 'PlayGameOverEvent');
  },

  async buildLevelPassedTransactions() {
    return warnNoop('celo', 'LevelPassedEvent');
  },

  async buildProgressionUpdatedTransactions() {
    return warnNoop('celo', 'ProgressionUpdatedEvent');
  },
};

const handlers: Record<SupportedBlockchain, BlockchainEventHandler> = {
  starknet: starknetEventHandler,
  celo: celoEventHandler,
};

export function getBlockchainEventHandler(blockchain: SupportedBlockchain): BlockchainEventHandler {
  return handlers[blockchain];
}

export function getAllBlockchainEventHandlers(): BlockchainEventHandler[] {
  return Object.values(handlers);
}
