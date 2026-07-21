import { describe, expect, test } from 'bun:test';
import {
  ToriiCatchUpScheduler,
  type ToriiCatchUpRetryDetails,
  type ToriiCatchUpTimerApi,
} from '../src/services/toriiCatchUpScheduler.js';

class FakeTimers implements ToriiCatchUpTimerApi {
  private nextId = 1;
  private readonly tasks = new Map<number, { callback: () => void; delayMs: number }>();

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(timer: unknown): void {
    this.tasks.delete(timer as number);
  }

  pendingDelays(): number[] {
    return [...this.tasks.values()].map(task => task.delayMs).sort((a, b) => a - b);
  }

  runNext(): void {
    const nextEntry = [...this.tasks.entries()]
      .sort(([, left], [, right]) => left.delayMs - right.delayMs)[0];
    if (!nextEntry) {
      throw new Error('No timer is pending');
    }

    const [id, task] = nextEntry;
    this.tasks.delete(id);
    task.callback();
  }
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('ToriiCatchUpScheduler', () => {
  test('uses exponential retries without scheduling periodic polling during backoff', async () => {
    const timers = new FakeTimers();
    const calls: string[] = [];
    const retries: ToriiCatchUpRetryDetails[] = [];
    const scheduler = new ToriiCatchUpScheduler({
      timers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async reason => {
        calls.push(reason);
        throw new Error('Torii unavailable');
      },
      onRetryScheduled: details => retries.push(details),
    });

    scheduler.start();
    expect(timers.pendingDelays()).toEqual([2_000]);

    timers.runNext();
    await flushAsyncWork();

    expect(calls).toEqual(['periodic']);
    expect(retries.map(({ attempt, delayMs }) => ({ attempt, delayMs }))).toEqual([
      { attempt: 1, delayMs: 2_000 },
    ]);
    expect(timers.pendingDelays()).toEqual([2_000]);

    timers.runNext();
    await flushAsyncWork();

    expect(calls).toEqual(['periodic', 'retry_periodic']);
    expect(retries.map(({ attempt, delayMs }) => ({ attempt, delayMs }))).toEqual([
      { attempt: 1, delayMs: 2_000 },
      { attempt: 2, delayMs: 4_000 },
    ]);
    expect(timers.pendingDelays()).toEqual([4_000]);
  });

  test('resumes 2-second periodic polling after a successful retry', async () => {
    const timers = new FakeTimers();
    const calls: string[] = [];
    const scheduler = new ToriiCatchUpScheduler({
      timers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async reason => {
        calls.push(reason);
        if (calls.length === 1) {
          throw new Error('Temporary failure');
        }
      },
    });

    scheduler.start();
    timers.runNext();
    await flushAsyncWork();
    timers.runNext();
    await flushAsyncWork();

    expect(calls).toEqual(['periodic', 'retry_periodic']);
    expect(timers.pendingDelays()).toEqual([2_000]);
  });

  test('defers reconnect catch-up while exponential backoff is pending', async () => {
    const timers = new FakeTimers();
    const calls: string[] = [];
    const scheduler = new ToriiCatchUpScheduler({
      timers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async reason => {
        calls.push(reason);
        throw new Error('Torii unavailable');
      },
    });

    scheduler.scheduleRetry('periodic', new Error('Initial failure'));
    timers.runNext();
    await flushAsyncWork();

    expect(calls).toEqual(['retry_periodic']);
    expect(timers.pendingDelays()).toEqual([4_000]);

    const started = await scheduler.requestCatchUp('reconnect_stream_error');

    expect(started).toBe(false);
    expect(calls).toEqual(['retry_periodic']);
    expect(timers.pendingDelays()).toEqual([4_000]);
  });

  test('schedules recovery when an immediate startup catch-up fails', async () => {
    const timers = new FakeTimers();
    const calls: string[] = [];
    const scheduler = new ToriiCatchUpScheduler({
      timers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async reason => {
        calls.push(reason);
        if (calls.length === 1) {
          throw new Error('Startup catch-up failed');
        }
      },
    });

    await expect(scheduler.requestCatchUp('startup')).rejects.toThrow('Startup catch-up failed');
    expect(timers.pendingDelays()).toEqual([2_000]);

    timers.runNext();
    await flushAsyncWork();

    expect(calls).toEqual(['startup', 'retry_startup']);
    expect(timers.pendingDelays()).toEqual([2_000]);
  });

  test('keeps scheduling when observability hooks throw', async () => {
    const timers = new FakeTimers();
    const scheduler = new ToriiCatchUpScheduler({
      timers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async () => {
        throw new Error('Torii unavailable');
      },
      onPeriodicFailure: () => {
        throw new Error('Periodic observer failed');
      },
      onRetryScheduled: () => {
        throw new Error('Retry scheduled observer failed');
      },
      onRetryFailure: () => {
        throw new Error('Retry observer failed');
      },
    });

    scheduler.start();
    timers.runNext();
    await flushAsyncWork();
    expect(timers.pendingDelays()).toEqual([2_000]);

    timers.runNext();
    await flushAsyncWork();
    expect(timers.pendingDelays()).toEqual([4_000]);
  });

  test('clears periodic and retry timers when stopped', () => {
    const periodicTimers = new FakeTimers();
    const periodicScheduler = new ToriiCatchUpScheduler({
      timers: periodicTimers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async () => undefined,
    });

    periodicScheduler.start();
    periodicScheduler.stop();
    expect(periodicTimers.pendingDelays()).toEqual([]);

    const retryTimers = new FakeTimers();
    const retryScheduler = new ToriiCatchUpScheduler({
      timers: retryTimers,
      periodicIntervalMs: 2_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      runCatchUp: async () => undefined,
    });

    retryScheduler.scheduleRetry('test', new Error('failure'));
    retryScheduler.stop();
    expect(retryTimers.pendingDelays()).toEqual([]);
  });
});
