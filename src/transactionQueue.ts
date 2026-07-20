import { createHash } from 'node:crypto';
import { supabase } from './config/supabase.js';
import { env, getWorkerBlockchainFilter } from './env.js';
import { executeIntent, isRegisteredBlockchain } from './blockchainAdapters/index.js';
import {
  markDailyStreakTransactionCompleted,
  markDailyStreakTransactionFailed,
  type DailyStreakPendingMutation,
} from './services/streakCacheService.js';
import {
  isTransactionOperation,
  type EnqueueTransactionParams,
  type QueuedIntent,
  type TransactionResult,
  type TransactionStatus,
} from './transactionQueueTypes.js';
import { getParallelIntentProcessor } from './runtime/ParallelIntentProcessor.js';

const INTENT_QUEUE_TABLE = 'torii_worker_intent_queue';
const SUPPRESS_WORKER_LOGS_METADATA_KEY = 'suppressWorkerLogs';

interface QueueLogOptions {
  log?: boolean;
  dailyStreak?: DailyStreakPendingMutation;
}

function shouldLogMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.[SUPPRESS_WORKER_LOGS_METADATA_KEY] !== true;
}

function shouldLogTransaction(transaction: Pick<QueuedIntent, 'metadata'>): boolean {
  return shouldLogMetadata(transaction.metadata);
}

