export type StreakMaintenanceRange = {
  startDay: number;
  endDay: number;
};

function parseDay(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getConfiguredStreakMaintenanceRange(
  environment: NodeJS.ProcessEnv = process.env
): StreakMaintenanceRange | null {
  const startDay = parseDay(environment.STREAK_MAINTENANCE_START_DAY);
  const endDay = parseDay(environment.STREAK_MAINTENANCE_END_DAY);

  if (startDay === null || endDay === null || endDay < startDay) {
    return null;
  }

  return { startDay, endDay };
}

export function countMaintenanceDaysInGap(input: {
  lastCompletedDay: number;
  currentDay: number;
  range?: StreakMaintenanceRange | null;
}): number {
  const range = input.range === undefined ? getConfiguredStreakMaintenanceRange() : input.range;
  if (!range || input.currentDay <= input.lastCompletedDay + 1) {
    return 0;
  }

  const firstMissedDay = input.lastCompletedDay + 1;
  const lastMissedDay = input.currentDay - 1;
  const overlapStart = Math.max(firstMissedDay, range.startDay);
  const overlapEnd = Math.min(lastMissedDay, range.endDay);

  return Math.max(0, overlapEnd - overlapStart + 1);
}
