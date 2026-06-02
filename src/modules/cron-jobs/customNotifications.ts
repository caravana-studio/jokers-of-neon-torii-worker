import { supabase } from '../../config/supabase.js';
import { TimingMode } from '../../platform/notifications/types.js';
import type { CronJobDefinition } from '../../runtime/types.js';
import { env } from '../../env.js';
import {
    sendPushNotification,
    getCurrentHourInTimezone,
    isWithinNotificationHours,
    getEnabledDevices,
    getTodayInTimezone,
    ARGENTINA_TIMEZONE
} from '../../platform/notifications/fcm.js';

interface LocalizedMessage {
    title: string;
    body: string;
}

interface CustomNotification {
    id: string;
    notification_type: 'push_reminders_enabled' | 'push_events_enabled';
    scheduled_date: string;
    scheduled_hour: number;
    messages: Record<string, LocalizedMessage>;
    active: boolean;
    timing_mode?: TimingMode;
}

function getLocalizedMessage(messages: Record<string, LocalizedMessage>, language: string): LocalizedMessage {
    return messages[language] || messages['en'] || Object.values(messages)[0] || { title: '', body: '' };
}

async function sendCustomNotifications(): Promise<void> {
    try {
        console.log('[CustomNotifications] Ejecutando...');

        const { data: notifications, error: notifError } = await supabase
            .from('custom_notifications')
            .select('*')
            .eq('active', true);

        if (notifError) throw notifError;

        if (!notifications || notifications.length === 0) {
            console.log('[CustomNotifications] No hay notificaciones activas');
            return;
        }

        console.log(`[CustomNotifications] ${notifications.length} notificaciones activas`);

        // Pre-calculate Argentina time once
        const argentinaHour = getCurrentHourInTimezone(ARGENTINA_TIMEZONE);
        const argentinaToday = getTodayInTimezone(ARGENTINA_TIMEZONE);

        // Filter global notifications that match Argentina time
        const allNotifications = notifications as CustomNotification[];
        const globalNotifications = allNotifications.filter(n => {
            const isGlobal = n.timing_mode === 'global';
            if (!isGlobal) return false;
            return n.scheduled_date === argentinaToday && n.scheduled_hour === argentinaHour;
        });
        const localNotifications = allNotifications.filter(n => n.timing_mode !== 'global');

        console.log(`[CustomNotifications] ${globalNotifications.length} global, ${localNotifications.length} local`);

        const devices = await getEnabledDevices();
        let notifiedCount = 0;

        // Process global notifications (send to all users who have the preference enabled)
        for (const notification of globalNotifications) {
            for (const device of devices) {
                try {
                    const { data: userPrefs, error: userError } = await supabase
                        .from('user_preferences')
                        .select('push_reminders_enabled, push_events_enabled, language')
                        .eq('wallet', device.wallet)
                        .single();

                    if (userError || !userPrefs) continue;

                    const prefEnabled = (userPrefs as Record<string, unknown>)[notification.notification_type];
                    if (!prefEnabled) continue;

                    const { title, body } = getLocalizedMessage(notification.messages, userPrefs.language);
                    const sent = await sendPushNotification(device.fcm_token, title, body);

                    if (sent) {
                        notifiedCount++;
                        console.log(`[CustomNotifications] [global] Enviado a ${device.wallet}: ${title}`);
                    }
                } catch (fetchError) {
                    console.error(`[CustomNotifications] Error processing ${device.wallet}:`, fetchError);
                }
            }
        }

        // Process local notifications (original behavior - check user's timezone)
        for (const notification of localNotifications) {
            for (const device of devices) {
                try {
                    const { data: userPrefs, error: userError } = await supabase
                        .from('user_preferences')
                        .select('push_reminders_enabled, push_events_enabled, timezone, language')
                        .eq('wallet', device.wallet)
                        .single();

                    if (userError || !userPrefs) continue;

                    const prefEnabled = (userPrefs as Record<string, unknown>)[notification.notification_type];
                    if (!prefEnabled) continue;

                    const userTimezone = userPrefs.timezone;
                    const currentHour = getCurrentHourInTimezone(userTimezone);
                    const userToday = getTodayInTimezone(userTimezone);

                    if (!isWithinNotificationHours(currentHour)) continue;
                    if (userToday !== notification.scheduled_date) continue;
                    if (currentHour !== notification.scheduled_hour) continue;

                    const { title, body } = getLocalizedMessage(notification.messages, userPrefs.language);
                    const sent = await sendPushNotification(device.fcm_token, title, body);

                    if (sent) {
                        notifiedCount++;
                        console.log(`[CustomNotifications] [local] Enviado a ${device.wallet}: ${title}`);
                    }
                } catch (fetchError) {
                    console.error(`[CustomNotifications] Error processing ${device.wallet}:`, fetchError);
                }
            }
        }

        console.log(`[CustomNotifications] ${notifiedCount} notificaciones enviadas`);
    } catch (error) {
        console.error('[CustomNotifications] Error:', error);
    }
}

export function getCustomNotificationsJob(): CronJobDefinition {
  return {
    name: 'Custom Notifications',
    schedule: env.CUSTOM_NOTIFICATIONS_CRON_SCHEDULE,
    enabled: env.NOTIFICATIONS_ENABLED,
    run: sendCustomNotifications,
  };
}
