import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { CronJobDefinition, IntervalJobDefinition } from './types.js';

const DEFAULT_CRON_TIMEZONE = 'UTC';

export class JobScheduler {
  private cronTasks: ScheduledTask[] = [];
  private intervalHandles: ReturnType<typeof setInterval>[] = [];
  private runningCronJobs = new Set<string>();
  private runningIntervalJobs = new Set<string>();

  registerCronJobs(jobs: CronJobDefinition[]): void {
    for (const job of jobs) {
      if (!job.enabled) {
        console.log(`[scheduler] ${job.name}: disabled`);
        continue;
      }
      if (!cron.validate(job.schedule)) {
        console.error(`[scheduler] ${job.name}: invalid cron "${job.schedule}"`);
        continue;
      }
      const timezone = job.timezone ?? DEFAULT_CRON_TIMEZONE;
      const task = cron.schedule(job.schedule, () => void this.executeCronJob(job), {
        timezone,
      });
      this.cronTasks.push(task);
      console.log(`[scheduler] ${job.name}: ${job.schedule} (${timezone})`);
    }
  }

  private async executeCronJob(job: CronJobDefinition): Promise<void> {
    if (this.runningCronJobs.has(job.name)) {
      console.warn(`[scheduler] ${job.name}: skipped (already running)`);
      return;
    }

    this.runningCronJobs.add(job.name);
    try {
      await job.run();
    } catch (error) {
      console.error(`[scheduler] ${job.name} failed:`, error);
    } finally {
      this.runningCronJobs.delete(job.name);
    }
  }

  registerIntervalJob(job: IntervalJobDefinition): void {
    if (!job.enabled) {
      console.log(`[scheduler] ${job.name}: disabled`);
      return;
    }

    const execute = async () => {
      if (this.runningIntervalJobs.has(job.name)) {
        console.warn(`[scheduler] ${job.name}: skipped (already running)`);
        return;
      }
      this.runningIntervalJobs.add(job.name);
      try {
        await job.run();
      } catch (error) {
        console.error(`[scheduler] ${job.name} failed:`, error);
      } finally {
        this.runningIntervalJobs.delete(job.name);
      }
    };

    if (job.runOnStart) {
      void execute();
    }

    const handle = setInterval(() => void execute(), job.intervalMs);
    this.intervalHandles.push(handle);
    console.log(`[scheduler] ${job.name}: every ${job.intervalMs}ms`);
  }

  stop(): void {
    for (const task of this.cronTasks) {
      task.stop();
    }
    this.cronTasks = [];
    for (const handle of this.intervalHandles) {
      clearInterval(handle);
    }
    this.intervalHandles = [];
  }
}
