import { randomUUID } from 'node:crypto';
import { getTransactionQueue } from '../transactionQueue.js';
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
    throw new Error('STRESS_TEST_INTENT_JSON is required');
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

async function main(): Promise<void> {
  if (process.env.STRESS_TEST_CONFIRM !== 'I_UNDERSTAND_THIS_WRITES_ONCHAIN') {
    throw new Error(
      'Set STRESS_TEST_CONFIRM=I_UNDERSTAND_THIS_WRITES_ONCHAIN to enqueue the stress run'
    );
  }

  const template = readTemplate();
  const count = positiveInt(process.env.STRESS_TEST_COUNT, 30, 5000);
  const concurrency = positiveInt(process.env.STRESS_TEST_ENQUEUE_CONCURRENCY, 10, 100);
  const runId = `stress_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const queue = getTransactionQueue();
  const ids: string[] = [];

  console.log(
    `[stress] enqueue_start run=${runId} count=${count} concurrency=${concurrency} chain=${template.blockchain} op=${template.operation}`
  );

  for (let offset = 0; offset < count; offset += concurrency) {
    const chunkSize = Math.min(concurrency, count - offset);
    const chunkIds = await Promise.all(
      Array.from({ length: chunkSize }, (_, chunkIndex) => {
        const index = offset + chunkIndex;
        return queue.enqueue({
          ...template,
          payload: { ...template.payload },
          metadata: {
            ...(template.metadata ?? {}),
            source: 'manual_stress_test',
            stressRunId: runId,
            stressIndex: index,
          },
        });
      })
    );
    ids.push(...chunkIds);
    console.log(`[stress] enqueued run=${runId} progress=${ids.length}/${count}`);
  }

  console.log(`[stress] enqueue_done run=${runId} first=${ids[0]} last=${ids.at(-1)}`);
}

main().catch(error => {
  console.error('[stress] failed:', error);
  process.exitCode = 1;
});
