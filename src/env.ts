import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: resolve(__dirname, '../.env') });

export const env = {
  // Dojo Configuration (Required)
  TORII_URL: process.env.TORII_URL || '',
  RELAY_URL: process.env.RELAY_URL || '',
  WORLD_ADDRESS: process.env.WORLD_ADDRESS || '',

  // Starknet Configuration (Optional - for executing transactions)
  STARKNET_RPC_URL: process.env.STARKNET_RPC_URL || '',
  STARKNET_PRIVATE_KEY: process.env.STARKNET_PRIVATE_KEY || '',
  STARKNET_ADDRESS: process.env.STARKNET_ADDRESS || '',

  // XP System Contract
  XP_SYSTEM_CONTRACT_ADDRESS: process.env.XP_SYSTEM_CONTRACT_ADDRESS || '',

  // Game View Contract
  GAME_VIEW_CONTRACT_ADDRESS: process.env.GAME_VIEW_CONTRACT_ADDRESS || '',

  // Profile System Contract
  PROFILE_SYSTEM_CONTRACT_ADDRESS: process.env.PROFILE_SYSTEM_CONTRACT_ADDRESS || '',

  // Slot Network Configuration
  SLOT_RPC_URL: process.env.SLOT_RPC_URL || '',

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
  START_COUNTING_AT_GAME_ID: parseInt(process.env.START_COUNTING_AT_GAME_ID || '1000'),
  DAILY_CRON_SCHEDULE: process.env.DAILY_CRON_SCHEDULE || '5 0 * * *',   // 00:05 UTC daily
  WEEKLY_CRON_SCHEDULE: process.env.WEEKLY_CRON_SCHEDULE || '10 0 * * 1', // 00:10 UTC every Monday
};

// Validar configuración requerida
function validateConfig() {
  const required = ['TORII_URL', 'WORLD_ADDRESS'];
  const missing = required.filter(key => !env[key as keyof typeof env]);

  if (missing.length > 0) {
    throw new Error(`❌ Faltan variables de entorno requeridas: ${missing.join(', ')}`);
  }

  // Advertir si no está en modo solo lectura pero faltan configuraciones de Starknet
  if (!env.READONLY_MODE) {
    const starknetRequired = ['STARKNET_RPC_URL', 'STARKNET_ADDRESS', 'XP_SYSTEM_CONTRACT_ADDRESS', 'GAME_VIEW_CONTRACT_ADDRESS', 'PROFILE_SYSTEM_CONTRACT_ADDRESS'];
    const starknetMissing = starknetRequired.filter(key => !env[key as keyof typeof env]);

    if (starknetMissing.length > 0) {
      console.warn(`⚠️  Configuración de Starknet incompleta: ${starknetMissing.join(', ')}`);
      console.warn('⚠️  El bot funcionará en modo solo lectura');
    }
  }
}

validateConfig();
