import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { formatConfiguredBlockchains, isConfiguredBlockchain } from './config/chains.js';
import type { BlockchainId } from './transactionQueueTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the repository .env before deriving any typed configuration values.
dotenv.config({ path: resolve(__dirname, '../.env') });

export type TransactionExecutionMode = 'sequential' | 'multicall';

function parsePositiveInt(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return max ? Math.min(normalized, max) : normalized;
}

function parseNonNegativeInt(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  const normalized = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  return max ? Math.min(normalized, max) : normalized;
}

function parseTransactionExecutionMode(value: string | undefined): TransactionExecutionMode {
  return value?.trim().toLowerCase() === 'multicall' ? 'multicall' : 'sequential';
}

function parseExecutorIds(value: string | undefined): number[] {
  return Array.from(new Set(
    (value ?? '')
      .split(',')
      .map(item => Number.parseInt(item.trim(), 10))
      .filter(item => Number.isInteger(item) && item > 0)
  ));
}

const transactionExecutionMode = parseTransactionExecutionMode(process.env.TRANSACTION_EXECUTION_MODE);

export const env = {
  // Slot Environment (controls which slot instance and manifest to load)
  MANIFEST_SLOT_ENV: process.env.MANIFEST_SLOT_ENV || 'dev',

  // Starknet Configuration (Optional - for executing transactions)
  STARKNET_RPC_URL: process.env.STARKNET_RPC_URL || '',
  BACKGROUND_STARKNET_RPC_URL: process.env.BACKGROUND_STARKNET_RPC_URL || process.env.STARKNET_RPC_URL || '',
  STARKNET_PRIVATE_KEY: process.env.STARKNET_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  STARKNET_ADDRESS: process.env.STARKNET_ADDRESS || process.env.ADDRESS || '',

  // Slot/Katana write account (for Dojo world transactions such as mission generation)
  SLOT_MASTER_ADDRESS: process.env.SLOT_MASTER_ADDRESS || process.env.SLOT_ADDRESS || '',
  SLOT_MASTER_PRIVATE_KEY: process.env.SLOT_MASTER_PRIVATE_KEY || process.env.SLOT_PRIVATE_KEY || '',

  // Celo / EVM Configuration (Optional - used for EVM execution)
  CELO_RPC_URL: process.env.CELO_RPC_URL || '',
  CELO_PRIVATE_KEY: process.env.CELO_PRIVATE_KEY || '',
  CELO_ADDRESS: process.env.CELO_ADDRESS || '',
  CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS: process.env.CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS || '',
  CELO_REWARD_TOKEN_CONTRACT_ADDRESS:
    process.env.CELO_REWARD_TOKEN_CONTRACT_ADDRESS ||
    '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  WORKER_BLOCKCHAIN_FILTER: process.env.WORKER_BLOCKCHAIN_FILTER || '',

  // XP System Contract
  XP_SYSTEM_CONTRACT_ADDRESS: process.env.XP_SYSTEM_CONTRACT_ADDRESS || '',

  // Profile System Contract
  PROFILE_SYSTEM_CONTRACT_ADDRESS: process.env.PROFILE_SYSTEM_CONTRACT_ADDRESS || '',

  // Progression System Contract (Profile World - for syncing progression from core events)
  PROGRESSION_SYSTEM_CONTRACT_ADDRESS: process.env.PROGRESSION_SYSTEM_CONTRACT_ADDRESS || '',

  // NFT contract used by account-migration card chunk intents.
  NFT_CONTRACT_ADDRESS:
    process.env.NFT_CONTRACT_ADDRESS ||
    process.env.STARKNET_NFT_CONTRACT_ADDRESS ||
    '',

  // Supabase Configuration (for persistent transaction queue)
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Transaction execution. `sequential` is the safe rollback mode; enable
  // `multicall` after applying the parallel-executor Supabase migration.
  TRANSACTION_EXECUTION_MODE: transactionExecutionMode,
  STARKNET_BATCH_SIZE: parsePositiveInt(process.env.STARKNET_BATCH_SIZE, 5, 20),
  STARKNET_BATCH_WAIT_TIME_MS: parsePositiveInt(process.env.STARKNET_BATCH_WAIT_TIME_MS, 1000, 30000),
  // Zero is a drain mode: reconcile submitted hashes without claiming new batches.
  STARKNET_MAX_CONCURRENT_BATCHES: parseNonNegativeInt(process.env.STARKNET_MAX_CONCURRENT_BATCHES, 6, 50),
  STARKNET_EXECUTOR_IDS: parseExecutorIds(process.env.STARKNET_EXECUTOR_IDS),
  TRANSACTION_QUEUE_POLL_INTERVAL_MS: parsePositiveInt(process.env.TRANSACTION_QUEUE_POLL_INTERVAL_MS, 500, 30000),
  TRANSACTION_QUEUE_LEASE_MS: parsePositiveInt(process.env.TRANSACTION_QUEUE_LEASE_MS, 600000, 3600000),
  STARKNET_SUBMITTED_UNKNOWN_TIMEOUT_MS: parsePositiveInt(
    process.env.STARKNET_SUBMITTED_UNKNOWN_TIMEOUT_MS,
    120000,
    3600000
  ),

  // Game Data API
  FULL_GAME_API_URL: process.env.FULL_GAME_API_URL || 'https://jokers-of-neon-data.vercel.app/api/full-game',

  // Event Listener Mode
  // Si STARKNET_PRIVATE_KEY está configurado, ejecutará transacciones
  // Si no, solo escuchará eventos (modo solo lectura)
  READONLY_MODE:
    transactionExecutionMode === 'multicall'
      ? !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
      : !(process.env.STARKNET_PRIVATE_KEY || process.env.PRIVATE_KEY),

  // Pack Distribution Configuration
  PACK_DISTRIBUTION_ENABLED: process.env.PACK_DISTRIBUTION_ENABLED === 'true',
  LEADERBOARD_GRAPHQL_URL: process.env.LEADERBOARD_GRAPHQL_URL || 'https://api.cartridge.gg/x/mainnet-jokers-profile/torii/graphql',
  GAME_STATS_API_URL: process.env.GAME_STATS_API_URL || '',
  GAME_STATS_API_KEY: process.env.GAME_STATS_API_KEY || '',
  DAILY_CRON_SCHEDULE: process.env.DAILY_CRON_SCHEDULE || '5 6 * * *',   // 06:05 UTC daily (after 6am UTC day boundary)
  WEEKLY_CRON_SCHEDULE: process.env.WEEKLY_CRON_SCHEDULE || '10 6 * * 1', // 06:10 UTC every Monday
  // Worker module toggles
  TORII_LISTENER_ENABLED: process.env.TORII_LISTENER_ENABLED !== 'false',
  TRANSACTION_QUEUE_ENABLED: process.env.TRANSACTION_QUEUE_ENABLED !== 'false',
  CRON_JOBS_ENABLED: process.env.CRON_JOBS_ENABLED !== 'false',
  NOTIFICATIONS_ENABLED: process.env.NOTIFICATIONS_ENABLED === 'true',
  MISSIONS_GENERATION_ENABLED: process.env.MISSIONS_GENERATION_ENABLED !== 'false',
  GAME_AGENT_ENABLED: process.env.GAME_AGENT_ENABLED === 'true',

  GENERATE_DAILY_MISSIONS_ENABLED: process.env.GENERATE_DAILY_MISSIONS_ENABLED !== 'false',
  GENERATE_WEEKLY_MISSIONS_ENABLED: process.env.GENERATE_WEEKLY_MISSIONS_ENABLED !== 'false',

  // Cron schedules (missions + notifications)
  DAILY_MISSION_CRON_SCHEDULE: process.env.DAILY_MISSION_CRON_SCHEDULE || '5 6 * * *',
  WEEKLY_MISSION_CRON_SCHEDULE: process.env.WEEKLY_MISSION_CRON_SCHEDULE || '10 6 * * 1',
  NOTIFICATIONS_CRON_SCHEDULE: process.env.NOTIFICATIONS_CRON_SCHEDULE || '0 * * * *',
  FREE_PACKS_CRON_SCHEDULE: process.env.FREE_PACKS_CRON_SCHEDULE || '*/15 * * * *',
  CUSTOM_NOTIFICATIONS_CRON_SCHEDULE: process.env.CUSTOM_NOTIFICATIONS_CRON_SCHEDULE || '0 * * * *',
  DAILY_MISSIONS_NOTIFICATION_HOUR: parseInt(process.env.DAILY_MISSIONS_NOTIFICATION_HOUR || '20', 10),
  NOTIFICATIONS_MIN_HOUR: parseInt(process.env.NOTIFICATIONS_MIN_HOUR || '9', 10),
  NOTIFICATIONS_MAX_HOUR: parseInt(process.env.NOTIFICATIONS_MAX_HOUR || '21', 10),
  NOTIFICATIONS_DEBUG_WALLET: process.env.NOTIFICATIONS_DEBUG_WALLET || '',

  // Data API (notifications + legacy alias)
  DATA_API_URL: process.env.DATA_API_URL || process.env.FULL_GAME_API_URL?.replace(/\/api\/full-game$/, '') || 'https://jokers-of-neon-data.vercel.app',

  // Firebase (lazy init when NOTIFICATIONS_ENABLED)
  FIREBASE_CREDENTIALS_JSON: process.env.FIREBASE_CREDENTIALS_JSON || '',
  FIREBASE_CREDENTIALS_PATH: process.env.FIREBASE_CREDENTIALS_PATH || '',

  // Game agent
  BURNER_ACCOUNTS: process.env.BURNER_ACCOUNTS || '',
  INTERVAL_HOURS: parseInt(process.env.INTERVAL_HOURS || '13', 10),
  PLAYBACK_API_URL: process.env.PLAYBACK_API_URL || '',

};

