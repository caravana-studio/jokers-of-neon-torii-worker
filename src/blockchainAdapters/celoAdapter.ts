import { env } from '../env.js';
import type { BlockchainAdapter } from './types.js';
import type { QueuedIntent, QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';
import { executeCeloQueueTransaction } from '../transactionExecutors/celoTransactionExecutor.js';
import {
  buildGameDataCalldata,
  buildPlayerStatsCalldata,
  buildRoundDataCalldata,
} from '../starknetExecutor.js';
import type { Game, PlayerStats, Round } from '../schema.js';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${label} to be a string`);
  }

  return value;
}

function asNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value));

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected ${label} to be a number`);
  }

  return parsed;
}

function asNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array`);
  }

  return value.map((item, index) => asNumber(item, `${label}[${index}]`));
}

function getCeloProfileContractAddress(): string {
  if (!env.CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS) {
    throw new Error('Missing Celo contract configuration: CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS');
  }

  return env.CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS;
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

function toLegacyTransaction(
  intent: QueuedIntent,
  entrypoint: string,
  calldata: unknown[]
): QueuedTransaction {
  return {
    id: intent.id,
    blockchain: intent.blockchain,
    contractAddress: getCeloProfileContractAddress(),
    entrypoint,
    calldata,
    retries: intent.retries,
    maxRetries: intent.maxRetries,
    status: intent.status,
  };
}

function buildLegacyTransaction(intent: QueuedIntent): QueuedTransaction {
  const payload = intent.payload;

  switch (intent.operation) {
    case 'game.snapshot': {
      const game = asRecord(payload.game, 'payload.game') as unknown as Game;
      const specials = asNumberArray(payload.specials, 'payload.specials');
      return toLegacyTransaction(intent, 'setGameData', buildGameDataCalldata(game, specials));
    }

    case 'round.snapshot': {
      const game = asRecord(payload.game, 'payload.game') as unknown as Game;
      const round = asRecord(payload.round, 'payload.round') as unknown as Round;
      const playerAddress = asString(payload.playerAddress, 'payload.playerAddress');
      return toLegacyTransaction(intent, 'setRoundData', buildRoundDataCalldata(game, round, playerAddress));
    }

    case 'progression.sync': {
      return toLegacyTransaction(intent, 'syncProgression', [
        asString(payload.player, 'payload.player'),
        String(asNumber(payload.tier, 'payload.tier')),
        String(asNumber(payload.totalRuns, 'payload.totalRuns')),
        String(asNumber(payload.maxLevel, 'payload.maxLevel')),
        String(asNumber(payload.maxRound, 'payload.maxRound')),
      ]);
    }

    case 'stats.game_created': {
      const player = asString(payload.player, 'payload.player');
      return toLegacyTransaction(intent, 'addPlayerStats', buildCreateGameStats(player));
    }

    case 'stats.game_won': {
      const player = asString(payload.player, 'payload.player');
      return toLegacyTransaction(intent, 'addPlayerStats', buildGameWonStats(player));
    }

    case 'stats.player': {
      const player = asString(payload.player, 'payload.player');
      const playerStats = asRecord(payload.playerStats, 'payload.playerStats') as unknown as PlayerStats;
      return toLegacyTransaction(intent, 'addPlayerStats', buildPlayerStatsCalldata(player, playerStats));
    }

    default:
      throw new Error(`Unsupported Celo operation: ${intent.operation}`);
  }
}

export const celoAdapter: BlockchainAdapter = {
  blockchain: 'celo',

  canExecute(intent) {
    return ['game.snapshot', 'round.snapshot', 'progression.sync', 'stats.game_created', 'stats.game_won', 'stats.player'].includes(intent.operation);
  },

  async execute(intent: QueuedIntent): Promise<TransactionResult> {
    try {
      return await executeCeloQueueTransaction(buildLegacyTransaction(intent));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
