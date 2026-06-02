import { supabase } from '../../config/supabase.js';
import { FreePackResponse, NotificationMessage } from '../../platform/notifications/types.js';
import type { CronJobDefinition } from '../../runtime/types.js';
import { env, resolveDataApiBaseUrl } from '../../env.js';
import {
    sendPushNotification,
    getCurrentHourInTimezone,
    isWithinNotificationHours,
    getEnabledDevices,
    hasNotificationBeenSent,
    logNotificationSent
} from '../../platform/notifications/fcm.js';

const NOTIFICATION_TYPE = 'free_packs';

function getLocalizedMessage(language: string): NotificationMessage {
    const messages: Record<string, NotificationMessage> = {
        es: {
            title: '🎁 ¡Pack gratis disponible!',
            body: 'Tenés un pack gratis esperándote. ¡Reclamalo ahora!'
        },
        en: {
            title: '🎁 Free pack available!',
            body: 'You have a free pack waiting for you. Claim it now!'
        },
        pt: {
            title: '🎁 Pack grátis disponível!',
            body: 'Você tem um pack grátis esperando. Resgate agora!'
        }
    };

    return messages[language] || messages['en'];
}

async function sendFreePacksNotifications(): Promise<void> {
    try {
        console.log('[FreePacks] Ejecutando...');

        const devices = await getEnabledDevices();
        console.log(`[FreePacks] Dispositivos habilitados: ${devices.length}`);

        const apiUrl = `${resolveDataApiBaseUrl()}/api/next-free-pack-timestamp`;
        let notifiedCount = 0;
        let skippedNoPrefs = 0;
        let skippedDisabled = 0;
        let skippedHours = 0;
        let skippedNoPackAvailable = 0;
        let skippedAlreadySent = 0;

        for (const device of devices) {
            try {
                const { data: userPrefs, error: userError } = await supabase
                    .from('user_preferences')
                    .select('push_daily_packs_enabled, timezone, language')
                    .eq('wallet', device.wallet)
                    .single();

                if (userError || !userPrefs) {
                    skippedNoPrefs++;
                    continue;
                }

                if (!userPrefs.push_daily_packs_enabled) {
                    skippedDisabled++;
                    continue;
                }

                const currentHour = getCurrentHourInTimezone(userPrefs.timezone);
                if (!isWithinNotificationHours(currentHour)) {
                    skippedHours++;
                    continue;
                }

                const response = await fetch(`${apiUrl}?recipient=${device.wallet}`);
                const packData = (await response.json()) as FreePackResponse;

                const packTimestamp = packData.next_free_pack_timestamp;

                // Si no hay timestamp válido, no hay pack disponible
                if (packTimestamp == null || packTimestamp === 0) {
                    console.log(`[FreePacks] ${device.wallet}: API devolvió timestamp inválido: ${packTimestamp}`);
                    skippedNoPackAvailable++;
                    continue;
                }

                const now = Date.now();
                const packTimestampMs = packTimestamp * 1000;

                if (packTimestampMs > now) {
                    skippedNoPackAvailable++;
                    continue;
                }

                console.log(`[FreePacks] ${device.wallet}: Pack disponible (timestamp: ${packTimestamp})`);

                const referenceId = packTimestamp.toString();
                const alreadySent = await hasNotificationBeenSent(device.wallet, NOTIFICATION_TYPE, referenceId);
                if (alreadySent) {
                    console.log(`[FreePacks] ${device.wallet}: Ya notificado para este pack`);
                    skippedAlreadySent++;
                    continue;
                }

                const { title, body } = getLocalizedMessage(userPrefs.language);
                const sent = await sendPushNotification(device.fcm_token, title, body);

                if (sent) {
                    await logNotificationSent(device.wallet, NOTIFICATION_TYPE, referenceId);
                    notifiedCount++;
                    console.log(`[FreePacks] Enviado a ${device.wallet} (${userPrefs.language})`);
                }
            } catch (fetchError) {
                console.error(`[FreePacks] Error processing ${device.wallet}:`, fetchError);
            }
        }

        console.log(`[FreePacks] Resumen:`);
        console.log(`  - Sin preferencias: ${skippedNoPrefs}`);
        console.log(`  - Notif deshabilitadas: ${skippedDisabled}`);
        console.log(`  - Fuera de horario: ${skippedHours}`);
        console.log(`  - Sin pack disponible: ${skippedNoPackAvailable}`);
        console.log(`  - Ya notificados: ${skippedAlreadySent}`);
        console.log(`  - Notificados: ${notifiedCount}`);
    } catch (error) {
        console.error('[FreePacks] Error:', error);
    }
}

export function getFreePacksJob(): CronJobDefinition {
  return {
    name: 'Free Packs',
    schedule: env.FREE_PACKS_CRON_SCHEDULE,
    enabled: env.NOTIFICATIONS_ENABLED,
    run: sendFreePacksNotifications,
  };
}