function describeRpcEndpoint(rawUrl: string): string {
  if (!rawUrl) {
    return 'missing';
  }

  try {
    const url = new URL(rawUrl);
    const segments = url.pathname
      .split('/')
      .filter(Boolean)
    const [first, second] = segments;

    if (first === 'v2') {
      return `${url.hostname}/v2/[redacted]`;
    }

    if (first === 'starknet' && second === 'version') {
      return `${url.hostname}/starknet/version`;
    }

    if (first) {
      return `${url.hostname}/${first}${segments.length > 1 ? '/...' : ''}`;
    }

    return url.hostname;
  } catch {
    return rawUrl.length > 40 ? `${rawUrl.slice(0, 24)}...` : rawUrl;
  }
}

function logBackgroundRpcSelection(): void {
  const configuredBackgroundRpc = process.env.BACKGROUND_STARKNET_RPC_URL?.trim() || '';
  const configuredDefaultRpc = process.env.STARKNET_RPC_URL?.trim() || '';
  const source = configuredBackgroundRpc
    ? 'BACKGROUND_STARKNET_RPC_URL'
    : configuredDefaultRpc
      ? 'STARKNET_RPC_URL'
      : 'none';
  const mode = !env.BACKGROUND_STARKNET_RPC_URL
    ? 'missing'
    : configuredBackgroundRpc
      ? configuredBackgroundRpc === configuredDefaultRpc
        ? 'background-same-as-default'
        : 'dedicated-background'
      : 'default-fallback';

  console.log(
    `[env] starknet_rpc role=background mode=${mode} source=${source} endpoint=${describeRpcEndpoint(env.BACKGROUND_STARKNET_RPC_URL)}`
  );
}

