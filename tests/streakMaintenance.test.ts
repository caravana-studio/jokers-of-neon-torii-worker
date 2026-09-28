import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countMaintenanceDaysInGap,
  getConfiguredStreakMaintenanceRange,
} from '../src/utils/streakMaintenance.js';

test('parses a valid inclusive maintenance range', () => {
  assert.deepEqual(
    getConfiguredStreakMaintenanceRange({
      STREAK_MAINTENANCE_START_DAY: '20714',
      STREAK_MAINTENANCE_END_DAY: '20724',
    }),
    { startDay: 20714, endDay: 20724 }
  );
});

test('ignores invalid maintenance configuration', () => {
  assert.equal(
    getConfiguredStreakMaintenanceRange({
      STREAK_MAINTENANCE_START_DAY: '20724',
      STREAK_MAINTENANCE_END_DAY: '20714',
    }),
    null
  );
});

test('counts only maintenance days inside the missed-day gap', () => {
  assert.equal(
    countMaintenanceDaysInGap({
      lastCompletedDay: 20712,
      currentDay: 20725,
      range: { startDay: 20714, endDay: 20724 },
    }),
    11
  );
});
