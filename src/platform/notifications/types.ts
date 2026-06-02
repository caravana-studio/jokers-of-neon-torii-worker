export interface CronTask {
  name: string;
  schedule: string;
  func: () => Promise<void> | void;
}

export interface UserPreferences {
  wallet: string;
  push_daily_missions_enabled: boolean;
  push_reminders_enabled: boolean;
  push_events_enabled: boolean;
  push_daily_packs_enabled: boolean;
  timezone: string;
  language: string;
}

export interface Mission {
  player: string;
  day: number;
  mission_id: string;
  completed: boolean;
}

export interface DailyMissionsResponse {
  player: string;
  missions: Mission[];
}

export interface PushDevice {
  fcm_token: string;
  wallet: string;
}

export interface NotificationMessage {
  title: string;
  body: string;
}

export interface FreePackResponse {
  recipient: string;
  next_free_pack_timestamp: number;
}

export type TimingMode = 'local' | 'global';