// Validar configuración requerida
function validateConfig() {
  logBackgroundRpcSelection();

  // Multicall is explicitly selected and must fail visibly if its server-side
  // executor configuration is incomplete. Sequential can remain read-only.
  if (env.TRANSACTION_EXECUTION_MODE === 'multicall' || !env.READONLY_MODE) {
    const starknetRequired = env.TRANSACTION_EXECUTION_MODE === 'multicall'
      ? ['BACKGROUND_STARKNET_RPC_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'XP_SYSTEM_CONTRACT_ADDRESS', 'PROFILE_SYSTEM_CONTRACT_ADDRESS']
      : ['BACKGROUND_STARKNET_RPC_URL', 'STARKNET_PRIVATE_KEY', 'STARKNET_ADDRESS', 'XP_SYSTEM_CONTRACT_ADDRESS', 'PROFILE_SYSTEM_CONTRACT_ADDRESS'];
    const starknetMissing = starknetRequired.filter(key => !env[key as keyof typeof env]);

    if (starknetMissing.length > 0) {
      console.warn(`[env] starknet_write=disabled missing=${starknetMissing.join(',')}`);
    }
  }

  if (env.CELO_PRIVATE_KEY) {
    const celoRequired = ['CELO_RPC_URL'];
    const celoMissing = celoRequired.filter(key => !env[key as keyof typeof env]);

    if (celoMissing.length > 0) {
      console.warn(`[env] celo_write=disabled missing=${celoMissing.join(',')}`);
    }

    if (!env.CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS) {
      console.warn('[env] celo_profile_system=missing');
    }
  }

  if (env.MISSIONS_GENERATION_ENABLED) {
    const slotMissing = ['SLOT_MASTER_ADDRESS', 'SLOT_MASTER_PRIVATE_KEY'].filter(key => !env[key as keyof typeof env]);
    if (slotMissing.length > 0) {
      console.warn(`[env] slot_missions_write=disabled missing=${slotMissing.join(',')}`);
    }
  }
}

validateConfig();

export function hasStarknetTransactionExecutor(): boolean {
  if (!env.BACKGROUND_STARKNET_RPC_URL) {
    return false;
  }

  if (env.TRANSACTION_EXECUTION_MODE === 'multicall') {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  }

  return Boolean(env.STARKNET_ADDRESS && env.STARKNET_PRIVATE_KEY);
}

export function getWorkerBlockchainFilter(): BlockchainId[] | null {
  const values = env.WORKER_BLOCKCHAIN_FILTER
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (values.length === 0) {
    return null;
  }

  const invalid = values.filter(value => !isConfiguredBlockchain(value));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid WORKER_BLOCKCHAIN_FILTER value(s): ${invalid.join(', ')}. Supported values: ${formatConfiguredBlockchains()}`
    );
  }

  const parsed = values.filter(isConfiguredBlockchain);

  return Array.from(new Set(parsed));
}

export function isWorkerBlockchainEnabled(blockchain: BlockchainId): boolean {
  const filter = getWorkerBlockchainFilter();
  return !filter || filter.includes(blockchain);
}


export function resolveDataApiBaseUrl(): string {
  if (env.DATA_API_URL) {
    return env.DATA_API_URL.replace(/\/$/, '');
  }
  return 'https://jokers-of-neon-data.vercel.app';
}
