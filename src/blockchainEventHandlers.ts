import { env, hasStarknetTransactionExecutor } from './env.js';
import {
  getGameData,
  getGameSpecials,
  getPlayerStats,
} from './starknetExecutor.js';
import type { Game } from './schema.js';
import type { BlockchainId, EnqueueTransactionParams } from './transactionQueueTypes.js';
import { resolveCeloWalletFromBurnerAddress } from './services/celoWalletResolver.js';

export interface MissionCompletedEventData {
  player: string;
  periodType: 'daily' | 'weekly';
  periodTypeId: number;
  periodId: number;
  missionId: string;
  templateId: string;
  difficulty: number;
  target: number;
  progress: number;
  xp: number;
  gameId: number;
}

export interface GameEventData {
  player: string;
  gameId: number;
}

export interface LevelPassedEventData extends GameEventData {
  previousLevel: number;
  newLevel: number;
}

export interface ProgressionGameUpdateEventData {
  player: string;
  gameId: number;
  tier: number;
  totalRuns: number;
  maxLevel: number;
  maxRound: number;
}

export interface BlockchainEventHandler {
  blockchain: BlockchainId;
  buildMissionCompletedTransactions(event: MissionCompletedEventData): Promise<EnqueueTransactionParams[]>;
  buildCreateGameTransactions(event: GameEventData): Promise<EnqueueTransactionParams[]>;
  buildPlayWinGameTransactions(event: GameEventData): Promise<EnqueueTransactionParams[]>;
  buildPlayGameOverTransactions(event: GameEventData): Promise<EnqueueTransactionParams[]>;
  buildLevelPassedTransactions(event: LevelPassedEventData): Promise<EnqueueTransactionParams[]>;
  buildProgressionUpdatedTransactions(event: ProgressionGameUpdateEventData): Promise<EnqueueTransactionParams[]>;
}

function hasStarknetWriteConfig(...contractAddresses: string[]): boolean {
  return !!(
    hasStarknetTransactionExecutor() &&
    contractAddresses.every(Boolean)
  );
}

function hasCeloWriteConfig(): boolean {
  return !!(
    env.CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS &&
    env.CELO_RPC_URL &&
    env.CELO_PRIVATE_KEY
  );
}

function gameSnapshotIntent(
  blockchain: BlockchainId,
  game: Game,
  specials: number[],
  metadata: Record<string, unknown>
): EnqueueTransactionParams {
  return {
    blockchain,
    operation: 'game.snapshot',
    targetRef: 'profile_system',
    payload: { game, specials },
    metadata,
  };
}

function roundSnapshotIntent(
  blockchain: BlockchainId,
  game: Game,
  round: unknown,
  playerAddress: string,
  metadata: Record<string, unknown>
): EnqueueTransactionParams {
  return {
    blockchain,
    operation: 'round.snapshot',
    targetRef: 'profile_system',
    payload: { game, round, playerAddress },
    metadata,
  };
}

function progressionIntent(
  blockchain: BlockchainId,
  player: string,
  event: Omit<ProgressionGameUpdateEventData, 'player'>
): EnqueueTransactionParams {
  return {
    blockchain,
    operation: 'progression.sync',
    targetRef: blockchain === 'starknet' ? 'progression_system' : 'profile_system',
    payload: {
      player,
      tier: event.tier,
      totalRuns: event.totalRuns,
      maxLevel: event.maxLevel,
      maxRound: event.maxRound,
    },
    metadata: {
      sourceEvent: 'ProgressionGameUpdateEvent',
      gameId: event.gameId,
    },
  };
}

function warnNoop(blockchain: BlockchainId, eventName: string): EnqueueTransactionParams[] {
  console.warn(`⚠️  ${blockchain} handler has no implementation for ${eventName} yet`);
  return [];
}

async function buildCeloGameSnapshotTransactions(gameId: number): Promise<EnqueueTransactionParams[]> {
  if (!hasCeloWriteConfig()) {
    return [];
  }

  const { game, round } = await getGameData(gameId);
  const specials = await getGameSpecials(gameId);
  const playerWallet = await resolveCeloWalletFromBurnerAddress(String(game.owner));

  if (!playerWallet) {
    console.warn(`⚠️  Could not resolve an EVM wallet for Celo burner ${String(game.owner)} (game ${gameId}); skipping snapshot sync`);
    return [];
  }

  const gameForExternalOwner: Game = { ...game, owner: playerWallet };
  const metadata = { sourceGameId: gameId, sourceEvent: 'SlotSettlementEvent' };

  return [
    gameSnapshotIntent('celo', gameForExternalOwner, specials, metadata),
    roundSnapshotIntent('celo', game, round, playerWallet, metadata),
  ];
}

