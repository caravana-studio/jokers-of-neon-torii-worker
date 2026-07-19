import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  calculateEffectiveStreak,
  shouldReconcileDailyStreakRow,
} from './streakCacheService.js';

describe('daily streak cache race recovery', () => {
  test('keeps an active pending intent optimistic without reconciling over it', () => {
    assert.equal(
      shouldReconcileDailyStreakRow({
        syncStatus: 'pending',
        intentStatus: 'processing',
        updatedAt: '2026-07-19T00:00:00.000Z',
        now: Date.parse('2026-07-19T01:00:00.000Z'),
      }),
      false
    );
  });

  test('reconciles failed rows immediately and stale pending rows with terminal intents', () => {
    assert.equal(
      shouldReconcileDailyStreakRow({
        syncStatus: 'failed',
        intentStatus: 'pending',
        updatedAt: '2026-07-19T01:00:00.000Z',
        now: Date.parse('2026-07-19T01:00:01.000Z'),
      }),
      true
    );

    assert.equal(
      shouldReconcileDailyStreakRow({
        syncStatus: 'pending',
        intentStatus: 'completed',
        updatedAt: '2026-07-19T00:55:00.000Z',
        now: Date.parse('2026-07-19T01:00:00.000Z'),
      }),
      true
    );
  });

  test('does not reconcile a fresh pending row before its bounded stale window', () => {
    assert.equal(
      shouldReconcileDailyStreakRow({
        syncStatus: 'pending',
        intentStatus: 'completed',
        updatedAt: '2026-07-19T00:59:30.000Z',
        now: Date.parse('2026-07-19T01:00:00.000Z'),
      }),
      false
    );
  });

  test('calculates protector consumption before incrementing a recovered streak', () => {
    assert.deepEqual(
      calculateEffectiveStreak({
        currentStreak: 4,
        lastCompletedDay: 100,
        protectorsAvailable: 2,
        currentDay: 102,
      }),
      {
        daysMissed: 1,
        protectorsNeeded: 1,
        isProtected: true,
        isBroken: false,
        effectiveStreak: 4,
        protectorsAvailable: 1,
        lastCompletedDay: 101,
        protectorsUsed: 1,
      }
    );
  });
});
