# Sistema de Cola de Transacciones Persistente

## Descripción

Este sistema implementa una cola persistente para transacciones de Starknet usando Supabase como base de datos. Permite que las transacciones sobrevivan reinicios del worker y se ejecuten secuencialmente con validación.

## Características

### 1. Persistencia en Supabase
- ✅ Las transacciones se guardan en base de datos antes de ejecutarse
- ✅ Sobreviven reinicios del worker
- ✅ Se pueden consultar y monitorear desde Supabase

### 2. Procesamiento Secuencial
- ✅ Una transacción a la vez para evitar conflictos de nonce
- ✅ Cada transacción espera confirmación antes de continuar
- ✅ FIFO (First In, First Out)

### 3. Sistema de Reintentos
- ✅ Hasta 3 intentos por defecto (configurable)
- ✅ Backoff exponencial entre reintentos
- ✅ Transacciones fallidas se marcan como 'failed' después de max reintentos

### 4. Recuperación Automática
- ✅ Al iniciar, recupera transacciones que estaban siendo procesadas
- ✅ Retoma transacciones pendientes automáticamente
- ✅ No se pierden transacciones en caso de crash

## Configuración

### 1. Variables de Entorno

Agrega las siguientes variables a tu archivo `.env`:

```bash
# Supabase Configuration (same as jokers-of-neon-api)
SUPABASE_URL=https://jopurrudzfwcwbgqjzcs.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### 2. Crear Tabla en Supabase

Ejecuta el script SQL en el Supabase SQL Editor:

```bash
# El archivo está en: supabase-schema.sql
```

O copia el siguiente SQL en Supabase:

```sql
CREATE TABLE IF NOT EXISTS torii_worker_transaction_queue (
  id TEXT PRIMARY KEY,
  contract_address TEXT NOT NULL,
  entrypoint TEXT NOT NULL,
  calldata JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  transaction_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_torii_worker_tx_queue_status ON torii_worker_transaction_queue(status);
CREATE INDEX IF NOT EXISTS idx_torii_worker_tx_queue_created_at ON torii_worker_transaction_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_torii_worker_tx_queue_status_created_at ON torii_worker_transaction_queue(status, created_at);
```

## Uso

### Encolar una Transacción

```typescript
import { getTransactionQueue } from './transactionQueue.js';

const txQueue = getTransactionQueue();

// Encolar transacción
await txQueue.enqueue({
  contractAddress: '0x...',
  entrypoint: 'transfer',
  calldata: ['0x123', '100'],
  maxRetries: 3  // Opcional, default: 3
});
```

### Inicializar la Cola

```typescript
// Inicializar al arrancar el worker
await txQueue.initialize();
```

Esto automáticamente:
1. Recupera transacciones que estaban siendo procesadas
2. Retoma transacciones pendientes
3. Comienza a procesarlas secuencialmente

### Consultar Estado

```typescript
const status = await txQueue.getStatus();

console.log('Pending:', status.pendingCount);
console.log('Processing:', status.processingCount);
console.log('Completed:', status.completedCount);
console.log('Failed:', status.failedCount);
console.log('Current TX:', status.currentTransactionId);
```

## Estados de Transacción

| Estado | Descripción |
|--------|-------------|
| `pending` | Transacción en cola esperando ser procesada |
| `processing` | Transacción siendo ejecutada actualmente |
| `completed` | Transacción ejecutada y confirmada exitosamente |
| `failed` | Transacción falló después de max_retries |

## Flujo de Procesamiento

```
1. Event detectado
   ↓
2. txQueue.enqueue() → Guarda en Supabase con status='pending'
   ↓
3. processQueue() toma primera TX pendiente
   ↓
4. Status cambia a 'processing'
   ↓
5. Ejecuta transacción en Starknet
   ↓
6. Espera confirmación
   ↓
7a. ✅ Éxito → Status='completed', guarda transaction_hash
7b. ❌ Fallo → Incrementa retries, vuelve a 'pending' (si < max_retries)
7c. 🚫 Max retries → Status='failed', guarda error_message
   ↓
8. Continúa con siguiente TX
```

## Monitoreo en Supabase

Puedes consultar el estado de las transacciones directamente en Supabase:

```sql
-- Ver transacciones pendientes
SELECT * FROM torii_worker_transaction_queue WHERE status = 'pending' ORDER BY created_at;

-- Ver transacciones fallidas
SELECT * FROM torii_worker_transaction_queue WHERE status = 'failed' ORDER BY created_at DESC;

-- Ver transacciones completadas recientes
SELECT * FROM torii_worker_transaction_queue
WHERE status = 'completed'
ORDER BY completed_at DESC
LIMIT 10;

-- Estadísticas
SELECT
  status,
  COUNT(*) as count,
  AVG(retries) as avg_retries
FROM torii_worker_transaction_queue
GROUP BY status;
```

## Recuperación de Transacciones

### Escenario 1: Worker se reinicia

Al iniciar, el sistema automáticamente:
1. Marca transacciones 'processing' como 'pending' (estaban siendo procesadas cuando crasheó)
2. Comienza a procesar todas las transacciones 'pending' en orden

### Escenario 2: Reintentar transacciones fallidas manualmente

```sql
-- Resetear una transacción fallada específica
UPDATE torii_worker_transaction_queue
SET status = 'pending', retries = 0
WHERE id = 'tx_specific_id';

-- Reintentar todas las transacciones fallidas de las últimas 24h
UPDATE torii_worker_transaction_queue
SET status = 'pending', retries = 0
WHERE status = 'failed'
AND created_at > NOW() - INTERVAL '24 hours';
```

## Logs

El sistema provee logs detallados:

```
📥 Adding transaction to queue
   ID:         tx_1702345678_abc123
   Contract:   0x...
   Entrypoint: add_daily_mission_xp
✅ Transaction saved to database
   Queue size: 3

⚙️  Processing transaction from queue
   ID:         tx_1702345678_abc123
   Contract:   0x...
   Entrypoint: add_daily_mission_xp
   Attempt:    1/4

📤 Executing transaction on Starknet...
✅ Transaction sent: 0x...
⏳ Waiting for confirmation...
✅ Transaction confirmed: 0x...
```

## Modo Fallback (Sin Supabase)

Si Supabase no está configurado, el sistema funciona en modo solo memoria:

```
⚠️  Supabase not configured - running in memory-only mode
⚠️  Transactions will be lost on restart!
💼 Transaction Queue: Initialized (memory-only mode)
```

## Mejoras Futuras

- [ ] Dashboard web para monitorear la cola
- [ ] Notificaciones cuando transacciones fallan
- [ ] Métricas de tiempo de procesamiento
- [ ] Priorización de transacciones
- [ ] Limpieza automática de transacciones antiguas completadas

## Troubleshooting

### Transacciones quedan en 'processing'

Si el worker crashea mientras procesa una TX, esta queda en 'processing'. Se recupera automáticamente al reiniciar.

### Transacciones fallan repetidamente

Revisa el `error_message` en Supabase:

```sql
SELECT id, entrypoint, error_message, retries
FROM torii_worker_transaction_queue
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### Cola no procesa

Verifica:
1. Worker está corriendo
2. Variables de Supabase están configuradas
3. Hay transacciones pendientes: `SELECT COUNT(*) FROM torii_worker_transaction_queue WHERE status = 'pending'`