async function resolveCeloPlayerWallet(
  burnerAddress: string,
  context: string
): Promise<string | null> {
  const playerWallet = await resolveCeloWalletFromBurnerAddress(burnerAddress);

  if (!playerWallet) {
    console.warn(`⚠️  Could not resolve an EVM wallet for Celo burner ${burnerAddress}; skipping ${context}`);
    return null;
  }

  return playerWallet;
}

const starknetEventHandler: BlockchainEventHandler = {
  blockchain: 'starknet',

  async buildMissionCompletedTransactions(event) {
    if (!hasStarknetWriteConfig(env.XP_SYSTEM_CONTRACT_ADDRESS)) {
      return [];
    }

    const metadata = {
      sourceEvent: 'MissionCompletedV2Event',
      periodType: event.periodType,
      periodTypeId: event.periodTypeId,
      periodId: event.periodId,
      missionId: event.missionId,
      templateId: event.templateId,
      difficulty: event.difficulty,
      target: event.target,
      progress: event.progress,
      xp: event.xp,
      gameId: event.gameId,
    };

    if (event.xp > 0) {
      return [{
        blockchain: 'starknet',
        operation: 'xp.mission_completed',
        targetRef: 'xp_system',
        payload: {
          player: event.player,
          periodType: event.periodType,
          periodTypeId: event.periodTypeId,
          periodId: event.periodId,
          missionId: event.missionId,
          templateId: event.templateId,
          difficulty: event.difficulty,
          target: event.target,
          progress: event.progress,
          xp: event.xp,
          gameId: event.gameId,
        },
        metadata,
      }];
    }

    return [{
      blockchain: 'starknet',
      operation: 'xp.daily_mission',
      targetRef: 'xp_system',
      payload: {
        player: event.player,
        missionType: String(event.difficulty),
      },
      metadata,
    }];
  },

  async buildCreateGameTransactions(event) {
    if (!hasStarknetWriteConfig(env.PROFILE_SYSTEM_CONTRACT_ADDRESS)) {
      return [];
    }

    return [{
      blockchain: 'starknet',
      operation: 'stats.game_created',
      targetRef: 'profile_system',
      payload: { player: event.player },
      metadata: {
        sourceEvent: 'CreateGameEvent',
        gameId: event.gameId,
      },
    }];
  },

  async buildPlayWinGameTransactions(event) {
    if (!hasStarknetWriteConfig(env.PROFILE_SYSTEM_CONTRACT_ADDRESS)) {
      return [];
    }

    const { game, round } = await getGameData(event.gameId);
    const specials = await getGameSpecials(event.gameId);
    const metadata = {
      sourceEvent: 'PlayWinGameEvent',
      gameId: event.gameId,
    };

    return [
      roundSnapshotIntent('starknet', game, round, event.player, metadata),
      gameSnapshotIntent('starknet', game, specials, metadata),
    ];
  },

  async buildPlayGameOverTransactions(event) {
    if (!hasStarknetWriteConfig(env.PROFILE_SYSTEM_CONTRACT_ADDRESS)) {
      return [];
    }

    const { game } = await getGameData(event.gameId);
    const specials = await getGameSpecials(event.gameId);
    const playerStats = await getPlayerStats(event.gameId);
    const metadata = {
      sourceEvent: 'PlayGameOverEvent',
      gameId: event.gameId,
    };

    return [
      gameSnapshotIntent('starknet', game, specials, metadata),
      {
        blockchain: 'starknet',
        operation: 'stats.player',
        targetRef: 'profile_system',
        payload: {
          player: event.player,
          playerStats,
        },
        metadata,
      },
    ];
  },

  async buildLevelPassedTransactions(event) {
    if (!hasStarknetWriteConfig(env.XP_SYSTEM_CONTRACT_ADDRESS)) {
      return [];
    }

    const transactions: EnqueueTransactionParams[] = [
      {
        blockchain: 'starknet',
        operation: 'xp.level_completion',
        targetRef: 'xp_system',
        payload: {
          player: event.player,
          previousLevel: event.previousLevel,
        },
        metadata: {
          sourceEvent: 'LevelPassedEvent',
          gameId: event.gameId,
          newLevel: event.newLevel,
        },
      },
    ];

    if (event.newLevel === 4 && hasStarknetWriteConfig(env.PROFILE_SYSTEM_CONTRACT_ADDRESS)) {
      transactions.push({
        blockchain: 'starknet',
        operation: 'stats.game_won',
        targetRef: 'profile_system',
        payload: { player: event.player },
        metadata: {
          sourceEvent: 'LevelPassedEvent',
          gameId: event.gameId,
          previousLevel: event.previousLevel,
          newLevel: event.newLevel,
        },
      });
    }

    return transactions;
  },

  async buildProgressionUpdatedTransactions(event) {
    if (!hasStarknetWriteConfig(env.PROGRESSION_SYSTEM_CONTRACT_ADDRESS)) {
      return [];
    }

    return [progressionIntent('starknet', event.player, event)];
  },
};

