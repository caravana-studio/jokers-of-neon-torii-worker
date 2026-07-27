import { supabase } from '../../config/supabase.js';
import { env } from '../../env.js';
import { getFirebaseAdmin } from '../firebase.js';
import type { PushDevice } from './types.js';

export const ARGENTINA_TIMEZONE = 'America/Argentina/Buenos_Aires';

export type PushNotificationResult = 'sent' | 'invalid_token' | 'temporary_failure';

type PushNotificationDependencies = {
  sendMessage: (message: {
    token: string;
    notification: { title: string; body: string };
  }) => Promise<unknown>;
  disableToken: (token: string) => Promise<void>;
  logger: Pick<Console, 'error' | 'info'>;
};

function getDefaultPushNotificationDependencies(): PushNotificationDependencies {
  return {
    sendMessage: message => getFirebaseAdmin().messaging().send(message),
    disableToken: async token => {
      const { error } = await supabase
        .from('push_devices')
        .update({ disabled: true })
        .eq('fcm_token', token)
        .eq('disabled', false);

      if (error) {
        throw error;
      }
    },
    logger: console,
  };
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const directCode = (error as { code?: unknown }).code;
  if (typeof directCode === 'string') {
    return directCode;
  }

  const errorInfo = (error as { errorInfo?: unknown }).errorInfo;
  if (errorInfo && typeof errorInfo === 'object') {
    const nestedCode = (errorInfo as { code?: unknown }).code;
    return typeof nestedCode === 'string' ? nestedCode : undefined;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}

function compactToken(token: string): string {
  if (token.length <= 12) {
    return '[redacted]';
  }
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function getSafeErrorSummary(error: unknown, token: string): string {
  const code = getErrorCode(error) ?? 'unknown';
  const rawMessage = getErrorMessage(error);
  const message = (token ? rawMessage.replaceAll(token, '[redacted]') : rawMessage).slice(0, 500);
  return `code=${code} message=${message}`;
}

function isInvalidRegistrationTokenError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  );
}

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  dependencies: PushNotificationDependencies = getDefaultPushNotificationDependencies()
): Promise<PushNotificationResult> {
  try {
    await dependencies.sendMessage({
      token: fcmToken,
      notification: { title, body },
    });
    return 'sent';
  } catch (error) {
    if (isInvalidRegistrationTokenError(error)) {
      try {
        await dependencies.disableToken(fcmToken);
        dependencies.logger.info(`[FCM] Disabled invalid token=${compactToken(fcmToken)}`);
      } catch (disableError) {
        dependencies.logger.error(
          `[FCM] Failed to disable invalid token=${compactToken(fcmToken)} ${getSafeErrorSummary(disableError, fcmToken)}`
        );
      }
      return 'invalid_token';
    }

    dependencies.logger.error(
      `[FCM] Push failed token=${compactToken(fcmToken)} ${getSafeErrorSummary(error, fcmToken)}`
    );
    return 'temporary_failure';
  }
}

export function getCurrentHourInTimezone(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch {
    return -1;
  }
}

export function getTodayInTimezone(timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function isWithinNotificationHours(currentHour: number): boolean {
  return currentHour >= env.NOTIFICATIONS_MIN_HOUR && currentHour < env.NOTIFICATIONS_MAX_HOUR;
}

export async function getEnabledDevices(): Promise<Pick<PushDevice, 'fcm_token' | 'wallet'>[]> {
  const { data, error } = await supabase
    .from('push_devices')
    .select('fcm_token, wallet')
    .eq('disabled', false);

  if (error) {
    throw error;
  }

  return (data ?? []) as Pick<PushDevice, 'fcm_token' | 'wallet'>[];
}

export async function hasNotificationBeenSent(
  wallet: string,
  notificationType: string,
  referenceId?: string
): Promise<boolean> {
  let query = supabase
    .from('notification_logs')
    .select('id')
    .eq('wallet', wallet)
    .eq('notification_type', notificationType);

  if (referenceId !== undefined) {
    query = query.eq('reference_id', referenceId);
  }

  const { data, error } = await query.limit(1);
  if (error) {
    console.error(`[Notifications] Error checking log for ${wallet}:`, error);
    return true;
  }

  return Boolean(data && data.length > 0);
}

export async function logNotificationSent(
  wallet: string,
  notificationType: string,
  referenceId?: string
): Promise<void> {
  const record: { wallet: string; notification_type: string; reference_id?: string } = {
    wallet,
    notification_type: notificationType,
  };
  if (referenceId !== undefined) {
    record.reference_id = referenceId;
  }

  const { error } = await supabase.from('notification_logs').insert(record);
  if (error) {
    console.error(`[Notifications] Error logging for ${wallet}:`, error);
  }
}
