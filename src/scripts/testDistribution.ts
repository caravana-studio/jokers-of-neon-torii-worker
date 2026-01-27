/**
 * Test script for manual pack distribution
 * Usage: bun run src/scripts/testDistribution.ts [daily|weekly]
 */

import { getCronScheduler } from '../cron/cronScheduler.js';
import { getTransactionQueue } from '../transactionQueue.js';
import { PeriodType } from '../types/leaderboard.js';

async function main() {
  const args = process.argv.slice(2);
  const periodType = args[0] as PeriodType;

  if (!periodType || !['daily', 'weekly'].includes(periodType)) {
    console.log('Usage: bun run src/scripts/testDistribution.ts [daily|weekly]');
    console.log('');
    console.log('Examples:');
    console.log('  bun run src/scripts/testDistribution.ts daily');
    console.log('  bun run src/scripts/testDistribution.ts weekly');
    process.exit(1);
  }

  console.log('🧪 Pack Distribution Test Script');
  console.log('═'.repeat(60));
  console.log(`Period Type: ${periodType}`);
  console.log('═'.repeat(60));
  console.log('');

  try {
    // Initialize transaction queue
    const txQueue = getTransactionQueue();
    await txQueue.initialize();

    // Get cron scheduler and trigger distribution
    const scheduler = getCronScheduler();
    const success = await scheduler.triggerDistribution(periodType);

    console.log('');
    console.log('═'.repeat(60));
    console.log(`Result: ${success ? '✅ Success' : '❌ Failed'}`);
    console.log('═'.repeat(60));

    // Show queue status
    const status = await txQueue.getStatus();
    console.log('');
    console.log('📊 Transaction Queue Status:');
    console.log(`   Pending:    ${status.pendingCount}`);
    console.log(`   Processing: ${status.processingCount}`);
    console.log(`   Completed:  ${status.completedCount}`);
    console.log(`   Failed:     ${status.failedCount}`);

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
