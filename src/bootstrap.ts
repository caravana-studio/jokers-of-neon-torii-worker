import { env } from './env.js';
import { preloadSlotConfig } from './config/slotConfig.js';
import { preloadSlotManifest } from './config/manifest.js';
import { getTransactionQueue } from './transactionQueue.js';
import { JobScheduler } from './runtime/JobScheduler.js';
import { initFirebaseIfNeeded } from './platform/firebase.js';
import { getAllCronJobs } from './modules/cron-jobs/index.js';
import { getPackDistributionCronJobs } from './modules/packs/packDistributionJobs.js';
import { startToriiWorker } from './main.js';
import { startGameAgentModule, stopGameAgentModule } from './modules/agent/GameAgentModule.js';

let scheduler: JobScheduler | null = null;
let stopTorii: (() => void) | null = null;

export async function bootstrap(): Promise<void> {
  console.log('🚀 Jokers of Neon — Unified Worker');
  console.log('═'.repeat(60));
  console.log(`Slot Env: ${env.MANIFEST_SLOT_ENV}`);
  console.log(`Torii: ${env.TORII_LISTENER_ENABLED} | Queue: ${env.TRANSACTION_QUEUE_ENABLED}`);
  console.log(`Cron: ${env.CRON_JOBS_ENABLED} | Notifications: ${env.NOTIFICATIONS_ENABLED}`);
  console.log(`Missions: ${env.MISSIONS_GENERATION_ENABLED} | Packs: ${env.PACK_DISTRIBUTION_ENABLED}`);
  console.log(`Agent: ${env.GAME_AGENT_ENABLED}`);
  console.log('═'.repeat(60));

  console.log('\n🔌 Loading remote Slot config and manifest...');
  await preloadSlotConfig();
  await preloadSlotManifest();

  if (env.NOTIFICATIONS_ENABLED) {
    initFirebaseIfNeeded();
  }

  if (env.TRANSACTION_QUEUE_ENABLED) {
    await getTransactionQueue().initialize();
  } else {
    console.log('ℹ️  Transaction queue disabled (TRANSACTION_QUEUE_ENABLED=false)');
  }

  scheduler = new JobScheduler();

  if (env.TORII_LISTENER_ENABLED) {
    stopTorii = await startToriiWorker();
  } else {
    console.log('ℹ️  Torii listener disabled (TORII_LISTENER_ENABLED=false)');
    console.log('👂 Process staying alive for scheduled jobs...\n');
  }

  scheduler.registerCronJobs([
    ...getPackDistributionCronJobs(),
    ...getAllCronJobs(),
  ]);

  if (env.GAME_AGENT_ENABLED) {
    await startGameAgentModule();
  }
}

export async function shutdown(): Promise<void> {
  await stopGameAgentModule();
  scheduler?.stop();
  stopTorii?.();
  stopTorii = null;
}
