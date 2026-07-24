import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { supabase } from '../config/supabase.js';
import { executeIntent, getRegisteredBlockchains } from '../blockchainAdapters/index.js';
import { env, getWorkerBlockchainFilter } from '../env.js';
import {
  markDailyStreakTransactionCompleted,
  markDailyStreakTransactionFailed,
} from '../services/streakCacheService.js';
import {
  executeStarknetIntentBatch,
  getStarknetAccountNonceState,
  inspectStarknetTransaction,
  type StarknetBatchExecutorAccount,
} from '../transactionExecutors/starknetBatchTransactionExecutor.js';
import {
  classifySubmittedNonce,
  hasExplicitMempoolEviction,
  isSubmittedBatchRecoveryDue,
} from './submittedBatchRecovery.js';
import type {
  BlockchainId,
  QueuedIntent,
  TransactionResult,
  TransactionStatus,
} from '../transactionQueueTypes.js';

const INTENT_QUEUE_TABLE = 'torii_worker_intent_queue';
const BATCH_TABLE = 'torii_worker_transaction_batches';

interface ClaimedStarknetBatch {
  id: string;
  executor: StarknetBatchExecutorAccount;
  intents: QueuedIntent[];
}

interface StoredBatchRow {
  id: string;
  executor_id: number;
  executor_address: string;
  transaction_ids: string[];
  transaction_hash: string | null;
  nonce: string | null;
  submitted_at: string | null;
  error_message: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a database row object');
  }
  return value as Record<string, unknown>;
}

function parseIntentRow(value: unknown): QueuedIntent {
  const row = asRecord(value);
  return {
    id: String(row.id),
    blockchain: String(row.blockchain),
    operation: String(row.operation) as QueuedIntent['operation'],
    targetRef: row.target_ref == null ? undefined : String(row.target_ref),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    intentVersion: Number(row.intent_version ?? 1),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    retries: Number(row.retries ?? 0),
    maxRetries: Number(row.max_retries ?? 3),
    status: String(row.status) as TransactionStatus,
  };
}

