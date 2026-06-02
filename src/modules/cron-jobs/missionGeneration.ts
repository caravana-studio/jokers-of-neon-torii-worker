import { env, isWorkerBlockchainEnabled } from '../../env.js';
import { getTransactionQueue } from '../../transactionQueue.js';

export async function enqueueGenerateDailyMissions(): Promise<void> {
  if (
    !env.MISSIONS_GENERATION_ENABLED ||
    !env.TRANSACTION_QUEUE_ENABLED ||
    !isWorkerBlockchainEnabled('slot') ||
    !env.SLOT_MASTER_ADDRESS ||
    !env.SLOT_MASTER_PRIVATE_KEY
  ) {
    console.log('[GenerateDailyMissions] skipped (disabled, queue disabled, Slot filtered out, or missing Slot write config)');
    return;
  }

  await getTransactionQueue().enqueue({
    blockchain: 'slot',
    operation: 'missions.generate_daily',
    targetRef: 'daily_missions_system',
    payload: {},
    metadata: { source: 'cron' },
  });
  console.log('[GenerateDailyMissions] intent enqueued');
}

export async function enqueueGenerateWeeklyMissions(): Promise<void> {
  if (
    !env.MISSIONS_GENERATION_ENABLED ||
    !env.TRANSACTION_QUEUE_ENABLED ||
    !isWorkerBlockchainEnabled('slot') ||
    !env.SLOT_MASTER_ADDRESS ||
    !env.SLOT_MASTER_PRIVATE_KEY
  ) {
    console.log('[GenerateWeeklyMissions] skipped (disabled, queue disabled, Slot filtered out, or missing Slot write config)');
    return;
  }

  await getTransactionQueue().enqueue({
    blockchain: 'slot',
    operation: 'missions.generate_weekly',
    targetRef: 'daily_missions_system',
    payload: {},
    metadata: { source: 'cron' },
  });
  console.log('[GenerateWeeklyMissions] intent enqueued');
}
