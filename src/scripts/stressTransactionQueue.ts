import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import {
  isTransactionOperation,
  type EnqueueTransactionParams,
} from '../transactionQueueTypes.js';

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function readTemplate(): EnqueueTransactionParams {
  const raw = process.env.STRESS_TEST_INTENT_JSON;
  if (!raw) {
    const preset = process.env.STRESS_TEST_PRESET?.trim() || 'xp-zero';
    if (preset !== 'xp-zero') {
      throw new Error(`Unsupported STRESS_TEST_PRESET: ${preset}`);
    }

    const contractAddress = process.env.STRESS_TEST_CONTRACT_ADDRESS?.trim();
    return {
      blockchain: 'starknet',
      operation: 'xp.test',
      targetRef: 'xp_system',
      payload: {
        address: process.env.STRESS_TEST_TARGET_ADDRESS?.trim() || '0x1',
        seasonId: 0,
        seasonXpLow: '0',
        seasonXpHigh: '0',
        profileXpLow: '0',
        profileXpHigh: '0',
        ...(contractAddress ? { contractAddress } : {}),
      },
      metadata: { stressPreset: preset },
      maxRetries: 0,
    };
  }

  const value = JSON.parse(raw) as Partial<EnqueueTransactionParams>;
  if (!value.blockchain || !value.operation || !isTransactionOperation(value.operation)) {
    throw new Error('Stress intent requires a valid blockchain and operation');
  }
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw new Error('Stress intent requires an object payload');
  }

  return value as EnqueueTransactionParams;
}

function safeRunId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  if (!normalized) {
    throw new Error('STRESS_TEST_RUN_ID must contain at least one letter or number');
  }
  return normalized;
}

function readMode(): 'onchain' | 'database-only' {
  const mode = process.env.STRESS_TEST_MODE?.trim().toLowerCase() || 'onchain';
  if (mode === 'onchain' || mode === 'database-only') {
    return mode;
  }
  throw new Error(`Unsupported STRESS_TEST_MODE: ${mode}`);
}

async function main(): Promise<void> {
  const mode = readMode();
  const expectedConfirmation = mode === 'onchain'
    ? 'I_UNDERSTAND_THIS_WRITES_ONCHAIN'
    : 'I_UNDERSTAND_THIS_WRITES_DATABASE';
  if (process.env.STRESS_TEST_CONFIRM !== expectedConfirmation) {
    throw new Error(
      `Set STRESS_TEST_CONFIRM=${expectedConfirmation} to enqueue the ${mode} stress run`
    );
  }

  const template = readTemplate();
  const count = positiveInt(process.env.STRESS_TEST_COUNT, 200, 5000);
  const insertBatchSize = positiveInt(
    process.env.STRESS_TEST_INSERT_BATCH_SIZE ?? process.env.STRESS_TEST_ENQUEUE_CONCURRENCY,
    50,
    500
  );
  const runId = safeRunId(
    process.env.STRESS_TEST_RUN_ID?.trim() ||
      `stress_${Date.now()}_${randomUUID().slice(0, 8)}`
  );
  const ids: string[] = [];

  console.log(
    `[stress] enqueue_start table=torii_worker_intent_queue mode=${mode} run=${runId} count=${count} insertBatchSize=${insertBatchSize} chain=${template.blockchain} op=${template.operation}`
  );

  for (let offset = 0; offset < count; offset += insertBatchSize) {
    const chunkSize = Math.min(insertBatchSize, count - offset);
    const rows = Array.from({ length: chunkSize }, (_, chunkIndex) => {
      const index = offset + chunkIndex;
      const id = `stress_worker_${runId}_${index}_${randomUUID().slice(0, 8)}`;
      return {
        id,
        blockchain: template.blockchain,
        operation: template.operation,
        target_ref: template.targetRef ?? null,
        payload: { ...template.payload },
        intent_version: template.intentVersion ?? 1,
        metadata: {
          ...(template.metadata ?? {}),
          source: 'manual_stress_test',
          stressRunId: runId,
          stressIndex: index,
          stressMode: mode,
        },
        status: mode === 'onchain' ? 'pending' : 'completed',
        retries: 0,
        max_retries: template.maxRetries ?? 3,
        transaction_hash: mode === 'database-only' ? `simulated:${runId}:${index}` : null,
        completed_at: mode === 'database-only' ? new Date().toISOString() : null,
      };
    });
    const { error } = await supabase.from('torii_worker_intent_queue').insert(rows);
    if (error) {
      throw error;
    }
    const chunkIds = rows.map(row => row.id);
    ids.push(...chunkIds);
    console.log(`[stress] enqueued run=${runId} progress=${ids.length}/${count}`);
  }

  console.log(`[stress] enqueue_done run=${runId} first=${ids[0]} last=${ids.at(-1)}`);
  console.log(
    `[stress] monitor_sql=SELECT status, COUNT(*) FROM torii_worker_intent_queue WHERE metadata->>'stressRunId' = '${runId}' GROUP BY status;`
  );
}

main().catch(error => {
  console.error('[stress] failed:', error);
  process.exitCode = 1;
});