function compact(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export class ParallelIntentProcessor {
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly activeStarknetBatches = new Map<string, Promise<void>>();
  private readonly activeChainLanes = new Map<BlockchainId, Promise<void>>();
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private lastReconciliationAt = 0;
  private lastRecoveryAt = Date.now();

  public async initialize(): Promise<void> {
    if (this.running) {
      return;
    }

    const { data: recovered, error: recoveryError } = await supabase.rpc(
      'recover_torii_worker_orphaned_work'
    );
    if (recoveryError) {
      throw new Error(
        `Parallel queue migration is missing or invalid: ${recoveryError.message}`
      );
    }

    const filter = getWorkerBlockchainFilter();
    if (!filter || filter.includes('starknet')) {
      let executorQuery = supabase
        .from('executor_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      if (env.STARKNET_EXECUTOR_IDS.length > 0) {
        executorQuery = executorQuery.in('id', env.STARKNET_EXECUTOR_IDS);
      }
      const { count, error } = await executorQuery;
      if (error) {
        throw new Error(`Could not inspect Starknet executor pool: ${error.message}`);
      }
      if (!count) {
        throw new Error('No active Starknet executor accounts are available for the worker');
      }
      console.log(
        `[parallel-queue] executors=${count} maxConcurrent=${env.STARKNET_MAX_CONCURRENT_BATCHES} batchSize=${env.STARKNET_BATCH_SIZE} batchWaitMs=${env.STARKNET_BATCH_WAIT_TIME_MS}`
      );
    }

    console.log(`[parallel-queue] recovered=${Number(recovered ?? 0)} worker=${this.workerId}`);
    this.running = true;
    this.loopPromise = this.processLoop();
  }

  public start(): void {
    if (!this.running) {
      return;
    }
    // The polling loop is continuous. This method exists so enqueue can make
    // the mode distinction explicit without spawning duplicate loops.
  }

  public async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;

    const activeTasks = [
      ...this.activeStarknetBatches.values(),
      ...this.activeChainLanes.values(),
    ];
    if (activeTasks.length === 0) {
      return;
    }

    console.log(`[parallel-queue] draining active=${activeTasks.length}`);
    const drained = await Promise.race([
      Promise.allSettled(activeTasks).then(() => true),
      this.sleep(25000).then(() => false),
    ]);
    console.log(`[parallel-queue] drain_complete=${drained}`);
  }

  private async processLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.recoverOrphanedWorkIfDue();
        await this.reconcileSubmittedBatchesIfDue();
        await this.fillStarknetCapacity();

        const filter = getWorkerBlockchainFilter();
        for (const blockchain of getRegisteredBlockchains()) {
          if (blockchain === 'starknet' || (filter && !filter.includes(blockchain))) {
            continue;
          }
          await this.startChainLane(blockchain);
        }
      } catch (error) {
        console.error('[parallel-queue] cycle_failed:', error);
      }

      await this.sleep(env.TRANSACTION_QUEUE_POLL_INTERVAL_MS);
    }
  }

  private async fillStarknetCapacity(): Promise<void> {
    const filter = getWorkerBlockchainFilter();
    if (filter && !filter.includes('starknet')) {
      return;
    }

    while (
      this.running &&
      this.activeStarknetBatches.size < env.STARKNET_MAX_CONCURRENT_BATCHES
    ) {
      const batch = await this.claimStarknetBatch();
      if (!batch) {
        return;
      }

      const task = this.processStarknetBatch(batch)
        .catch(error => {
          console.error(`[parallel-queue] batch_unhandled id=${batch.id}:`, error);
        })
        .finally(() => {
          this.activeStarknetBatches.delete(batch.id);
        });
      this.activeStarknetBatches.set(batch.id, task);
    }
  }

  private async claimStarknetBatch(): Promise<ClaimedStarknetBatch | null> {
    const proposedBatchId = `worker_batch_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const { data, error } = await supabase.rpc('claim_torii_worker_starknet_batch', {
      p_worker_id: this.workerId,
      p_batch_id: proposedBatchId,
      p_max_batch_size: env.STARKNET_BATCH_SIZE,
      p_batch_wait_ms: env.STARKNET_BATCH_WAIT_TIME_MS,
      p_lease_ms: env.TRANSACTION_QUEUE_LEASE_MS,
      p_executor_ids:
        env.STARKNET_EXECUTOR_IDS.length > 0 ? env.STARKNET_EXECUTOR_IDS : null,
    });

    if (error) {
      throw new Error(`Could not claim Starknet batch: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      return null;
    }

    const record = asRecord(row);
    const intentsValue = record.claimed_intents;
    if (!Array.isArray(intentsValue) || intentsValue.length === 0) {
      throw new Error(`Claimed batch ${proposedBatchId} did not return intents`);
    }

    return {
      id: String(record.claimed_batch_id),
      executor: {
        id: Number(record.claimed_executor_id),
        name: String(record.claimed_executor_name),
        address: String(record.claimed_executor_address),
        privateKey: String(record.claimed_executor_private_key),
      },
      intents: intentsValue.map(parseIntentRow),
    };
  }

  private async processStarknetBatch(batch: ClaimedStarknetBatch): Promise<void> {
    console.log(
      `[parallel-queue] batch_start id=${batch.id} executor=${batch.executor.name} account=${compact(batch.executor.address)} calls=${batch.intents.length}`
    );

    const result = await executeStarknetIntentBatch(
      batch.intents,
      batch.executor,
      (transactionHash, nonce) => this.markBatchSubmitted(batch, transactionHash, nonce)
    );

    if (result.status === 'succeeded') {
      await this.completeBatch(
        batch.id,
        batch.executor.id,
        batch.intents,
        result.transactionHash,
        result.actualFee
      );
      return;
    }

    if (result.status === 'reverted') {
      await this.failBatch(
        batch.id,
        batch.executor.id,
        batch.intents,
        result.error.message,
        result.actualFee
      );
      return;
    }

    if (result.status === 'not_submitted') {
      if (result.retryAsBatch) {
        await this.retryBatch(
          batch.id,
          batch.executor.id,
          batch.intents,
          result.error.message
        );
        return;
      }
      await this.failBatch(
        batch.id,
        batch.executor.id,
        batch.intents,
        result.error.message
      );
      return;
    }

    // An accepted hash with an inconclusive receipt must never be requeued.
    // Keep the executor reserved and let reconciliation resolve it by hash.
    await this.ensureBatchSubmitted(
      batch,
      result.transactionHash,
      result.nonce,
      result.error.message
    );
    console.warn(
      `[parallel-queue] batch_submitted_unknown id=${batch.id} hash=${compact(result.transactionHash)} error=${result.error.message}`
    );
  }

  private async ensureBatchSubmitted(
    batch: ClaimedStarknetBatch,
    transactionHash: string,
    nonce: string,
    errorMessageValue: string | null = null
  ): Promise<void> {
    const submittedAt = new Date().toISOString();
    const { error } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'submitted',
        transaction_hash: transactionHash,
        nonce,
        submitted_at: submittedAt,
        error_message: errorMessageValue,
      })
      .eq('id', batch.id)
      .in('status', ['processing', 'submitted']);
    if (error) {
      throw error;
    }

    const { error: intentError } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .update({
        status: 'submitted',
        transaction_hash: transactionHash,
      })
      .eq('batch_id', batch.id)
      .in('status', ['processing', 'submitted']);
    if (intentError) {
      throw intentError;
    }
  }

  private async markBatchSubmitted(
    batch: ClaimedStarknetBatch,
    transactionHash: string,
    nonce: string
  ): Promise<void> {
    // Persist the batch hash first. If the intent update is interrupted, a
    // submitted-unknown retry calls the same idempotent helper and repairs it.
    await this.ensureBatchSubmitted(batch, transactionHash, nonce);

    console.log(
      `[parallel-queue] batch_submitted id=${batch.id} hash=${compact(transactionHash)} nonce=${nonce}`
    );
  }

  private async completeBatch(
    batchId: string,
    executorId: number,
    intents: QueuedIntent[],
    transactionHash: string,
    actualFee?: unknown
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const { error: intentError } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .update({
        status: 'completed',
        transaction_hash: transactionHash,
        completed_at: completedAt,
        lease_owner: null,
        lease_expires_at: null,
        error_message: null,
      })
      .eq('batch_id', batchId)
      .in('status', ['processing', 'submitted']);
    if (intentError) {
      throw intentError;
    }

    await this.releaseExecutor(executorId, batchId, true);

    const { error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'completed',
        transaction_hash: transactionHash,
        actual_fee: actualFee ?? null,
        completed_at: completedAt,
        error_message: null,
      })
      .eq('id', batchId)
      .in('status', ['processing', 'submitted']);
    if (batchError) {
      throw batchError;
    }

    for (const intent of intents) {
      await markDailyStreakTransactionCompleted(intent, {
        success: true,
        transactionHash,
      });
    }

    console.log(
      `[parallel-queue] batch_completed id=${batchId} hash=${compact(transactionHash)} calls=${intents.length}`
    );
  }

  private async failBatch(
    batchId: string,
    executorId: number,
    intents: QueuedIntent[],
    reason: string,
    actualFee?: unknown
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const isolateCalls = intents.length > 1;

    for (const intent of intents) {
      if (isolateCalls) {
        const { error } = await supabase
          .from(INTENT_QUEUE_TABLE)
          .update({
            status: 'pending',
            batch_id: null,
            force_single: true,
            available_at: new Date().toISOString(),
            lease_owner: null,
            lease_expires_at: null,
            transaction_hash: null,
            error_message: `Batch failed; isolated for single-call retry: ${reason}`,
          })
          .eq('id', intent.id)
          .eq('batch_id', batchId)
          .in('status', ['processing', 'submitted']);
        if (error) {
          throw error;
        }
        continue;
      }

      const retries = intent.retries + 1;
      if (retries > intent.maxRetries) {
        const { error } = await supabase
          .from(INTENT_QUEUE_TABLE)
          .update({
            status: 'failed',
            retries,
            completed_at: completedAt,
            lease_owner: null,
            lease_expires_at: null,
            error_message: reason,
          })
          .eq('id', intent.id)
          .eq('batch_id', batchId);
        if (error) {
          throw error;
        }
        await markDailyStreakTransactionFailed(intent, reason);
      } else {
        const backoffMs = Math.min(1000 * 2 ** retries, 30000);
        const { error } = await supabase
          .from(INTENT_QUEUE_TABLE)
          .update({
            status: 'pending',
            batch_id: null,
            retries,
            force_single: true,
            available_at: new Date(Date.now() + backoffMs).toISOString(),
            lease_owner: null,
            lease_expires_at: null,
            transaction_hash: null,
            error_message: reason,
          })
          .eq('id', intent.id)
          .eq('batch_id', batchId);
        if (error) {
          throw error;
        }
      }
    }

    await this.releaseExecutor(executorId, batchId, false, reason);
    const { error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'failed',
        actual_fee: actualFee ?? null,
        error_message: reason,
        completed_at: completedAt,
      })
      .eq('id', batchId);
    if (batchError) {
      throw batchError;
    }

    console.error(
      `[parallel-queue] batch_failed id=${batchId} calls=${intents.length} isolated=${isolateCalls} error=${reason}`
    );
  }

  private async retryBatch(
    batchId: string,
    executorId: number,
    intents: QueuedIntent[],
    reason: string
  ): Promise<void> {
    const retryAt = new Date(Date.now() + 2000).toISOString();
    const intentIds = intents.map(intent => intent.id);
    const { error: intentError } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .update({
        status: 'pending',
        batch_id: null,
        available_at: retryAt,
        lease_owner: null,
        lease_expires_at: null,
        transaction_hash: null,
        error_message: `Transient batch error: ${reason}`,
      })
      .in('id', intentIds)
      .eq('batch_id', batchId)
      .eq('status', 'processing');
    if (intentError) {
      throw intentError;
    }

    await this.releaseExecutor(executorId, batchId, false, reason);
    const { error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'failed',
        error_message: `Transient pre-submission error; requeued as batch: ${reason}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .eq('status', 'processing');
    if (batchError) {
      throw batchError;
    }

    console.warn(
      `[parallel-queue] batch_retry id=${batchId} calls=${intents.length} retryAt=${retryAt} error=${reason}`
    );
  }

  private async quarantineSubmittedBatch(
    batch: StoredBatchRow,
    intents: QueuedIntent[],
    reason: string
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const { error: intentError } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .update({
        status: 'failed',
        completed_at: completedAt,
        lease_owner: null,
        lease_expires_at: null,
        error_message: reason,
      })
      .eq('batch_id', batch.id)
      .eq('status', 'submitted');
    if (intentError) {
      throw intentError;
    }

    await this.releaseExecutor(batch.executor_id, batch.id, false, reason);

    const { error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'failed',
        completed_at: completedAt,
        error_message: reason,
      })
      .eq('id', batch.id)
      .eq('status', 'submitted');
    if (batchError) {
      throw batchError;
    }

    for (const intent of intents) {
      await markDailyStreakTransactionFailed(intent, reason);
    }

    console.error(
      `[parallel-queue] batch_quarantined id=${batch.id} hash=${compact(batch.transaction_hash ?? '')} reason=${reason}`
    );
  }

  private async releaseExecutor(
    executorId: number,
    batchId: string,
    success: boolean,
    reason?: string
  ): Promise<void> {
    const { data, error } = await supabase.rpc('release_torii_worker_executor', {
      p_executor_id: executorId,
      p_batch_id: batchId,
      p_success: success,
      p_error_message: reason ?? null,
    });
    if (error) {
      throw error;
    }
    if (!data) {
      console.warn(
        `[parallel-queue] executor_release_skipped executor=${executorId} batch=${batchId}`
      );
    }
  }

  private async reconcileSubmittedBatchesIfDue(): Promise<void> {
    if (Date.now() - this.lastReconciliationAt < 5000) {
      return;
    }
    this.lastReconciliationAt = Date.now();

    const { data, error } = await supabase
      .from(BATCH_TABLE)
      .select(
        'id, executor_id, executor_address, transaction_ids, transaction_hash, nonce, submitted_at, error_message'
      )
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true })
      .limit(20);
    if (error) {
      throw error;
    }

    for (const rawBatch of data ?? []) {
      const batch = rawBatch as StoredBatchRow;
      if (
        !batch.transaction_hash ||
        this.activeStarknetBatches.has(batch.id)
      ) {
        continue;
      }

      const inspection = await inspectStarknetTransaction(batch.transaction_hash);
      if (inspection.status === 'unknown') {
        if (!isSubmittedBatchRecoveryDue({
          submittedAt: batch.submitted_at,
          errorMessage: batch.error_message,
          timeoutMs: env.STARKNET_SUBMITTED_UNKNOWN_TIMEOUT_MS,
        })) {
          continue;
        }

        if (!batch.nonce || !batch.executor_address) {
          const intents = await this.loadIntents(batch.transaction_ids);
          await this.quarantineSubmittedBatch(
            batch,
            intents,
            `Submitted transaction remained unknown without nonce metadata: ${inspection.error ?? 'receipt unavailable'}`
          );
          continue;
        }

        let currentNonce: Awaited<ReturnType<typeof getStarknetAccountNonceState>>;
        try {
          currentNonce = await getStarknetAccountNonceState(batch.executor_address);
        } catch (nonceError) {
          console.warn(
            `[parallel-queue] submitted_nonce_check_failed id=${batch.id} hash=${compact(batch.transaction_hash)} error=${nonceError instanceof Error ? nonceError.message : String(nonceError)}`
          );
          continue;
        }

        const explicitlyEvicted = hasExplicitMempoolEviction(batch.error_message);
        const nonceDecision = classifySubmittedNonce(
          batch.nonce,
          currentNonce,
          explicitlyEvicted
        );

        const intents = await this.loadIntents(batch.transaction_ids);
        const recoveryReason =
          `Submitted transaction remained unknown after mempool/receipt timeout; ` +
          `submittedNonce=${batch.nonce} latestNonce=0x${currentNonce.latest.toString(16)} ` +
          `preConfirmedNonce=0x${currentNonce.preConfirmed.toString(16)} ` +
          `explicitlyEvicted=${explicitlyEvicted} inspection=${inspection.error ?? 'unknown'}`;

        if (nonceDecision === 'retry') {
          console.warn(
            `[parallel-queue] submitted_requeue id=${batch.id} hash=${compact(batch.transaction_hash)} nonce=${batch.nonce}`
          );
          await this.failBatch(
            batch.id,
            batch.executor_id,
            intents,
            recoveryReason
          );
        } else {
          await this.quarantineSubmittedBatch(batch, intents, recoveryReason);
        }
        continue;
      }

      const intents = await this.loadIntents(batch.transaction_ids);
      if (inspection.status === 'succeeded') {
        await this.completeBatch(
          batch.id,
          batch.executor_id,
          intents,
          batch.transaction_hash,
          inspection.actualFee
        );
      } else {
        await this.failBatch(
          batch.id,
          batch.executor_id,
          intents,
          inspection.error,
          inspection.actualFee
        );
      }
    }
  }

  private async recoverOrphanedWorkIfDue(): Promise<void> {
    if (Date.now() - this.lastRecoveryAt < 30000) {
      return;
    }
    this.lastRecoveryAt = Date.now();

    const { data, error } = await supabase.rpc('recover_torii_worker_orphaned_work');
    if (error) {
      throw error;
    }
    const recovered = Number(data ?? 0);
    if (recovered > 0) {
      console.warn(`[parallel-queue] recovered_expired=${recovered}`);
    }
  }

  private async loadIntents(transactionIds: string[]): Promise<QueuedIntent[]> {
    const { data, error } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .select('*')
      .in('id', transactionIds);
    if (error) {
      throw error;
    }

    const byId = new Map((data ?? []).map(row => [String(row.id), parseIntentRow(row)]));
    return transactionIds.map(id => {
      const intent = byId.get(id);
      if (!intent) {
        throw new Error(`Batch intent not found: ${id}`);
      }
      return intent;
    });
  }

  private async startChainLane(blockchain: BlockchainId): Promise<boolean> {
    if (this.activeChainLanes.has(blockchain)) {
      return false;
    }

    const { data, error } = await supabase.rpc('claim_torii_worker_single_intent', {
      p_worker_id: this.workerId,
      p_blockchain: blockchain,
      p_lease_ms: env.TRANSACTION_QUEUE_LEASE_MS,
    });
    if (error) {
      throw new Error(`Could not claim ${blockchain} intent: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      return false;
    }

    const intent = parseIntentRow(asRecord(row).claimed_intent);
    const task = this.processSingleIntent(intent)
      .catch(processError => {
        console.error(`[parallel-queue] lane_failed chain=${blockchain}:`, processError);
      })
      .finally(() => this.activeChainLanes.delete(blockchain));
    this.activeChainLanes.set(blockchain, task);
    return true;
  }

  private async processSingleIntent(intent: QueuedIntent): Promise<void> {
    console.log(
      `[parallel-queue] lane_start chain=${intent.blockchain} id=${intent.id} op=${intent.operation}`
    );
    const result = await executeIntent(intent);
    if (result.success && result.transactionHash) {
      await this.completeSingleIntent(intent, result);
      return;
    }

    await this.failSingleIntent(
      intent,
      result.error?.message ?? 'Transaction failed without an error message'
    );
  }

  private async completeSingleIntent(
    intent: QueuedIntent,
    result: TransactionResult
  ): Promise<void> {
    const { error } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .update({
        status: 'completed',
        transaction_hash: result.transactionHash,
        completed_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq('id', intent.id)
      .eq('status', 'processing');
    if (error) {
      throw error;
    }
    await markDailyStreakTransactionCompleted(intent, result);
    console.log(
      `[parallel-queue] lane_completed chain=${intent.blockchain} id=${intent.id} hash=${compact(result.transactionHash!)}`
    );
  }

  private async failSingleIntent(intent: QueuedIntent, reason: string): Promise<void> {
    const retries = intent.retries + 1;
    if (retries > intent.maxRetries) {
      const { error } = await supabase
        .from(INTENT_QUEUE_TABLE)
        .update({
          status: 'failed',
          retries,
          error_message: reason,
          completed_at: new Date().toISOString(),
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq('id', intent.id)
        .eq('status', 'processing');
      if (error) {
        throw error;
      }
      await markDailyStreakTransactionFailed(intent, reason);
      return;
    }

    const backoffMs = Math.min(1000 * 2 ** retries, 30000);
    const { error } = await supabase
      .from(INTENT_QUEUE_TABLE)
      .update({
        status: 'pending',
        retries,
        error_message: reason,
        available_at: new Date(Date.now() + backoffMs).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq('id', intent.id)
      .eq('status', 'processing');
    if (error) {
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let instance: ParallelIntentProcessor | null = null;

export function getParallelIntentProcessor(): ParallelIntentProcessor {
  if (!instance) {
    instance = new ParallelIntentProcessor();
  }
  return instance;
}
