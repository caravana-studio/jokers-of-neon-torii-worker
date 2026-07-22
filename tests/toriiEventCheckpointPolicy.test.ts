import { describe, expect, test } from 'bun:test';
import {
  shouldLogEmptyCheckpointInitialization,
  shouldPersistToriiEventCheckpoint,
  shouldReplaceToriiEventCheckpoint,
  type ToriiEventCheckpointPosition,
} from '../src/services/toriiEventCheckpointPolicy.js';

const currentCheckpoint: ToriiEventCheckpointPosition = {
  lastEventId: 'event-1',
  lastCursor: 'cursor-1',
  lastExecutedAt: '2026-07-21T12:00:00.000Z',
};

describe('Torii event checkpoint policy', () => {
  test('suppresses empty checkpoint initialization logs during periodic polling', () => {
    expect(shouldLogEmptyCheckpointInitialization('periodic')).toBe(false);
    expect(shouldLogEmptyCheckpointInitialization('startup')).toBe(true);
  });

  test('advances a mutable event when the same id has a later executed_at', () => {
    expect(shouldReplaceToriiEventCheckpoint(currentCheckpoint, {
      ...currentCheckpoint,
      lastCursor: 'cursor-2',
      lastExecutedAt: '2026-07-21T12:00:01.000Z',
    })).toBe(true);
  });

  test('advances a mutable event when the same id and timestamp have a different cursor', () => {
    expect(shouldReplaceToriiEventCheckpoint(currentCheckpoint, {
      ...currentCheckpoint,
      lastCursor: 'cursor-2',
    })).toBe(true);
  });

  test('does not persist a live gRPC event without a GraphQL cursor', () => {
    expect(shouldPersistToriiEventCheckpoint('live', null)).toBe(false);
    expect(shouldPersistToriiEventCheckpoint('live', 'cursor-1')).toBe(true);
    expect(shouldPersistToriiEventCheckpoint('catchup', 'cursor-1')).toBe(true);
  });
});
