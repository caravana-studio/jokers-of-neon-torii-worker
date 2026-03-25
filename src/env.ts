import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: resolve(__dirname, '../.env') });

export const env = {
  // Slot Environment (controls which slot instance and manifest to load)
  MANIFEST_SLOT_ENV: process.env.MANIFEST_SLOT_ENV || 'dev',

  // Starknet Configuration (Optional - for executing transactions)
  STARKNET_RPC_URL: process.env.STARKNET_RPC_URL || '',
  STARKNET_RPC_API_KEY: process.env.STARKNET_RPC_API_KEY || '',
  STARKNET_PRIVATE_KEY: process.env.STARKNET_PRIVATE_KEY || '',
  STARKNET_ADDRESS: process.env.STARKNET_ADDRESS || '',

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
  READONLY_MODE: !process.env.STARKNET_PRIVATE_KEY,

  // Pack Distribution Configuration
  PACK_DISTRIBUTION_ENABLED: process.env.PACK_DISTRIBUTION_ENABLED === 'true',
  LEADERBOARD_GRAPHQL_URL: process.env.LEADERBOARD_GRAPHQL_URL || 'https://api.cartridge.gg/x/mainnet-jokers-profile/torii/graphql',
  GAME_STATS_API_URL: process.env.GAME_STATS_API_URL || '',
  GAME_STATS_API_KEY: process.env.GAME_STATS_API_KEY || '',
  DAILY_CRON_SCHEDULE: process.env.DAILY_CRON_SCHEDULE || '5 6 * * *',   // 06:05 UTC daily (after 6am UTC day boundary)
  WEEKLY_CRON_SCHEDULE: process.env.WEEKLY_CRON_SCHEDULE || '10 6 * * 1', // 06:10 UTC every Monday
};

// Validar configuración requerida
function validateConfig() {
  // Advertir si no está en modo solo lectura pero faltan configuraciones de Starknet
  if (!env.READONLY_MODE) {
    const starknetRequired = ['STARKNET_RPC_URL', 'STARKNET_ADDRESS', 'XP_SYSTEM_CONTRACT_ADDRESS', 'PROFILE_SYSTEM_CONTRACT_ADDRESS'];
    const starknetMissing = starknetRequired.filter(key => !env[key as keyof typeof env]);

    if (starknetMissing.length > 0) {
      console.warn(`⚠️  Configuración de Starknet incompleta: ${starknetMissing.join(', ')}`);
      console.warn('⚠️  El bot funcionará en modo solo lectura');
    }
  }
}

validateConfig();
