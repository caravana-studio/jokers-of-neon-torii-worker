export interface ToriiCatchUpTimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface ToriiCatchUpRetryDetails {
  reason: string;
  attempt: number;
  delayMs: number;
  error: unknown;
}

export interface ToriiCatchUpSchedulerOptions {
  runCatchUp: (reason: string) => Promise<void>;
  periodicIntervalMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  onPeriodicFailure?: (error: unknown) => void;
  onRetryScheduled?: (details: ToriiCatchUpRetryDetails) => void;
  onRetryFailure?: (reason: string, error: unknown) => void;
  timers?: ToriiCatchUpTimerApi;
}

const systemTimers: ToriiCatchUpTimerApi = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class ToriiCatchUpScheduler {
  private readonly options: ToriiCatchUpSchedulerOptions;
  private readonly timers: ToriiCatchUpTimerApi;
  private periodicTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryAttempt = 0;
  private stopped = false;

  constructor(options: ToriiCatchUpSchedulerOptions) {
    this.options = options;
    this.timers = options.timers ?? systemTimers;
  }

  start(): void {
    this.schedulePeriodic();
  }

  async requestCatchUp(reason: string): Promise<boolean> {
    if (this.stopped || this.retryTimer !== null) {
      return false;
    }

    try {
      await this.options.runCatchUp(reason);
      this.markCatchUpSucceeded();
      return true;
    } catch (error) {
      this.scheduleRetry(reason, error);
      throw error;
    }
  }

  private markCatchUpSucceeded(): void {
    this.retryAttempt = 0;
    this.clearRetryTimer();
    this.schedulePeriodic();
  }

  scheduleRetry(reason: string, error: unknown): void {
    if (this.stopped || this.retryTimer !== null) {
      return;
    }

    // A retry owns reconciliation scheduling until it succeeds. Leaving a
    // periodic timer active here would let the 2-second poll cancel the
    // exponential backoff during an outage.
    this.clearPeriodicTimer();

    this.retryAttempt += 1;
    const delayMs = Math.min(
      this.options.retryBaseDelayMs * 2 ** Math.min(this.retryAttempt - 1, 10),
      this.options.retryMaxDelayMs
    );

    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.runRetry(reason);
    }, delayMs);

    this.notify(() => this.options.onRetryScheduled?.({
      reason,
      attempt: this.retryAttempt,
      delayMs,
      error,
    }));
  }

  stop(): void {
    this.stopped = true;
    this.clearPeriodicTimer();
    this.clearRetryTimer();
  }

  private schedulePeriodic(): void {
    if (this.stopped || this.periodicTimer !== null || this.retryTimer !== null) {
      return;
    }

    this.periodicTimer = this.timers.setTimeout(() => {
      this.periodicTimer = null;
      void this.runPeriodic();
    }, this.options.periodicIntervalMs);
  }

  private async runPeriodic(): Promise<void> {
    try {
      await this.options.runCatchUp('periodic');
      this.markCatchUpSucceeded();
    } catch (error) {
      this.notify(() => this.options.onPeriodicFailure?.(error));
      this.scheduleRetry('periodic', error);
    }
  }

  private async runRetry(reason: string): Promise<void> {
    try {
      await this.options.runCatchUp(`retry_${reason}`);
      this.markCatchUpSucceeded();
    } catch (error) {
      this.notify(() => this.options.onRetryFailure?.(reason, error));
      this.scheduleRetry(reason, error);
    }
  }

  private notify(callback: () => void): void {
    try {
      callback();
    } catch {
      // Observability callbacks must never alter reconciliation scheduling.
    }
  }

  private clearPeriodicTimer(): void {
    if (this.periodicTimer === null) {
      return;
    }

    this.timers.clearTimeout(this.periodicTimer);
    this.periodicTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) {
      return;
    }

    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
