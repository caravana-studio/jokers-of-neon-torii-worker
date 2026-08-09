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
import { getAddress, isAddressEqual, parseUnits, zeroAddress } from 'viem';

const USD_M_DECIMALS = 18;
const UINT256_MAX = (1n << 256n) - 1n;

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

function getCeloRewardTokenContractAddress(): string {
  return getAddress(env.CELO_REWARD_TOKEN_CONTRACT_ADDRESS);
}

function parseRewardRecipient(value: unknown): `0x${string}` {
  const recipient = getAddress(asString(value, 'payload.recipient'));

  if (isAddressEqual(recipient, zeroAddress)) {
    throw new Error('payload.recipient cannot be the zero address');
  }

  return recipient;
}

function parseRewardAmount(value: unknown): bigint {
  const amount = asString(value, 'payload.amount').trim();

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) {
    throw new Error('payload.amount must be a positive decimal string with at most 18 decimal places');
  }

  const units = parseUnits(amount, USD_M_DECIMALS);
  if (units <= 0n || units > UINT256_MAX) {
    throw new Error('payload.amount must be greater than zero and fit in a uint256');
  }

  return units;
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
  calldata: unknown[],
  contractAddress = getCeloProfileContractAddress()
): QueuedTransaction {
  return {
    id: intent.id,
    blockchain: intent.blockchain,
    contractAddress,
    entrypoint,
    calldata,
    retries: intent.retries,
    maxRetries: intent.maxRetries,
    status: intent.status,
  };
}

export function compileCeloIntent(intent: QueuedIntent): QueuedTransaction {
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

    case 'reward.usdm.transfer': {
      return toLegacyTransaction(
        intent,
        'transfer',
        [parseRewardRecipient(payload.recipient), parseRewardAmount(payload.amount)],
        getCeloRewardTokenContractAddress()
      );
    }

    default:
      throw new Error(`Unsupported Celo operation: ${intent.operation}`);
  }
}

export const celoAdapter: BlockchainAdapter = {
  blockchain: 'celo',

  canExecute(intent) {
    return [
      'game.snapshot',
      'round.snapshot',
      'progression.sync',
      'stats.game_created',
      'stats.game_won',
      'stats.player',
      'reward.usdm.transfer',
    ].includes(intent.operation);
  },

  async execute(intent: QueuedIntent): Promise<TransactionResult> {
    try {
      return await executeCeloQueueTransaction(compileCeloIntent(intent));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