function compactHash(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function deriveOrderingKey(params: EnqueueTransactionParams): string | null {
  if (params.operation === 'xp.multiplier_set') {
    return `${params.blockchain}:xp-multiplier`;
  }

  if (params.operation === 'progression.sync') {
    const player = String(params.payload.player ?? '').trim().toLowerCase();
    return player ? `${params.blockchain}:progression:${player}` : null;
  }

  if (params.operation === 'game.snapshot' || params.operation === 'round.snapshot') {
    const game = params.payload.game;
    if (game && typeof game === 'object' && !Array.isArray(game)) {
      const gameRecord = game as Record<string, unknown>;
      const gameId = gameRecord.id ?? gameRecord.game_id;
      if (gameId !== undefined && gameId !== null) {
        return `${params.blockchain}:game:${String(gameId)}`;
      }
    }
  }

  return null;
}

export function deriveIntentId(params: EnqueueTransactionParams): string {
  if (params.idempotencyKey) {
    const digest = createHash('sha256')
      .update(`${params.blockchain}\0${params.operation}\0${params.idempotencyKey}`)
      .digest('hex')
      .slice(0, 40);
    return `intent_${digest}`;
  }

  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Persistent Transaction Queue Manager
 * Processes transactions sequentially with validation and Supabase persistence
 */
export class TransactionQueue {
  private enabled = env.TRANSACTION_QUEUE_ENABLED;
  private processing = false;
  private currentTransactionId: string | null = null;
  private useSupabase: boolean;
  private blockchainFilter = getWorkerBlockchainFilter();

  constructor() {
    // Check if Supabase is configured
    this.useSupabase = this.enabled && !!(
      env.SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY
    );

    if (!this.enabled) {
      console.warn('[queue] enabled=false');
    } else if (!this.useSupabase) {
      console.warn('[queue] storage=memory warning=transactions_lost_on_restart');
    }
  }

  /**
   * Initialize the queue by recovering pending transactions
   */
  public async initialize(): Promise<void> {
    if (!this.enabled) {
      console.log('[queue] init enabled=false');
      return;
    }

    if (!this.useSupabase) {
      console.log('[queue] ready storage=memory');
      return;
    }

    if (env.TRANSACTION_EXECUTION_MODE === 'multicall') {
      console.log(`[queue] init storage=supabase mode=multicall filter=${this.blockchainFilter?.join(',') ?? 'all'}`);
      await getParallelIntentProcessor().initialize();
      console.log('[queue] ready mode=multicall');
      return;
    }

    console.log(`[queue] init storage=supabase filter=${this.blockchainFilter?.join(',') ?? 'all'}`);

    try {
      // Recover any transactions that were being processed when the worker crashed
      await this.recoverOrphanedTransactions();

      // Count pending transactions
      let countQuery = supabase
        .from(INTENT_QUEUE_TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (this.blockchainFilter) {
        countQuery = countQuery.in('blockchain', this.blockchainFilter);
      }

      const { count, error } = await countQuery;

      if (error) throw error;

      console.log(`[queue] ready pending=${count || 0}`);

      // Start processing if there are pending transactions
      if (count && count > 0) {
        console.log('[queue] processing_pending=true');
        this.processQueue();
      }
    } catch (error) {
      console.error('❌ Error initializing transaction queue:', error);
      console.warn('⚠️  Falling back to memory-only mode');
      this.useSupabase = false;
    }
  }

  /**
   * Recover transactions that were marked as 'processing' but never completed
   * This happens when the worker crashes or restarts
   */
  private async recoverOrphanedTransactions(): Promise<void> {
    try {
      let recoverQuery = supabase
        .from(INTENT_QUEUE_TABLE)
        .update({ status: 'pending' })
        .eq('status', 'processing');

      if (this.blockchainFilter) {
        recoverQuery = recoverQuery.in('blockchain', this.blockchainFilter);
      }

      const { data, error } = await recoverQuery.select();

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`[queue] recovered_orphaned count=${data.length}`);
      }
    } catch (error) {
      console.error('❌ Error recovering orphaned transactions:', error);
    }
  }

  /**
   * Add a transaction to the queue
   */
  public async enqueue(params: EnqueueTransactionParams, options: QueueLogOptions = {}): Promise<string> {
    if (!this.enabled) {
      throw new Error('Transaction queue is disabled (TRANSACTION_QUEUE_ENABLED=false)');
    }

    const id = deriveIntentId(params);
    const maxRetries = params.maxRetries ?? 3;
    const shouldLog = options.log !== false && shouldLogMetadata(params.metadata);

    if (shouldLog) {
      console.log(
        `[queue] enqueue id=${id} chain=${params.blockchain} op=${params.operation} target=${params.targetRef ?? 'default'}`
      );
    }

    if (this.useSupabase) {
      try {
        const intentRow = {
          id,
          blockchain: params.blockchain,
          operation: params.operation,
          target_ref: params.targetRef ?? null,
          payload: params.payload,
          intent_version: params.intentVersion ?? 1,
          metadata: params.metadata ?? {},
          ordering_key: deriveOrderingKey(params),
          status: 'pending',
          retries: 0,
          max_retries: maxRetries,
        };
        const { data, error } = options.dailyStreak
          ? await supabase.rpc('enqueue_daily_streak_intent', {
              p_intent: intentRow,
              p_streak: options.dailyStreak.streak,
              p_event: options.dailyStreak.event,
            })
          : params.idempotencyKey
            ? await supabase
                .from(INTENT_QUEUE_TABLE)
                .upsert(intentRow, { onConflict: 'id', ignoreDuplicates: true })
                .select('id')
            : await supabase.from(INTENT_QUEUE_TABLE).insert(intentRow);

        if (error) throw error;

        const rpcResult = options.dailyStreak && data && typeof data === 'object'
          ? data as Record<string, unknown>
          : null;
        const wasDeduplicated = rpcResult?.enqueued === false ||
          (params.idempotencyKey && Array.isArray(data) && data.length === 0);

        if (shouldLog && wasDeduplicated) {
          console.log(`[queue] deduplicated id=${id}`);
        }

        // Get queue size
        const { count } = await supabase
          .from(INTENT_QUEUE_TABLE)
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        if (shouldLog) {
          console.log(`[queue] saved id=${id} pending=${count || 0}`);
        }
      } catch (error) {
        console.error('❌ Error saving transaction to database:', error);
        throw error;
      }
    }

    // Start processing if not already processing
    if (env.TRANSACTION_EXECUTION_MODE === 'multicall') {
      getParallelIntentProcessor().start();
    } else if (!this.processing) {
      this.processQueue();
    }

    return id;
  }

  /**
   * Process the queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (env.TRANSACTION_EXECUTION_MODE === 'multicall') {
      return;
    }

    if (this.processing) {
      return;
    }

    this.processing = true;
    let loggedAnyTransaction = false;

    while (true) {
      // Get next pending transaction
      const transaction = await this.getNextTransaction();

      if (!transaction) {
        // No more transactions to process
        break;
      }

      this.currentTransactionId = transaction.id;
      const shouldLog = shouldLogTransaction(transaction);
      loggedAnyTransaction ||= shouldLog;

      if (shouldLog) {
        console.log(
          `[queue] processing id=${transaction.id} chain=${transaction.blockchain} op=${transaction.operation} target=${transaction.targetRef ?? 'default'} attempt=${transaction.retries + 1}/${transaction.maxRetries + 1}`
        );
      }

      // Mark as processing
      await this.updateTransactionStatus(transaction.id, 'processing', undefined, { log: shouldLog });

      const result = await this.executeTransaction(transaction);

      if (result.success) {
        if (!result.transactionHash) {
          const errorMessage = 'Transaction adapter returned success without transactionHash';
          console.error('[queue] transaction_success_missing_hash:', {
            id: transaction.id,
            blockchain: transaction.blockchain,
            operation: transaction.operation,
            targetRef: transaction.targetRef,
            payload: transaction.payload,
            metadata: transaction.metadata,
          });

          await this.updateTransactionStatus(transaction.id, 'failed', { errorMessage });
          this.currentTransactionId = null;
          await this.sleep(100);
          continue;
        }

        if (shouldLog) {
          console.log(`[queue] completed id=${transaction.id} hash=${compactHash(result.transactionHash)}`);
        }

        // Mark as completed
        await this.updateTransactionStatus(transaction.id, 'completed', {
          transactionHash: result.transactionHash
        }, { log: shouldLog });
        await markDailyStreakTransactionCompleted(transaction, result);

        this.currentTransactionId = null;

        // Small delay to ensure DB is updated before fetching next transaction
        await this.sleep(100);
      } else {
        console.error('[queue] transaction_failed:', {
          id: transaction.id,
          blockchain: transaction.blockchain,
          operation: transaction.operation,
          targetRef: transaction.targetRef,
          attempt: transaction.retries + 1,
          maxAttempts: transaction.maxRetries + 1,
          payload: transaction.payload,
          metadata: transaction.metadata,
          error: result.error,
        });

        const newRetries = transaction.retries + 1;

        if (newRetries > transaction.maxRetries) {
          console.error('[queue] transaction_max_retries_exceeded:', {
            id: transaction.id,
            retries: newRetries,
            maxRetries: transaction.maxRetries,
            error: result.error,
          });

          // Mark as failed
          await this.updateTransactionStatus(transaction.id, 'failed', {
            errorMessage: result.error?.message
          });
          await markDailyStreakTransactionFailed(transaction, result.error?.message);

          this.currentTransactionId = null;

          // Small delay to ensure DB is updated before fetching next transaction
          await this.sleep(100);
        } else {
          if (shouldLog) {
            console.log(`[queue] retry id=${transaction.id} attempt=${newRetries}/${transaction.maxRetries}`);
          }

          // Update retry count and mark as pending again
          await this.updateTransactionRetries(transaction.id, newRetries);

          // Wait before retry (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, newRetries), 30000);
          if (shouldLog) {
            console.log(`[queue] retry_wait id=${transaction.id} waitMs=${waitTime}`);
          }
          await this.sleep(waitTime);
        }
      }
    }

    this.processing = false;
    if (loggedAnyTransaction) {
      console.log('[queue] idle pending=0');
    }
  }

  /**
   * Get the next pending transaction from the queue
   */
  private async getNextTransaction(): Promise<QueuedIntent | null> {
    if (!this.useSupabase) {
      return null;
    }

    try {
      let nextQuery = supabase
        .from(INTENT_QUEUE_TABLE)
        .select('*')
        .eq('status', 'pending');

      if (this.blockchainFilter) {
        nextQuery = nextQuery.in('blockchain', this.blockchainFilter);
      }

      const { data, error } = await nextQuery
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          return null;
        }
        throw error;
      }

      if (!data) return null;

      if (!isRegisteredBlockchain(data.blockchain)) {
        await this.updateTransactionStatus(data.id, 'failed', {
          errorMessage: `Unsupported blockchain: ${String(data.blockchain)}`,
        });
        return this.getNextTransaction();
      }

      if (!isTransactionOperation(data.operation)) {
        await this.updateTransactionStatus(data.id, 'failed', {
          errorMessage: `Unsupported operation: ${String(data.operation)}`,
        });
        return this.getNextTransaction();
      }

      return {
        id: data.id,
        blockchain: data.blockchain,
        operation: data.operation,
        targetRef: data.target_ref ?? undefined,
        payload: (data.payload ?? {}) as Record<string, unknown>,
        intentVersion: data.intent_version ?? 1,
        metadata: (data.metadata ?? {}) as Record<string, unknown>,
        retries: data.retries,
        maxRetries: data.max_retries,
        status: data.status as TransactionStatus,
      };
    } catch (error) {
      console.error('❌ Error fetching next transaction:', error);
      return null;
    }
  }

  /**
   * Update transaction status in database
   */
  private async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    extra?: { transactionHash?: string; errorMessage?: string },
    options: QueueLogOptions = {}
  ): Promise<void> {
    if (!this.useSupabase) {
      return;
    }

    try {
      const updateData: any = { status };

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      if (extra?.transactionHash) {
        updateData.transaction_hash = extra.transactionHash;
      }

      if (extra?.errorMessage) {
        updateData.error_message = extra.errorMessage;
      }

      const { error, data } = await supabase
        .from(INTENT_QUEUE_TABLE)
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) {
        console.error('❌ Supabase update error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        console.warn(`⚠️  No rows updated for transaction ${id}`);
      }
    } catch (error) {
      console.error('❌ Error updating transaction status:', error);
      console.error('   Transaction ID:', id);
      console.error('   Attempted status:', status);
    }
  }

  /**
   * Update transaction retry count
   */
  private async updateTransactionRetries(id: string, retries: number): Promise<void> {
    if (!this.useSupabase) {
      return;
    }

    try {
      const { error } = await supabase
        .from(INTENT_QUEUE_TABLE)
        .update({
          retries,
          status: 'pending' // Mark as pending for retry
        })
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('❌ Error updating transaction retries:', error);
    }
  }

  /**
   * Execute a single transaction
   */
  private async executeTransaction(transaction: QueuedIntent): Promise<TransactionResult> {
    return executeIntent(transaction);
  }

  /**
   * Get current queue status
   */
  public async getStatus(): Promise<{
    pendingCount: number;
    processingCount: number;
    completedCount: number;
    failedCount: number;
    currentTransactionId: string | null;
  }> {
    if (!this.useSupabase) {
      return {
        pendingCount: 0,
        processingCount: 0,
        completedCount: 0,
        failedCount: 0,
        currentTransactionId: this.currentTransactionId,
      };
    }

    try {
      const [pending, processing, completed, failed] = await Promise.all([
        supabase.from(INTENT_QUEUE_TABLE).select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from(INTENT_QUEUE_TABLE).select('*', { count: 'exact', head: true }).in('status', ['processing', 'submitted']),
        supabase.from(INTENT_QUEUE_TABLE).select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from(INTENT_QUEUE_TABLE).select('*', { count: 'exact', head: true }).eq('status', 'failed'),
      ]);

      return {
        pendingCount: pending.count || 0,
        processingCount: processing.count || 0,
        completedCount: completed.count || 0,
        failedCount: failed.count || 0,
        currentTransactionId: this.currentTransactionId,
      };
    } catch (error) {
      console.error('❌ Error getting queue status:', error);
      return {
        pendingCount: 0,
        processingCount: 0,
        completedCount: 0,
        failedCount: 0,
        currentTransactionId: this.currentTransactionId,
      };
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public async shutdown(): Promise<void> {
    if (env.TRANSACTION_EXECUTION_MODE === 'multicall') {
      await getParallelIntentProcessor().stop();
    }
  }
}

// Singleton instance
let queueInstance: TransactionQueue | null = null;

/**
 * Get or create the singleton queue instance
 */
export function getTransactionQueue(): TransactionQueue {
  if (!queueInstance) {
    queueInstance = new TransactionQueue();
  }
  return queueInstance;
}
