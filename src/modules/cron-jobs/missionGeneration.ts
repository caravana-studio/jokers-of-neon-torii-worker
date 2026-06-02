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
    console.log('[missions] generate_daily=skipped reason=disabled_or_unconfigured');
    return;
  }

  await getTransactionQueue().enqueue({
    blockchain: 'slot',
    operation: 'missions.generate_daily',
    targetRef: 'daily_missions_system',
    payload: {},
    metadata: { source: 'cron' },
  });
  console.log('[missions] generate_daily=enqueued');
}

export async function enqueueGenerateWeeklyMissions(): Promise<void> {
  if (
    !env.MISSIONS_GENERATION_ENABLED ||
    !env.TRANSACTION_QUEUE_ENABLED ||
    !isWorkerBlockchainEnabled('slot') ||
    !env.SLOT_MASTER_ADDRESS ||
    !env.SLOT_MASTER_PRIVATE_KEY
  ) {
    console.log('[missions] generate_weekly=skipped reason=disabled_or_unconfigured');
    return;
  }

  await getTransactionQueue().enqueue({
    blockchain: 'slot',
    operation: 'missions.generate_weekly',
    targetRef: 'daily_missions_system',
    payload: {},
    metadata: { source: 'cron' },
  });
  console.log('[missions] generate_weekly=enqueued');
}
