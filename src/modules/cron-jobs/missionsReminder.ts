import { supabase } from '../../config/supabase.js';
import { DailyMissionsResponse, NotificationMessage } from '../../platform/notifications/types.js';
import type { CronJobDefinition } from '../../runtime/types.js';
import { env, resolveDataApiBaseUrl } from '../../env.js';
import { sendPushNotification, getCurrentHourInTimezone, getEnabledDevices } from '../../platform/notifications/fcm.js';

const NOTIFICATION_HOUR = env.DAILY_MISSIONS_NOTIFICATION_HOUR;

const DEBUG_WALLET = env.NOTIFICATIONS_DEBUG_WALLET;

function compactWallet(wallet: string): string {
    return wallet.startsWith('0x') && wallet.length > 18 ? `${wallet.slice(0, 10)}...${wallet.slice(-6)}` : wallet;
}

function compactText(value: string | null, maxLength = 240): string {
    if (!value) return '';
    const compact = value.replace(/\s+/g, ' ');
    return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

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
        const devices = await getEnabledDevices();
        const apiUrl = `${resolveDataApiBaseUrl()}/api/daily-missions`;
        let notifiedCount = 0;
        console.log(`[missions-reminder] start devices=${devices.length} hour=${NOTIFICATION_HOUR}`);

        if (DEBUG_WALLET) {
            const debugDevices = devices.filter(d => isDebugWallet(d.wallet));
            console.log(
                `[missions-reminder] debugWallet=${compactWallet(DEBUG_WALLET)} devices=${devices.length} matches=${debugDevices.length}`
            );
            debugDevices.forEach((d, i) => {
                console.log(
                    `[missions-reminder-debug] match=${i} wallet=${compactWallet(d.wallet)} token=${d.fcm_token?.slice(0, 12)}...`
                );
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
                    console.log(
                        `[missions-reminder-debug] prefs wallet=${compactWallet(device.wallet)} error=${userError?.message ?? 'none'} found=${Boolean(userPrefs)} timezone=${userPrefs?.timezone ?? 'unknown'} language=${userPrefs?.language ?? 'unknown'}`
                    );
                }

                if (userError || !userPrefs) {
                    if (debug) console.log(`[missions-reminder-debug] skip wallet=${compactWallet(device.wallet)} reason=no_prefs`);
                    continue;
                }
                if (!userPrefs.push_reminders_enabled) {
                    if (debug) console.log(`[missions-reminder-debug] skip wallet=${compactWallet(device.wallet)} reason=disabled`);
                    continue;
                }

                const currentHour = getCurrentHourInTimezone(userPrefs.timezone);
                if (debug) {
                    console.log(
                        `[missions-reminder-debug] hour wallet=${compactWallet(device.wallet)} timezone=${userPrefs.timezone} current=${currentHour} target=${NOTIFICATION_HOUR}`
                    );
                }
                if (currentHour !== NOTIFICATION_HOUR) {
                    if (debug) console.log(`[missions-reminder-debug] skip wallet=${compactWallet(device.wallet)} reason=hour_mismatch`);
                    continue;
                }

                const fullUrl = `${apiUrl}?player=${device.wallet}`;
                if (debug) console.log(`[missions-reminder-debug] fetch wallet=${compactWallet(device.wallet)} url=${fullUrl}`);
                const response = await fetch(fullUrl);
                const rawText = debug ? await response.text() : null;
                const missionsData: DailyMissionsResponse = debug
                    ? JSON.parse(rawText!)
                    : ((await response.json()) as DailyMissionsResponse);

                if (debug) {
                    console.log(
                        `[missions-reminder-debug] api wallet=${compactWallet(device.wallet)} status=${response.status} missions=${missionsData.missions?.length ?? 0} raw=${compactText(rawText)}`
                    );
                    missionsData.missions?.forEach((m, i) => {
                        console.log(
                            `[missions-reminder-debug] mission wallet=${compactWallet(device.wallet)} index=${i} day=${m?.day} mission=${m?.mission_id} completed=${m?.completed} completedType=${typeof m?.completed}`
                        );
                    });
                }

                const completed = missionsData.missions.map(m => m?.completed ?? false);
                const allCompleted = completed.every(c => c);

                if (debug) {
                    console.log(
                        `[missions-reminder-debug] completion wallet=${compactWallet(device.wallet)} completed=${JSON.stringify(completed)} allCompleted=${allCompleted}`
                    );
                }

                if (allCompleted) {
                    if (debug) console.log(`[missions-reminder-debug] skip wallet=${compactWallet(device.wallet)} reason=all_completed`);
                    continue;
                }

                const pendingCount = completed.filter(c => !c).length;
                const hoursRemaining = getHoursUntilReset();
                const { title, body } = getLocalizedMessage(userPrefs.language, pendingCount, hoursRemaining);

                if (debug) {
                    console.log(
                        `[missions-reminder-debug] message wallet=${compactWallet(device.wallet)} pending=${pendingCount} hoursRemaining=${hoursRemaining} language=${userPrefs.language} title=${JSON.stringify(title)} body=${JSON.stringify(body)}`
                    );
                }

                const sent = await sendPushNotification(device.fcm_token, title, body);

                if (debug) console.log(`[missions-reminder-debug] send_result wallet=${compactWallet(device.wallet)} sent=${sent}`);

                if (sent) {
                    notifiedCount++;
                    console.log(`[missions-reminder] sent wallet=${compactWallet(device.wallet)} language=${userPrefs.language}`);
                }
            } catch (fetchError) {
                console.error(`[MissionsReminder] Error processing ${device.wallet}:`, fetchError);
                if (debug) console.error(`[MissionsReminder][DEBUG] full error:`, fetchError);
            }
        }

        console.log(`[missions-reminder] done notified=${notifiedCount}`);
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
