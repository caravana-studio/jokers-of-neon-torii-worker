import { CallData, shortString, uint256 } from 'starknet';
import { env } from '../env.js';
import type { BlockchainAdapter } from './types.js';
import {
  isSlotTransactionOperation,
  type QueuedIntent,
  type QueuedTransaction,
  type TransactionResult,
} from '../transactionQueueTypes.js';
import { executeStarknetQueueTransaction } from '../transactionExecutors/starknetTransactionExecutor.js';
import { executeSlotQueueTransaction } from '../transactionExecutors/slotTransactionExecutor.js';
import { buildSlotTransaction } from './slotAdapter.js';
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

function asShortStringFelt(value: unknown, label: string): string {
  const text = asString(value, label);

  if (!text) {
    return '0';
  }

  if (text.startsWith('0x') || /^\d+$/.test(text)) {
    return text;
  }

  return shortString.encodeShortString(text);
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

function asU256Array(value: unknown, label: string): bigint[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty array`);
  }

  const seen = new Set<string>();

  return value.map((item, index) => {
    const text = asString(item, `${label}[${index}]`);

    if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(text)) {
      throw new Error(`Expected ${label}[${index}] to be an unsigned integer string`);
    }

    const parsed = BigInt(text);

    if (parsed >= (1n << 256n)) {
      throw new Error(`Expected ${label}[${index}] to fit in a u256`);
    }

    const normalized = parsed.toString();
    if (seen.has(normalized)) {
      throw new Error(`Expected ${label} to contain unique token ids`);
    }

    seen.add(normalized);
    return parsed;
  });
}

function getRequiredContractAddress(value: string, label: string): string {
  if (!value) {
    throw new Error(`Missing Starknet contract configuration: ${label}`);
  }

  return value;
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
  contractAddress: string,
  entrypoint: string,
  calldata: unknown[]
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

export function compileStarknetIntent(intent: QueuedIntent): QueuedTransaction {
  const payload = intent.payload;

  switch (intent.operation) {
    case 'game.snapshot': {
      const game = asRecord(payload.game, 'payload.game') as unknown as Game;
      const specials = asNumberArray(payload.specials, 'payload.specials');
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROFILE_SYSTEM_CONTRACT_ADDRESS, 'PROFILE_SYSTEM_CONTRACT_ADDRESS'),
        'set_game_data',
        buildGameDataCalldata(game, specials)
      );
    }

    case 'round.snapshot': {
      const game = asRecord(payload.game, 'payload.game') as unknown as Game;
      const round = asRecord(payload.round, 'payload.round') as unknown as Round;
      const playerAddress = asString(payload.playerAddress, 'payload.playerAddress');
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROFILE_SYSTEM_CONTRACT_ADDRESS, 'PROFILE_SYSTEM_CONTRACT_ADDRESS'),
        'set_round_data',
        buildRoundDataCalldata(game, round, playerAddress)
      );
    }

    case 'progression.sync': {
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROGRESSION_SYSTEM_CONTRACT_ADDRESS, 'PROGRESSION_SYSTEM_CONTRACT_ADDRESS'),
        'sync_progression',
        [
          asString(payload.player, 'payload.player'),
          String(asNumber(payload.tier, 'payload.tier')),
          String(asNumber(payload.totalRuns, 'payload.totalRuns')),
          String(asNumber(payload.maxLevel, 'payload.maxLevel')),
          String(asNumber(payload.maxRound, 'payload.maxRound')),
        ]
      );
    }

    case 'xp.daily_mission': {
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS'),
        'add_daily_mission_xp',
        [
          asString(payload.player, 'payload.player'),
          asString(payload.missionType, 'payload.missionType'),
        ]
      );
    }

    case 'xp.mission_completed': {
      const xp = String(asNumber(payload.xp, 'payload.xp'));
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS'),
        'add_mission_xp',
        [
          asString(payload.player, 'payload.player'),
          String(asNumber(payload.periodTypeId, 'payload.periodTypeId')),
          String(asNumber(payload.periodId, 'payload.periodId')),
          asShortStringFelt(payload.missionId, 'payload.missionId'),
          asShortStringFelt(payload.templateId, 'payload.templateId'),
          String(asNumber(payload.difficulty, 'payload.difficulty')),
          xp,
        ]
      );
    }

    case 'xp.level_completion': {
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS'),
        'add_level_completion_xp',
        [
          asString(payload.player, 'payload.player'),
          String(asNumber(payload.previousLevel, 'payload.previousLevel')),
        ]
      );
    }

    case 'streak.grant_protectors': {
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS'),
        'grant_streak_protectors',
        [
          asString(payload.player, 'payload.player'),
          String(asNumber(payload.quantity, 'payload.quantity')),
          asShortStringFelt(payload.source, 'payload.source'),
          asShortStringFelt(payload.sourceId, 'payload.sourceId'),
        ]
      );
    }

    case 'xp.multiplier_set': {
      const contractAddress = payload.contractAddress;
      const targetContract =
        typeof contractAddress === 'string' && contractAddress
          ? contractAddress
          : getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS');

      return toLegacyTransaction(
        intent,
        targetContract,
        'set_xp_multiplier',
        [String(asNumber(payload.multiplier, 'payload.multiplier'))]
      );
    }

    case 'xp.test': {
      const contractAddress = payload.contractAddress;
      const targetContract =
        typeof contractAddress === 'string' && contractAddress
          ? contractAddress
          : getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS');

      return toLegacyTransaction(
        intent,
        targetContract,
        'test_xp',
        [
          asString(payload.address, 'payload.address'),
          String(asNumber(payload.seasonId, 'payload.seasonId')),
          asString(payload.seasonXpLow, 'payload.seasonXpLow'),
          asString(payload.seasonXpHigh, 'payload.seasonXpHigh'),
          asString(payload.profileXpLow, 'payload.profileXpLow'),
          asString(payload.profileXpHigh, 'payload.profileXpHigh'),
        ]
      );
    }

    case 'xp.reset': {
      const contractAddress = payload.contractAddress;
      const targetContract =
        typeof contractAddress === 'string' && contractAddress
          ? contractAddress
          : getRequiredContractAddress(env.XP_SYSTEM_CONTRACT_ADDRESS, 'XP_SYSTEM_CONTRACT_ADDRESS');

      return toLegacyTransaction(
        intent,
        targetContract,
        'reset_xp',
        [
          asString(payload.address, 'payload.address'),
          String(asNumber(payload.seasonId, 'payload.seasonId')),
        ]
      );
    }

    case 'nft.migrate_cards': {
      const from = asString(payload.from, 'payload.from');
      const to = asString(payload.to, 'payload.to');
      const tokenIds = asU256Array(payload.tokenIds, 'payload.tokenIds');

      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.NFT_CONTRACT_ADDRESS, 'NFT_CONTRACT_ADDRESS'),
        'migrate_cards',
        CallData.compile({
          from,
          to,
          token_ids: tokenIds.map((tokenId) => uint256.bnToUint256(tokenId)),
        })
      );
    }

    case 'stats.game_created': {
      const player = asString(payload.player, 'payload.player');
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROFILE_SYSTEM_CONTRACT_ADDRESS, 'PROFILE_SYSTEM_CONTRACT_ADDRESS'),
        'add_stats',
        buildCreateGameStats(player)
      );
    }

    case 'stats.game_won': {
      const player = asString(payload.player, 'payload.player');
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROFILE_SYSTEM_CONTRACT_ADDRESS, 'PROFILE_SYSTEM_CONTRACT_ADDRESS'),
        'add_stats',
        buildGameWonStats(player)
      );
    }

    case 'stats.player': {
      const player = asString(payload.player, 'payload.player');
      const playerStats = asRecord(payload.playerStats, 'payload.playerStats') as unknown as PlayerStats;
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROFILE_SYSTEM_CONTRACT_ADDRESS, 'PROFILE_SYSTEM_CONTRACT_ADDRESS'),
        'add_stats',
        buildPlayerStatsCalldata(player, playerStats)
      );
    }

    case 'pack.claimable.add': {
      return toLegacyTransaction(
        intent,
        getRequiredContractAddress(env.PROFILE_SYSTEM_CONTRACT_ADDRESS, 'PROFILE_SYSTEM_CONTRACT_ADDRESS'),
        'add_claimable_pack',
        [
          asString(payload.player, 'payload.player'),
          String(asNumber(payload.packId, 'payload.packId')),
        ]
      );
    }

    default:
      throw new Error(`Unsupported Starknet operation: ${intent.operation}`);
  }
}

export const starknetAdapter: BlockchainAdapter = {
  blockchain: 'starknet',

  canExecute() {
    return true;
  },

  async execute(intent: QueuedIntent): Promise<TransactionResult> {
    try {
      if (isSlotTransactionOperation(intent.operation)) {
        console.warn(
          `[starknetAdapter] Deprecated mission intent queued as blockchain="starknet"; routing ${intent.operation} to Slot. New intents should use blockchain="slot".`
        );
        return await executeSlotQueueTransaction(buildSlotTransaction(intent));
      }

      return await executeStarknetQueueTransaction(compileStarknetIntent(intent));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
