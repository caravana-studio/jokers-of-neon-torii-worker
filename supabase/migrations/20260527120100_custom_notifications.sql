-- Tabla para notificaciones custom programadas
CREATE TABLE IF NOT EXISTS custom_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('push_reminders_enabled', 'push_events_enabled')),
    scheduled_date DATE NOT NULL,
    scheduled_hour INTEGER NOT NULL CHECK (scheduled_hour >= 0 AND scheduled_hour <= 23),
    messages JSONB NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    timing_mode TEXT DEFAULT 'local' CHECK (timing_mode IN ('local', 'global')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE custom_notifications
ADD COLUMN IF NOT EXISTS timing_mode TEXT DEFAULT 'local';

ALTER TABLE custom_notifications
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'custom_notifications_timing_mode_check'
    ) THEN
        ALTER TABLE custom_notifications
        ADD CONSTRAINT custom_notifications_timing_mode_check
        CHECK (timing_mode IN ('local', 'global'));
    END IF;
END $$;

-- Índice para búsquedas por fecha y estado
CREATE INDEX IF NOT EXISTS idx_custom_notifications_scheduled
ON custom_notifications(scheduled_date, scheduled_hour, active);

-- Ejemplo de inserción (modo local - cada usuario recibe a su hora local):
-- INSERT INTO custom_notifications (notification_type, scheduled_date, scheduled_hour, messages, timing_mode)
-- VALUES (
--     'push_events_enabled',
--     '2024-01-15',
--     18,
--     '{
--         "es": {
--             "title": "🎮 Evento especial!",
--             "body": "No te pierdas el torneo de hoy"
--         },
--         "en": {
--             "title": "🎮 Special event!",
--             "body": "Don''t miss today''s tournament"
--         },
--         "pt": {
--             "title": "🎮 Evento especial!",
--             "body": "Não perca o torneio de hoje"
--         }
--     }',
--     'local'
-- );

-- Ejemplo de inserción (modo global - todos reciben al mismo tiempo, hora Argentina):
-- INSERT INTO custom_notifications (notification_type, scheduled_date, scheduled_hour, messages, timing_mode)
-- VALUES (
--     'push_events_enabled',
--     '2024-01-15',
--     20,
--     '{
--         "es": {
--             "title": "🎮 Torneo en vivo!",
--             "body": "El torneo comienza ahora"
--         },
--         "en": {
--             "title": "🎮 Live tournament!",
--             "body": "The tournament starts now"
--         },
--         "pt": {
--             "title": "🎮 Torneio ao vivo!",
--             "body": "O torneio começa agora"
--         }
--     }',
--     'global'
-- );

-- Migración para tablas existentes:
-- ALTER TABLE custom_notifications
-- ADD COLUMN timing_mode TEXT DEFAULT 'local' CHECK (timing_mode IN ('local', 'global'));
