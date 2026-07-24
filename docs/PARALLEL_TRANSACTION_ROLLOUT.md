# Rollout del worker paralelo

## Resultado esperado

El worker conserva `torii_worker_intent_queue` como fuente semántica. Al ejecutar, compila hasta cinco intents Starknet a `Call[]`, toma atómicamente una cuenta libre de `executor_accounts` y envía un multicall. Con seis cuentas y la configuración final puede mantener hasta seis batches —treinta calls— en vuelo. Slot y Celo continúan en lanes independientes.

La paralelización reduce latencia de cola. El ahorro de fee viene principalmente de agrupar calls en multicall; usar más cuentas por sí solo no garantiza menor costo total.

## Precondiciones

1. Confirmar seis cuentas activas, desplegadas y con balance en la red del `BACKGROUND_STARKNET_RPC_URL`:

   ```sql
   SELECT id, name, address, is_active, is_busy, current_batch_id
   FROM executor_accounts
   ORDER BY id;
   ```

2. Cada cuenta debe tener los roles necesarios en XP, Profile y Progression para todas las operaciones que compila el worker. Como el pool es compartido, también debe conservar los permisos que necesita la API.
3. Confirmar que API y worker apuntan al mismo proyecto Supabase y a la misma red Starknet.
4. Configurar `SUPABASE_SERVICE_ROLE_KEY` en ambos servicios. Es obligatoria porque el claim devuelve material de firma; nunca debe exponerse en frontend.
5. Guardar una medición base: tamaño de cola, latencia `created_at → completed_at`, tasa de fallos y fee de una muestra comparable.

## Orden de deploy

El orden es obligatorio porque la versión anterior de la API podía tomar cuentas de forma no atómica y liberaba todas las cuentas ocupadas durante recovery. La API nueva incluye un fallback de release condicionado por `current_batch_id`, por lo que puede convivir temporalmente con el esquema anterior.

1. Confirmar que ya fue aplicada la migración de API `migrations/create_executor_accounts_table.sql` y configurar `SUPABASE_SERVICE_ROLE_KEY` en API y worker.
2. Desplegar el cambio de `../jokers-of-neon-api/src/services/scalableTransactionQueue.ts`. La API pasa a usar su cliente administrativo, adquirir cuentas atómicamente, liberar sólo la cuenta cuyo `current_batch_id` coincide y recuperar únicamente sus batches con más de diez minutos de antigüedad.
3. Aplicar `supabase/migrations/20260716120000_add_parallel_intent_batches.sql`. Esta migración crea el release compartido y restringe la tabla y los RPC del pool a `service_role`.
4. Desplegar el worker inicialmente con:

   ```env
   TRANSACTION_EXECUTION_MODE=multicall
   STARKNET_BATCH_SIZE=3
   STARKNET_BATCH_WAIT_TIME_MS=1000
   STARKNET_MAX_CONCURRENT_BATCHES=2
   TRANSACTION_QUEUE_POLL_INTERVAL_MS=500
   TRANSACTION_QUEUE_LEASE_MS=600000
   SUPABASE_SERVICE_ROLE_KEY=server-only-secret
   ```

5. Después del smoke test, subir a la configuración objetivo:

   ```env
   STARKNET_BATCH_SIZE=5
   STARKNET_MAX_CONCURRENT_BATCHES=6
   ```

Omitir `STARKNET_EXECUTOR_IDS` usa las seis cuentas activas. Definirlo limita las cuentas elegibles para el worker, pero no las reserva frente a la API.

## Smoke test

1. Encolar entre 10 y 20 intents válidos de testnet.
2. Verificar en logs `batch_start`, `batch_submitted` y `batch_completed`.
3. Confirmar que nunca haya dos filas con el mismo `current_batch_id`, ni una cuenta ocupada por dos batches.
4. Confirmar el estado on-chain de al menos un intent de cada operación incluida.
5. Forzar un intent inválido controlado: un multicall que revierte debe volver a cola sus calls con `force_single=true`; sólo la call defectuosa debe terminar agotando retries.

## Stress test

Los scripts sólo insertan filas; los servicios desplegados las consumen. El preset `xp-zero` llama `test_xp` con XP de temporada y perfil en cero. El contrato valida el permiso del executor pero no modifica XP cuando ambos valores son cero. La prueba sí envía transacciones y paga fees.

Antes de comenzar, esperar que ambas colas normales estén vacías. Usar el mismo identificador en los dos repos, por ejemplo `parallel_200_01`.

Worker — 200 filas en `torii_worker_intent_queue`:

```bash
cd ../jokers-of-neon-torii-worker

STRESS_TEST_MODE=onchain \
STRESS_TEST_CONFIRM=I_UNDERSTAND_THIS_WRITES_ONCHAIN \
STRESS_TEST_RUN_ID=parallel_200_01 \
STRESS_TEST_COUNT=200 \
STRESS_TEST_INSERT_BATCH_SIZE=50 \
STRESS_TEST_PRESET=xp-zero \
bun run stress:queue
```

