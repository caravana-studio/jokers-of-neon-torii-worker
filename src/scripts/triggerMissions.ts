import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { preloadSlotConfig } from '../config/slotConfig.js';
import { preloadSlotManifest } from '../config/manifest.js';
import { getTransactionQueue } from '../transactionQueue.js';
import { env } from '../env.js';
import {
  enqueueGenerateDailyMissions,
  enqueueGenerateWeeklyMissions,
} from '../modules/cron-jobs/missionGeneration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

const QUEUE_DRAIN_MS = 5000;

async function main(): Promise<void> {
  const mode = process.argv[2]?.toLowerCase();

  if (mode && mode !== 'daily' && mode !== 'weekly' && mode !== 'both') {
    console.error('Usage: bun run trigger-missions [daily|weekly|both]');
    process.exit(1);
  }

  if (!env.SLOT_MASTER_ADDRESS || !env.SLOT_MASTER_PRIVATE_KEY) {
    console.error('Set SLOT_MASTER_ADDRESS and SLOT_MASTER_PRIVATE_KEY to enqueue mission intents.');
    process.exit(1);
  }

  if (!env.TRANSACTION_QUEUE_ENABLED) {
    console.error('Set TRANSACTION_QUEUE_ENABLED=true to enqueue mission intents.');
    process.exit(1);
  }

  console.log('🔌 Loading slot config and manifest...');
  await preloadSlotConfig();
  await preloadSlotManifest();

  await getTransactionQueue().initialize();

  if (mode === 'daily') {
    await enqueueGenerateDailyMissions();
  } else if (mode === 'weekly') {
    await enqueueGenerateWeeklyMissions();
  } else {
    await enqueueGenerateDailyMissions();
    await enqueueGenerateWeeklyMissions();
  }

  console.log(`⏳ Waiting ${QUEUE_DRAIN_MS / 1000}s for queue processor...`);
  await new Promise(resolve => setTimeout(resolve, QUEUE_DRAIN_MS));
  console.log('✅ Done (check torii_worker_intent_queue / logs for completion).');
}

main().catch(error => {
  console.error('❌ trigger-missions failed:', error);
  process.exit(1);
});