const celoEventHandler: BlockchainEventHandler = {
  blockchain: 'celo',

  async buildMissionCompletedTransactions() {
    return warnNoop('celo', 'MissionCompletedV2Event');
  },

  async buildCreateGameTransactions(event) {
    if (!hasCeloWriteConfig()) {
      return [];
    }

    const playerWallet = await resolveCeloPlayerWallet(event.player, `create game stats sync for game ${event.gameId}`);
    if (!playerWallet) {
      return [];
    }

    return [{
      blockchain: 'celo',
      operation: 'stats.game_created',
      targetRef: 'profile_system',
      payload: { player: playerWallet },
      metadata: {
        sourceEvent: 'CreateGameEvent',
        gameId: event.gameId,
      },
    }];
  },

  async buildPlayWinGameTransactions(event) {
    return buildCeloGameSnapshotTransactions(event.gameId);
  },

  async buildPlayGameOverTransactions(event) {
    if (!hasCeloWriteConfig()) {
      return [];
    }

    const snapshotTransactions = await buildCeloGameSnapshotTransactions(event.gameId);
    const playerWallet = await resolveCeloPlayerWallet(event.player, `player stats sync for game ${event.gameId}`);

    if (!playerWallet) {
      return snapshotTransactions;
    }

    const playerStats = await getPlayerStats(event.gameId);

    return [
      ...snapshotTransactions,
      {
        blockchain: 'celo',
        operation: 'stats.player',
        targetRef: 'profile_system',
        payload: {
          player: playerWallet,
          playerStats,
        },
        metadata: {
          sourceEvent: 'PlayGameOverEvent',
          gameId: event.gameId,
        },
      },
    ];
  },

  async buildLevelPassedTransactions(event) {
    if (!hasCeloWriteConfig() || event.newLevel !== 4) {
      return [];
    }

    const playerWallet = await resolveCeloPlayerWallet(event.player, `game won stats sync for game ${event.gameId}`);
    if (!playerWallet) {
      return [];
    }

    return [{
      blockchain: 'celo',
      operation: 'stats.game_won',
      targetRef: 'profile_system',
      payload: { player: playerWallet },
      metadata: {
        sourceEvent: 'LevelPassedEvent',
        gameId: event.gameId,
        previousLevel: event.previousLevel,
        newLevel: event.newLevel,
      },
    }];
  },

  async buildProgressionUpdatedTransactions(event) {
    if (!hasCeloWriteConfig()) {
      return [];
    }

    const playerWallet = await resolveCeloPlayerWallet(event.player, 'progression sync');
    if (!playerWallet) {
      return [];
    }

    return [progressionIntent('celo', playerWallet, event)];
  },
};

const handlers = new Map<BlockchainId, BlockchainEventHandler>();

export function registerBlockchainEventHandler(handler: BlockchainEventHandler): void {
  handlers.set(handler.blockchain, handler);
}

registerBlockchainEventHandler(starknetEventHandler);
registerBlockchainEventHandler(celoEventHandler);

export function getBlockchainEventHandler(blockchain: BlockchainId): BlockchainEventHandler {
  const handler = handlers.get(blockchain);

  if (!handler) {
    throw new Error(`Unsupported blockchain event handler: ${blockchain}`);
  }

  return handler;
}

export function getAllBlockchainEventHandlers(): BlockchainEventHandler[] {
  return Array.from(handlers.values());
}
