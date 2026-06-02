import type { CronJobDefinition } from '../../runtime/types.js';
import { env } from '../../env.js';
import { getPackDistributionService } from '../../services/packDistributionService.js';

export function getPackDistributionCronJobs(): CronJobDefinition[] {
  if (!env.PACK_DISTRIBUTION_ENABLED) {
    return [];
  }

  const service = getPackDistributionService();

  return [
    {
      name: 'Daily Pack Distribution',
      schedule: env.DAILY_CRON_SCHEDULE,
      enabled: true,
      run: async () => {
        await service.distributeRewards('daily');
      },
    },
    {
      name: 'Weekly Pack Distribution',
      schedule: env.WEEKLY_CRON_SCHEDULE,
      enabled: true,
      run: async () => {
        await service.distributeRewards('weekly');
      },
    },
  ];
}
