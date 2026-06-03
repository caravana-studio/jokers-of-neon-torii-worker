import { supabase } from '../../config/supabase.js';
import { DailyMissionsResponse, NotificationMessage } from '../../platform/notifications/types.js';
import type { CronJobDefinition } from '../../runtime/types.js';
import { env, resolveDataApiBaseUrl } from '../../env.js';
import { sendPushNotification, getCurrentHourInTimezone, getEnabledDevices } from '../../platform/notifications/fcm.js';

const NOTIFICATION_HOUR = env.DAILY_MISSIONS_NOTIFICATION_HOUR;
const DEBUG_WALLET = env.NOTIFICATIONS_DEBUG_WALLET;
const SECONDS_IN_DAY = 86400;
const DAY_START_OFFSET_SECONDS = 21600; // 6am UTC = 3am Argentina time.
const MAX_STARKNET_ADDRESS = (1n << 251n) - 1n;

type ReminderVariant = 'default' | 'active_streak_warning' | 'start_streak_warning';

type PlayerStreakReminderRow = {
    current_streak: number | string;
    last_completed_day: number | string;
    protectors_available: number | string;
};

type ReminderStreakState = {
    found: boolean;
    hasActiveStreak: boolean;
    hasCompletedToday: boolean;
    currentStreak: number;
    lastCompletedDay: number;
    daysMissed: number;
};

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

