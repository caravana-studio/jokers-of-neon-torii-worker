import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getMissionCompletedIdempotencyKey } from './blockchainEventHandlers.js';
import { deriveIntentId } from './transactionQueue.js';
import type { MissionCompletedEventData } from './blockchainEventHandlers.js';
import type { EnqueueTransactionParams } from './transactionQueueTypes.js';

function missionEvent(
  overrides: Partial<MissionCompletedEventData> = {}
): MissionCompletedEventData {
  return {
    player: '0x1',
    periodType: 'daily',
    periodTypeId: 1,
    periodId: 100,
    missionId: 'daily-play-hand',
    templateId: 'daily-play-hand',
    difficulty: 1,
    target: 1,
    progress: 1,
    xp: 10,
    gameId: 15054,
    ...overrides,
  };
}

function intent(idempotencyKey: string): EnqueueTransactionParams {
  return {
    blockchain: 'starknet',
    operation: 'xp.mission_completed',
    targetRef: 'xp_system',
    idempotencyKey,
    payload: {},
  };
}

describe('transaction intent idempotency', () => {
  test('derives the same durable intent id for a replayed mission event', () => {
    const firstKey = getMissionCompletedIdempotencyKey(missionEvent());
    const replayKey = getMissionCompletedIdempotencyKey(
      missionEvent({
        player: '0x0000000000000000000000000000000000000000000000000000000000000001',
      })
    );

    assert.equal(firstKey, replayKey);
    assert.equal(deriveIntentId(intent(firstKey)), deriveIntentId(intent(replayKey)));
  });

  test('does not collapse distinct mission completions', () => {
    const first = deriveIntentId(
      intent(getMissionCompletedIdempotencyKey(missionEvent()))
    );
    const nextPeriod = deriveIntentId(
      intent(getMissionCompletedIdempotencyKey(missionEvent({ periodId: 101 })))
    );
    const otherMission = deriveIntentId(
      intent(
        getMissionCompletedIdempotencyKey(
          missionEvent({ missionId: 'daily-win-game', templateId: 'daily-win-game' })
        )
      )
    );

    assert.notEqual(first, nextPeriod);
    assert.notEqual(first, otherMission);
  });
});
