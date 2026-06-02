import { supabase } from '../../config/supabase.js';
import { env } from '../../env.js';
import { getFirebaseAdmin } from '../firebase.js';
import type { PushDevice } from './types.js';

export const ARGENTINA_TIMEZONE = 'America/Argentina/Buenos_Aires';

export async function sendPushNotification(fcmToken: string, title: string, body: string): Promise<boolean> {
  try {
    const admin = getFirebaseAdmin();
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
    });
    return true;
  } catch (error) {
    console.error(`[FCM] Error sending to ${fcmToken}:`, error);
    return false;
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
