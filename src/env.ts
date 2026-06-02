import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { formatConfiguredBlockchains, isConfiguredBlockchain } from './config/chains.js';
import type { BlockchainId } from './transactionQueueTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: resolve(__dirname, '../.env') });

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
  WORKER_BLOCKCHAIN_FILTER: process.env.WORKER_BLOCKCHAIN_FILTER || '',

  // XP System Contract
  XP_SYSTEM_CONTRACT_ADDRESS: process.env.XP_SYSTEM_CONTRACT_ADDRESS || '',

  // Profile System Contract
  PROFILE_SYSTEM_CONTRACT_ADDRESS: process.env.PROFILE_SYSTEM_CONTRACT_ADDRESS || '',

  // Progression System Contract (Profile World - for syncing progression from core events)
  PROGRESSION_SYSTEM_CONTRACT_ADDRESS: process.env.PROGRESSION_SYSTEM_CONTRACT_ADDRESS || '',

  // Supabase Configuration (for persistent transaction queue)
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',

  // Game Data API
  FULL_GAME_API_URL: process.env.FULL_GAME_API_URL || 'https://jokers-of-neon-data.vercel.app/api/full-game',

  // Event Listener Mode
  // Si STARKNET_PRIVATE_KEY está configurado, ejecutará transacciones
  // Si no, solo escuchará eventos (modo solo lectura)
  READONLY_MODE: !(process.env.STARKNET_PRIVATE_KEY || process.env.PRIVATE_KEY),

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

// Validar configuración requerida
function validateConfig() {
  // Advertir si no está en modo solo lectura pero faltan configuraciones de Starknet
  if (!env.READONLY_MODE) {
    const starknetRequired = ['BACKGROUND_STARKNET_RPC_URL', 'STARKNET_PRIVATE_KEY', 'STARKNET_ADDRESS', 'XP_SYSTEM_CONTRACT_ADDRESS', 'PROFILE_SYSTEM_CONTRACT_ADDRESS'];
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
