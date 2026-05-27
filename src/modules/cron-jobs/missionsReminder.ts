import { supabase } from '../../config/supabase.js';
import { DailyMissionsResponse, NotificationMessage } from '../../platform/notifications/types.js';
import type { CronJobDefinition } from '../../runtime/types.js';
import { env, resolveDataApiBaseUrl } from '../../env.js';
import { sendPushNotification, getCurrentHourInTimezone, getEnabledDevices } from '../../platform/notifications/fcm.js';

const NOTIFICATION_HOUR = env.DAILY_MISSIONS_NOTIFICATION_HOUR;

const DEBUG_WALLET = env.NOTIFICATIONS_DEBUG_WALLET;

function normalizeWallet(wallet: string): string {
    if (!wallet) return '';
    const lower = wallet.toLowerCase().trim();
    const noPrefix = lower.startsWith('0x') ? lower.slice(2) : lower;
    return '0x' + noPrefix.replace(/^0+/, '').padStart(1, '0');
}

function isDebugWallet(wallet: string): boolean {
    if (!DEBUG_WALLET) return false;
    return normalizeWallet(wallet) === normalizeWallet(DEBUG_WALLET);
}

function getHoursUntilReset(): number {
    const now = new Date();
    const argentinaFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: 'numeric',
        hour12: false
    });
    const currentHourArgentina = parseInt(argentinaFormatter.format(now), 10);

    // Reset is at 3am Argentina time
    if (currentHourArgentina >= 3) {
        return 24 - currentHourArgentina + 3;
    }
    return 3 - currentHourArgentina;
}

function getLocalizedMessage(language: string, pendingCount: number, hoursRemaining: number): NotificationMessage {
    const messages: Record<string, NotificationMessage> = {
        es: {
            title: '⏳ ¡Última llamada!',
            body: `Aún te esperan ${pendingCount} misiones diarias. Tenés ${hoursRemaining} horas para completarlas.`
        },
        en: {
            title: '⏳ Last call!',
            body: `You still have ${pendingCount} daily missions waiting. You have ${hoursRemaining} hours to complete them.`
        },
        pt: {
            title: '⏳ Última chamada!',
            body: `Ainda há ${pendingCount} missões diárias esperando por você. Restam ${hoursRemaining} horas para completá-las.`
        }
    };

    return messages[language] || messages['en'];
}

async function sendMissionsReminder(): Promise<void> {
    try {
        console.log('[MissionsReminder] Ejecutando...');

        const devices = await getEnabledDevices();
        const apiUrl = `${resolveDataApiBaseUrl()}/api/daily-missions`;
        let notifiedCount = 0;

        if (DEBUG_WALLET) {
            const debugDevices = devices.filter(d => isDebugWallet(d.wallet));
            console.log(`[MissionsReminder][DEBUG] DEBUG_WALLET=${DEBUG_WALLET}`);
            console.log(`[MissionsReminder][DEBUG] total devices=${devices.length}, matching debug=${debugDevices.length}`);
            debugDevices.forEach((d, i) => {
                console.log(`[MissionsReminder][DEBUG] match[${i}] wallet=${d.wallet} fcm_token=${d.fcm_token?.slice(0, 12)}...`);
            });
        }

        for (const device of devices) {
            const debug = isDebugWallet(device.wallet);
            try {
                const { data: userPrefs, error: userError } = await supabase
                    .from('user_preferences')
                    .select('push_reminders_enabled, timezone, language')
                    .eq('wallet', device.wallet)
                    .single();

                if (debug) {
                    console.log(`[MissionsReminder][DEBUG] supabase user_preferences for ${device.wallet}:`, { userError, userPrefs });
                }

                if (userError || !userPrefs) {
                    if (debug) console.log(`[MissionsReminder][DEBUG] SKIP: no userPrefs (${userError?.message ?? 'null'})`);
                    continue;
                }
                if (!userPrefs.push_reminders_enabled) {
                    if (debug) console.log(`[MissionsReminder][DEBUG] SKIP: push_reminders_enabled=false`);
                    continue;
                }

                const currentHour = getCurrentHourInTimezone(userPrefs.timezone);
                if (debug) {
                    console.log(`[MissionsReminder][DEBUG] timezone=${userPrefs.timezone} currentHour=${currentHour} NOTIFICATION_HOUR=${NOTIFICATION_HOUR}`);
                }
                if (currentHour !== NOTIFICATION_HOUR) {
                    if (debug) console.log(`[MissionsReminder][DEBUG] SKIP: hour mismatch`);
                    continue;
                }

                const fullUrl = `${apiUrl}?player=${device.wallet}`;
                if (debug) console.log(`[MissionsReminder][DEBUG] fetching ${fullUrl}`);
                const response = await fetch(fullUrl);
                const rawText = debug ? await response.text() : null;
                const missionsData: DailyMissionsResponse = debug
                    ? JSON.parse(rawText!)
                    : ((await response.json()) as DailyMissionsResponse);

                if (debug) {
                    console.log(`[MissionsReminder][DEBUG] api status=${response.status} raw=${rawText}`);
                    console.log(`[MissionsReminder][DEBUG] missions.length=${missionsData.missions?.length}`);
                    missionsData.missions?.forEach((m, i) => {
                        console.log(`[MissionsReminder][DEBUG]   [${i}] day=${m?.day} mission_id=${m?.mission_id} completed=${m?.completed} (typeof=${typeof m?.completed})`);
                    });
                }

                const completed = missionsData.missions.map(m => m?.completed ?? false);
                const allCompleted = completed.every(c => c);

                if (debug) {
                    console.log(`[MissionsReminder][DEBUG] completed array=${JSON.stringify(completed)} allCompleted=${allCompleted}`);
                }

                if (allCompleted) {
                    if (debug) console.log(`[MissionsReminder][DEBUG] SKIP: allCompleted`);
                    continue;
                }

                const pendingCount = completed.filter(c => !c).length;
                const hoursRemaining = getHoursUntilReset();
                const { title, body } = getLocalizedMessage(userPrefs.language, pendingCount, hoursRemaining);

                if (debug) {
                    console.log(`[MissionsReminder][DEBUG] pendingCount=${pendingCount} hoursRemaining=${hoursRemaining} language=${userPrefs.language}`);
                    console.log(`[MissionsReminder][DEBUG] title="${title}" body="${body}"`);
                }

                const sent = await sendPushNotification(device.fcm_token, title, body);

                if (debug) console.log(`[MissionsReminder][DEBUG] sendPushNotification returned ${sent}`);

                if (sent) {
                    notifiedCount++;
                    console.log(`[MissionsReminder] Enviado a ${device.wallet} (${userPrefs.language})`);
                }
            } catch (fetchError) {
                console.error(`[MissionsReminder] Error processing ${device.wallet}:`, fetchError);
                if (debug) console.error(`[MissionsReminder][DEBUG] full error:`, fetchError);
            }
        }

        console.log(`[MissionsReminder] ${notifiedCount} usuarios notificados`);
    } catch (error) {
        console.error('[MissionsReminder] Error:', error);
    }
}

export function getMissionsReminderJob(): CronJobDefinition {
  return {
    name: 'Missions Reminder',
    schedule: env.NOTIFICATIONS_CRON_SCHEDULE,
    enabled: env.NOTIFICATIONS_ENABLED,
    run: sendMissionsReminder,
  };
}
