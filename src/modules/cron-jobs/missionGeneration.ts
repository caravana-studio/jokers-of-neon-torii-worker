import { env } from '../../env.js';
import { getTransactionQueue } from '../../transactionQueue.js';

export async function enqueueGenerateDailyMissions(): Promise<void> {
  if (
    !env.MISSIONS_GENERATION_ENABLED ||
    env.READONLY_MODE ||
    !env.TRANSACTION_QUEUE_ENABLED ||
    !env.STARKNET_ADDRESS ||
    !env.STARKNET_RPC_URL
  ) {
    console.log('[GenerateDailyMissions] skipped (disabled, readonly, queue disabled, or missing Starknet config)');
    return;
  }

  await getTransactionQueue().enqueue({
    blockchain: 'starknet',
    operation: 'missions.generate_daily',
    payload: {},
    metadata: { source: 'cron' },
  });
  console.log('[GenerateDailyMissions] intent enqueued');
}

export async function enqueueGenerateWeeklyMissions(): Promise<void> {
  if (
    !env.MISSIONS_GENERATION_ENABLED ||
    env.READONLY_MODE ||
    !env.TRANSACTION_QUEUE_ENABLED ||
    !env.STARKNET_ADDRESS ||
    !env.STARKNET_RPC_URL
  ) {
    console.log('[GenerateWeeklyMissions] skipped (disabled, readonly, queue disabled, or missing Starknet config)');
    return;
  }

  await getTransactionQueue().enqueue({
    blockchain: 'starknet',
    operation: 'missions.generate_weekly',
    payload: {},
    metadata: { source: 'cron' },
  });
  console.log('[GenerateWeeklyMissions] intent enqueued');
}
