import { env } from '../env.js';
import { getPackDistributionService } from '../services/packDistributionService.js';
import { PeriodType } from '../types/leaderboard.js';

interface CronJob {
  name: string;
  schedule: string; // cron expression: "minute hour dayOfMonth month dayOfWeek"
  type: PeriodType;
  enabled: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Parse a cron expression and get the next execution time
 * Supports standard 5-field cron format: minute hour dayOfMonth month dayOfWeek
 * Examples:
 *   "5 0 * * *" - 00:05 every day
 *   "10 0 * * 1" - 00:10 every Monday
 */
function getNextExecutionTime(cronExpr: string): Date | null {
  try {
    const parts = cronExpr.split(' ');
    if (parts.length !== 5) {
      console.error(`Invalid cron expression: ${cronExpr}`);
      return null;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const now = new Date();

    // Start from the next minute
    const next = new Date(now);
    next.setUTCSeconds(0);
    next.setUTCMilliseconds(0);
    next.setUTCMinutes(next.getUTCMinutes() + 1);

    // Try to find the next matching time (max 366 days ahead)
    for (let i = 0; i < 366 * 24 * 60; i++) {
      const matches =
        matchesCronField(minute, next.getUTCMinutes()) &&
        matchesCronField(hour, next.getUTCHours()) &&
        matchesCronField(dayOfMonth, next.getUTCDate()) &&
        matchesCronField(month, next.getUTCMonth() + 1) &&
        matchesCronField(dayOfWeek, next.getUTCDay());

      if (matches) {
        return next;
      }

      next.setUTCMinutes(next.getUTCMinutes() + 1);
    }

    return null;
  } catch (error) {
    console.error(`Error parsing cron expression:`, error);
    return null;
  }
}

/**
 * Check if a value matches a cron field
 * Supports: * (any), specific number, comma-separated list
 */
function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;

  // Handle comma-separated values
  if (field.includes(',')) {
    const values = field.split(',').map(Number);
    return values.includes(value);
  }

  // Handle ranges (e.g., "1-5")
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }

  // Handle step values (e.g., "*/5")
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = Number(step);
    if (range === '*') {
      return value % stepNum === 0;
    }
    // Handle range/step (e.g., "0-23/2")
    const [start] = range.split('-').map(Number);
    return (value - start) % stepNum === 0;
  }

  return Number(field) === value;
}

export class CronScheduler {
  private jobs: CronJob[] = [];
  private running = false;
  private packDistributionService = getPackDistributionService();

  constructor() {
    // Initialize jobs from environment config
    this.jobs = [
      {
        name: 'Daily Pack Distribution',
        schedule: env.DAILY_CRON_SCHEDULE,
        type: 'daily',
        enabled: env.PACK_DISTRIBUTION_ENABLED,
      },
      {
        name: 'Weekly Pack Distribution',
        schedule: env.WEEKLY_CRON_SCHEDULE,
        type: 'weekly',
        enabled: env.PACK_DISTRIBUTION_ENABLED,
      },
    ];
  }

  /**
   * Start the cron scheduler
   */
  start(): void {
    if (this.running) {
      console.log('⚠️  Cron scheduler already running');
      return;
    }

    this.running = true;
    console.log('\n⏰ Starting Cron Scheduler...');

    if (!env.PACK_DISTRIBUTION_ENABLED) {
      console.log('ℹ️  Pack distribution is disabled (PACK_DISTRIBUTION_ENABLED=false)');
      return;
    }

    for (const job of this.jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      } else {
        console.log(`   ❌ ${job.name}: Disabled`);
      }
    }

    console.log('');
  }

  /**
   * Stop the cron scheduler
   */
  stop(): void {
    if (!this.running) return;

    console.log('\n⏹️  Stopping Cron Scheduler...');

    for (const job of this.jobs) {
      if (job.timeoutId) {
        clearTimeout(job.timeoutId);
        job.timeoutId = undefined;
      }
    }

    this.running = false;
    console.log('✅ Cron Scheduler stopped');
  }

  /**
   * Schedule the next execution of a job
   */
  private scheduleJob(job: CronJob): void {
    const nextExecution = getNextExecutionTime(job.schedule);

    if (!nextExecution) {
      console.error(`❌ Could not schedule ${job.name}: Invalid cron expression`);
      return;
    }

    const msUntilExecution = nextExecution.getTime() - Date.now();
    const nextExecutionStr = nextExecution.toISOString();

    console.log(`   ⏰ ${job.name}:`);
    console.log(`      Schedule: ${job.schedule}`);
    console.log(`      Next run: ${nextExecutionStr}`);

    job.timeoutId = setTimeout(async () => {
      await this.executeJob(job);

      // Reschedule after execution
      if (this.running && job.enabled) {
        this.scheduleJob(job);
      }
    }, msUntilExecution);
  }

  /**
   * Execute a scheduled job
   */
  private async executeJob(job: CronJob): Promise<void> {
    console.log(`\n⏰ [${new Date().toISOString()}] Executing: ${job.name}`);
    console.log('═'.repeat(60));

    try {
      await this.packDistributionService.distributeRewards(job.type);
    } catch (error) {
      console.error(`❌ Error executing ${job.name}:`, error);
    }

    console.log('═'.repeat(60));
  }

  /**
   * Manually trigger a distribution (for testing)
   */
  async triggerDistribution(type: PeriodType): Promise<boolean> {
    console.log(`\n🔧 Manual trigger: ${type} distribution`);
    return this.packDistributionService.distributeRewards(type);
  }

  /**
   * Get the status of all scheduled jobs
   */
  getStatus(): Array<{ name: string; schedule: string; type: PeriodType; enabled: boolean; nextRun: string | null }> {
    return this.jobs.map(job => {
      const nextExecution = job.enabled ? getNextExecutionTime(job.schedule) : null;
      return {
        name: job.name,
        schedule: job.schedule,
        type: job.type,
        enabled: job.enabled,
        nextRun: nextExecution?.toISOString() || null,
      };
    });
  }
}

// Singleton instance
let cronSchedulerInstance: CronScheduler | null = null;

/**
 * Get or create the singleton cron scheduler instance
 */
export function getCronScheduler(): CronScheduler {
  if (!cronSchedulerInstance) {
    cronSchedulerInstance = new CronScheduler();
  }
  return cronSchedulerInstance;
}