API — 200 filas en `api_transaction_queue` usando el mismo contrato XP del worker:

```bash
cd ../jokers-of-neon-api

STRESS_TEST_MODE=onchain \
STRESS_TEST_CONFIRM=I_UNDERSTAND_THIS_WRITES_ONCHAIN \
STRESS_TEST_RUN_ID=parallel_200_01 \
STRESS_TEST_COUNT=200 \
STRESS_TEST_INSERT_BATCH_SIZE=50 \
STRESS_TEST_CONTRACT_ADDRESS=0x_XP_SYSTEM_MAINNET \
npm run stress:queue
```

Se pueden ejecutar los comandos uno inmediatamente después del otro para que las 400 calls compitan por el pool compartido. `max_retries=0` evita repetir individualmente una call de stress que falle.

### Simulación sólo de base de datos

`database-only` inserta las filas directamente como `completed`, con hashes `simulated:*`. Sirve para probar volumen, índices y consultas de Supabase, pero no prueba batching, cuentas, nonces, RPC ni receipts.

```bash
STRESS_TEST_MODE=database-only \
STRESS_TEST_CONFIRM=I_UNDERSTAND_THIS_WRITES_DATABASE \
STRESS_TEST_RUN_ID=db_200_01 \
STRESS_TEST_COUNT=200 \
bun run stress:queue
```

Ejecutar el equivalente desde API con `npm run stress:queue`. En ese modo `STRESS_TEST_CONTRACT_ADDRESS` es opcional.

## Monitoreo

Estado de la cola:

```sql
SELECT status, COUNT(*)
FROM torii_worker_intent_queue
GROUP BY status
ORDER BY status;
```

Batches de la última hora:

```sql
SELECT
  status,
  COUNT(*) AS batches,
  SUM(transaction_count) AS intents,
  ROUND(AVG(transaction_count), 2) AS avg_batch_size,
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))::numeric, 2) AS avg_seconds
FROM torii_worker_transaction_batches
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status
ORDER BY status;
```

Pool compartido:

```sql
SELECT
  id,
  name,
  is_active,
  is_busy,
  current_batch_id,
  total_batches_executed,
  total_transactions_executed,
  last_error_at,
  last_error_message
FROM executor_accounts
ORDER BY id;
```

Hashes sin resolver y errores recientes:

```sql
SELECT id, executor_id, transaction_hash, submitted_at, NOW() - submitted_at AS age
FROM torii_worker_transaction_batches
WHERE status = 'submitted'
ORDER BY submitted_at;

SELECT id, transaction_ids, error_message, completed_at
FROM torii_worker_transaction_batches
WHERE status = 'failed'
ORDER BY completed_at DESC
LIMIT 30;
```

Para una corrida de stress, tomar el `run` impreso por el script:

```sql
SELECT status, COUNT(*), MIN(created_at), MAX(completed_at)
FROM torii_worker_intent_queue
WHERE metadata->>'stressRunId' = 'stress_...'
GROUP BY status;

SELECT status, COUNT(*)
FROM api_transaction_queue
WHERE id LIKE 'stress_api_parallel_200_01_%'
GROUP BY status;
```

Limpieza opcional después de conservar las métricas:

```sql
DELETE FROM torii_worker_intent_queue
WHERE metadata->>'stressRunId' = 'db_200_01';

DELETE FROM api_transaction_queue
WHERE id LIKE 'stress_api_db_200_01_%';
```

## Criterios para subir de 2 a 6 cuentas

- Ninguna duplicación on-chain.
- Ningún error de nonce sostenido.
- Cero batches `submitted` con antigüedad mayor a diez minutos.
- La tasa de intents `failed` no aumenta respecto de la base.
- El tamaño medio de batch se acerca a la carga esperada; si queda cerca de 1, aumentar moderadamente `STARKNET_BATCH_WAIT_TIME_MS` antes de concluir que multicall no ayuda.
- La latencia p95 de cola mejora y el RPC no muestra rate limiting sostenido.

## Rollback sin duplicados

1. Desplegar temporalmente `STARKNET_MAX_CONCURRENT_BATCHES=0` manteniendo `TRANSACTION_EXECUTION_MODE=multicall`. El worker deja de hacer claims, pero sigue confirmando hashes enviados y recuperando leases pre-submission expirados.
2. Esperar a que esta consulta dé cero:

   ```sql
   SELECT COUNT(*)
   FROM torii_worker_transaction_batches
   WHERE status IN ('processing', 'submitted');
   ```

3. Cambiar a:

   ```env
   TRANSACTION_EXECUTION_MODE=sequential
   STARKNET_ADDRESS=0x...
   STARKNET_PRIVATE_KEY=0x...
   ```

4. Mantener la migración aplicada. No hace falta borrar batches ni columnas para volver al modo secuencial.

No cambiar directamente a `sequential` mientras existan batches `submitted`: ese modo no reconcilia sus receipts y una intervención manual incorrecta podría reenviar intents ya aceptados por Starknet.
