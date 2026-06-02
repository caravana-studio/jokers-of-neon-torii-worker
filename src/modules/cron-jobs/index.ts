import type { CronJobDefinition } from '../../runtime/types.js';
import { env, isWorkerBlockchainEnabled } from '../../env.js';
import { enqueueGenerateDailyMissions, enqueueGenerateWeeklyMissions } from './missionGeneration.js';
import { getMissionsReminderJob } from './missionsReminder.js';
import { getFreePacksJob } from './freePacks.js';
import { getCustomNotificationsJob } from './customNotifications.js';

export function getAllCronJobs(): CronJobDefinition[] {
  const jobs: CronJobDefinition[] = [];
  const missionGenerationEnabled =
    env.MISSIONS_GENERATION_ENABLED &&
    env.TRANSACTION_QUEUE_ENABLED &&
    isWorkerBlockchainEnabled('slot') &&
    Boolean(env.SLOT_MASTER_ADDRESS && env.SLOT_MASTER_PRIVATE_KEY);

  if (env.CRON_JOBS_ENABLED) {
    if (env.GENERATE_DAILY_MISSIONS_ENABLED) {
      jobs.push({
        name: 'Generate Daily Missions',
        schedule: env.DAILY_MISSION_CRON_SCHEDULE,
        enabled: missionGenerationEnabled,
        run: enqueueGenerateDailyMissions,
      });
    }

    if (env.GENERATE_WEEKLY_MISSIONS_ENABLED) {
      jobs.push({
        name: 'Generate Weekly Missions',
        schedule: env.WEEKLY_MISSION_CRON_SCHEDULE,
        enabled: missionGenerationEnabled,
        run: enqueueGenerateWeeklyMissions,
      });
    }

    if (env.NOTIFICATIONS_ENABLED) {
      jobs.push(getMissionsReminderJob(), getFreePacksJob(), getCustomNotificationsJob());
    }
  }

  return jobs;
}