function normalizeStarknetAddress(address: string): string {
    const raw = String(address ?? '').trim();
    if (!raw) {
        throw new Error('Address is required');
    }

    let value: bigint;
    if (/^0x[0-9a-fA-F]+$/.test(raw)) {
        value = BigInt(raw);
    } else if (/^[0-9]+$/.test(raw)) {
        value = BigInt(raw);
    } else if (/^[0-9a-fA-F]+$/.test(raw)) {
        value = BigInt(`0x${raw}`);
    } else {
        throw new Error(`Invalid Starknet address: ${address}`);
    }

    if (value < 0n || value > MAX_STARKNET_ADDRESS) {
        throw new Error(`Invalid Starknet address: ${address}`);
    }

    return `0x${value.toString(16).padStart(64, '0')}`;
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

function getCurrentDailyPeriodId(date = new Date()): number {
    return Math.floor((Math.floor(date.getTime() / 1000) - DAY_START_OFFSET_SECONDS) / SECONDS_IN_DAY);
}

function toNumber(value: unknown): number {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

function calculateReminderStreakState(row: PlayerStreakReminderRow | null): ReminderStreakState {
    if (!row) {
        return {
            found: false,
            hasActiveStreak: false,
            hasCompletedToday: false,
            currentStreak: 0,
            lastCompletedDay: 0,
            daysMissed: 0,
        };
    }

    const currentDay = getCurrentDailyPeriodId();
    const currentStreak = toNumber(row.current_streak);
    const lastCompletedDay = toNumber(row.last_completed_day);
    const protectorsAvailable = toNumber(row.protectors_available);
    const hasStarted = currentStreak > 0 && lastCompletedDay > 0;
    const daysMissed =
        hasStarted && currentDay > lastCompletedDay ? Math.max(0, currentDay - lastCompletedDay - 1) : 0;
    const isBroken = hasStarted && daysMissed > protectorsAvailable;
    const effectiveStreak = isBroken ? 0 : currentStreak;
    const hasActiveStreak = effectiveStreak > 0 && !isBroken;

    return {
        found: true,
        hasActiveStreak,
        hasCompletedToday: hasActiveStreak && lastCompletedDay === currentDay,
        currentStreak,
        lastCompletedDay,
        daysMissed,
    };
}

async function getReminderStreakState(wallet: string): Promise<ReminderStreakState> {
    try {
        const { data, error } = await supabase
            .from('player_streaks')
            .select('current_streak, last_completed_day, protectors_available')
            .eq('player_address', normalizeStarknetAddress(wallet))
            .maybeSingle();

        if (error) {
            console.warn(`[missions-reminder] streak lookup failed wallet=${compactWallet(wallet)}`, error);
            return calculateReminderStreakState(null);
        }

        return calculateReminderStreakState((data as PlayerStreakReminderRow | null) ?? null);
    } catch (error) {
        console.warn(`[missions-reminder] streak lookup failed wallet=${compactWallet(wallet)}`, error);
        return calculateReminderStreakState(null);
    }
}

function getLocalizedMessage(
    language: string,
    pendingCount: number,
    hoursRemaining: number,
    variant: ReminderVariant
): NotificationMessage {
    const messages: Record<string, NotificationMessage> = {
        es:
            variant === 'active_streak_warning'
                ? {
                      title: '🔥 No pierdas tu racha',
                      body: `Te quedan ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para completar una misión diaria. Si no, vas a perder tu racha.`
                  }
                : variant === 'start_streak_warning'
                  ? {
                        title: '🔥 Empezá tu racha hoy',
                        body: `Te quedan ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para completar una misión diaria y empezar tu racha.`
                    }
                  : {
                        title: '⏳ ¡Última llamada!',
                        body:
                            pendingCount === 1
                                ? `Te queda 1 misión diaria por completar. Tenés ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para cerrarla hoy.`
                                : `Te quedan ${pendingCount} misiones diarias por completar. Tenés ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para cerrarlas hoy.`
                    },
        en:
            variant === 'active_streak_warning'
                ? {
                      title: "🔥 Don't lose your streak",
                      body: `You have ${hoursRemaining} ${hoursRemaining === 1 ? 'hour' : 'hours'} left to complete a daily mission. Otherwise, you'll lose your streak.`
                  }
                : variant === 'start_streak_warning'
                  ? {
                        title: '🔥 Start your streak today',
                        body: `You have ${hoursRemaining} ${hoursRemaining === 1 ? 'hour' : 'hours'} left to complete a daily mission and start your streak.`
                    }
                  : {
                        title: '⏳ Last call!',
                        body:
                            pendingCount === 1
                                ? `You still have 1 daily mission left. You have ${hoursRemaining} ${hoursRemaining === 1 ? 'hour' : 'hours'} to finish it today.`
                                : `You still have ${pendingCount} daily missions left. You have ${hoursRemaining} ${hoursRemaining === 1 ? 'hour' : 'hours'} to finish them today.`
                    },
        pt:
            variant === 'active_streak_warning'
                ? {
                      title: '🔥 Não perca sua sequência',
                      body: `Faltam ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para completar uma missão diária. Caso contrário, você vai perder sua sequência.`
                  }
                : variant === 'start_streak_warning'
                  ? {
                        title: '🔥 Comece sua sequência hoje',
                        body: `Faltam ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para completar uma missão diária e começar sua sequência.`
                    }
                  : {
                        title: '⏳ Última chamada!',
                        body:
                            pendingCount === 1
                                ? `Você ainda tem 1 missão diária para completar. Faltam ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para concluí-la hoje.`
                                : `Você ainda tem ${pendingCount} missões diárias para completar. Faltam ${hoursRemaining} ${hoursRemaining === 1 ? 'hora' : 'horas'} para concluí-las hoje.`
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
                const hasAnyCompletedMission = completed.some(Boolean);
                const streakState = await getReminderStreakState(device.wallet);
                const hasCompletedDailyMission = streakState.found ? streakState.hasCompletedToday : hasAnyCompletedMission;
                const variant: ReminderVariant = hasCompletedDailyMission
                    ? 'default'
                    : streakState.hasActiveStreak
                      ? 'active_streak_warning'
                      : 'start_streak_warning';
                const { title, body } = getLocalizedMessage(userPrefs.language, pendingCount, hoursRemaining, variant);

                if (debug) {
                    console.log(
                        `[missions-reminder-debug] streak wallet=${compactWallet(device.wallet)} found=${streakState.found} active=${streakState.hasActiveStreak} completedToday=${streakState.hasCompletedToday} currentStreak=${streakState.currentStreak} lastCompletedDay=${streakState.lastCompletedDay} daysMissed=${streakState.daysMissed} fallbackCompleted=${hasAnyCompletedMission}`
                    );
                    console.log(
                        `[missions-reminder-debug] message wallet=${compactWallet(device.wallet)} pending=${pendingCount} hoursRemaining=${hoursRemaining} language=${userPrefs.language} variant=${variant} title=${JSON.stringify(title)} body=${JSON.stringify(body)}`
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
