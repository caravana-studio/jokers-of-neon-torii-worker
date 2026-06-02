-- Tabla para trackear notificaciones enviadas y evitar duplicados
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    reference_id TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para búsquedas por wallet y tipo
CREATE INDEX IF NOT EXISTS idx_notification_logs_wallet_type
ON notification_logs(wallet, notification_type);

-- Índice para búsquedas por reference_id
CREATE INDEX IF NOT EXISTS idx_notification_logs_reference
ON notification_logs(wallet, notification_type, reference_id);
