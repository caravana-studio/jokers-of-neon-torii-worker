import { supabase } from './config/supabase.js';
import { env, getWorkerBlockchainFilter } from './env.js';
import { executeQueuedTransaction } from './transactionExecutors/index.js';
import {
  isSupportedBlockchain,
  type EnqueueTransactionParams,
  type QueuedTransaction,
  type TransactionResult,
  type TransactionStatus,
} from './transactionQueueTypes.js';

/**
 * Persistent Transaction Queue Manager
 * Processes transactions sequentially with validation and Supabase persistence
 */
export class TransactionQueue {
  private processing = false;
  private currentTransactionId: string | null = null;
  private useSupabase: boolean;
  private blockchainFilter = getWorkerBlockchainFilter();

  constructor() {
    // Check if Supabase is configured
    this.useSupabase = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

    if (!this.useSupabase) {
      console.warn('⚠️  Supabase not configured - running in memory-only mode');
      console.warn('⚠️  Transactions will be lost on restart!');
    }
  }

  /**
   * Initialize the queue by recovering pending transactions
   */
  public async initialize(): Promise<void> {
    if (!this.useSupabase) {
      console.log('💼 Transaction Queue: Initialized (memory-only mode)');
      return;
    }

    console.log('💼 Transaction Queue: Initializing with Supabase...');
    if (this.blockchainFilter) {
      console.log(`💼 Transaction Queue: filtering blockchain=${this.blockchainFilter}`);
    }

    try {
      // Recover any transactions that were being processed when the worker crashed
      await this.recoverOrphanedTransactions();

      // Count pending transactions
      let countQuery = supabase
        .from('torii_worker_transaction_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (this.blockchainFilter) {
        countQuery = countQuery.eq('blockchain', this.blockchainFilter);
      }

      const { count, error } = await countQuery;

      if (error) throw error;

      console.log(`💼 Transaction Queue: Initialized with Supabase`);
      console.log(`   Pending transactions: ${count || 0}`);

      // Start processing if there are pending transactions
      if (count && count > 0) {
        console.log('🔄 Starting to process pending transactions...');
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
        .from('torii_worker_transaction_queue')
        .update({ status: 'pending' })
        .eq('status', 'processing');

      if (this.blockchainFilter) {
        recoverQuery = recoverQuery.eq('blockchain', this.blockchainFilter);
      }

      const { data, error } = await recoverQuery.select();

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`🔄 Recovered ${data.length} orphaned transaction(s)`);
      }
    } catch (error) {
      console.error('❌ Error recovering orphaned transactions:', error);
    }
  }

  /**
   * Add a transaction to the queue
   */
  public async enqueue(params: EnqueueTransactionParams): Promise<string> {
    const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const maxRetries = params.maxRetries ?? 3;

    console.log(`\n📥 Adding transaction to queue`);
    console.log(`   ID:         ${id}`);
    console.log(`   Blockchain: ${params.blockchain}`);
    console.log(`   Contract:   ${params.contractAddress}`);
    console.log(`   Entrypoint: ${params.entrypoint}`);

    if (this.useSupabase) {
      try {
        // Save to Supabase
        const { error } = await supabase
          .from('torii_worker_transaction_queue')
          .insert({
            id,
            blockchain: params.blockchain,
            contract_address: params.contractAddress,
            entrypoint: params.entrypoint,
            calldata: params.calldata,
            status: 'pending',
            retries: 0,
            max_retries: maxRetries,
          });

        if (error) throw error;

        // Get queue size
        const { count } = await supabase
          .from('torii_worker_transaction_queue')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        console.log(`✅ Transaction saved to database`);
        console.log(`   Queue size: ${count || 0}`);
      } catch (error) {
        console.error('❌ Error saving transaction to database:', error);
        throw error;
      }
    }

    // Start processing if not already processing
    if (!this.processing) {
      this.processQueue();
    }

    return id;
  }

  /**
   * Process the queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (true) {
      // Get next pending transaction
      const transaction = await this.getNextTransaction();

      if (!transaction) {
        // No more transactions to process
        break;
      }

      this.currentTransactionId = transaction.id;

      console.log(`\n⚙️  Processing transaction from queue`);
      console.log(`   ID:         ${transaction.id}`);
      console.log(`   Blockchain: ${transaction.blockchain}`);
      console.log(`   Contract:   ${transaction.contractAddress}`);
      console.log(`   Entrypoint: ${transaction.entrypoint}`);
      console.log(`   Attempt:    ${transaction.retries + 1}/${transaction.maxRetries + 1}`);

      // Mark as processing
      await this.updateTransactionStatus(transaction.id, 'processing');

      const result = await this.executeTransaction(transaction);

      if (result.success) {
        console.log(`✅ Transaction executed successfully: ${result.transactionHash}`);

        // Mark as completed
        await this.updateTransactionStatus(transaction.id, 'completed', {
          transactionHash: result.transactionHash
        });

        this.currentTransactionId = null;

        // Small delay to ensure DB is updated before fetching next transaction
        await this.sleep(100);
      } else {
        console.error(`❌ Transaction failed:`, result.error?.message);

        const newRetries = transaction.retries + 1;

        if (newRetries > transaction.maxRetries) {
          console.error(`🚫 Transaction exceeded max retries (${transaction.maxRetries})`);
          console.error(`   ID: ${transaction.id}`);
          console.error(`   Error: ${result.error?.message}`);

          // Mark as failed
          await this.updateTransactionStatus(transaction.id, 'failed', {
            errorMessage: result.error?.message
          });

          this.currentTransactionId = null;

          // Small delay to ensure DB is updated before fetching next transaction
          await this.sleep(100);
        } else {
          console.log(`🔄 Will retry transaction (${newRetries}/${transaction.maxRetries})`);

          // Update retry count and mark as pending again
          await this.updateTransactionRetries(transaction.id, newRetries);

          // Wait before retry (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, newRetries), 30000);
          console.log(`   Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
        }
      }
    }

    this.processing = false;
    console.log(`\n✅ Queue processing completed. No pending transactions.`);
  }

  /**
   * Get the next pending transaction from the queue
   */
  private async getNextTransaction(): Promise<QueuedTransaction | null> {
    if (!this.useSupabase) {
      return null;
    }

    try {
      let nextQuery = supabase
        .from('torii_worker_transaction_queue')
        .select('*')
        .eq('status', 'pending');

      if (this.blockchainFilter) {
        nextQuery = nextQuery.eq('blockchain', this.blockchainFilter);
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

      return {
        id: data.id,
        blockchain: isSupportedBlockchain(data.blockchain) ? data.blockchain : 'starknet',
        contractAddress: data.contract_address,
        entrypoint: data.entrypoint,
        calldata: data.calldata,
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
    extra?: { transactionHash?: string; errorMessage?: string }
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
        .from('torii_worker_transaction_queue')
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) {
        console.error('❌ Supabase update error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        console.warn(`⚠️  No rows updated for transaction ${id}`);
      } else {
        console.log(`🔄 Status updated: ${id} -> ${status} (${data.length} row(s))`);
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
        .from('torii_worker_transaction_queue')
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
  private async executeTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
    return executeQueuedTransaction(transaction);
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
        supabase.from('torii_worker_transaction_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('torii_worker_transaction_queue').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
        supabase.from('torii_worker_transaction_queue').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('torii_worker_transaction_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
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
