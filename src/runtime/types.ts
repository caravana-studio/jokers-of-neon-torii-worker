export interface CronJobDefinition {
  name: string;
  schedule: string;
  enabled: boolean;
  timezone?: string;
  run: () => Promise<void> | void;
}

export interface IntervalJobDefinition {
  name: string;
  intervalMs: number;
  runOnStart: boolean;
  enabled: boolean;
  run: () => Promise<void> | void;
}

export interface WorkerModule {
  readonly id: string;
  isEnabled(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}
