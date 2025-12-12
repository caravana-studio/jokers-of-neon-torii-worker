import { Account, Call, RpcProvider } from 'starknet';
import { env } from './env.js';

/**
 * Transaction item to be queued
 */
export interface QueuedTransaction {
  id: string;
  contractAddress: string;
  entrypoint: string;
  calldata: any[];
  retries: number;
  maxRetries: number;
  addedAt: Date;
}

/**
 * Result of a transaction execution
 */
export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: Error;
}

/**
 * Transaction Queue Manager
 * Processes transactions sequentially with validation
 */
export class TransactionQueue {
  private queue: QueuedTransaction[] = [];
  private processing = false;
  private currentTransaction: QueuedTransaction | null = null;
  private provider: RpcProvider;
  private account: Account;

  constructor() {
    // Create provider
    this.provider = new RpcProvider({
      nodeUrl: env.STARKNET_RPC_URL,
      default: true
    });

    // Create account
    this.account = new Account({
      provider: this.provider,
      address: env.STARKNET_ADDRESS,
      signer: env.STARKNET_PRIVATE_KEY,
    });
  }

  /**
   * Add a transaction to the queue
   */
  public enqueue(params: {
    contractAddress: string;
    entrypoint: string;
    calldata: any[];
    maxRetries?: number;
  }): string {
    const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const transaction: QueuedTransaction = {
      id,
      contractAddress: params.contractAddress,
      entrypoint: params.entrypoint,
      calldata: params.calldata,
      retries: 0,
      maxRetries: params.maxRetries ?? 3,
      addedAt: new Date(),
    };

    this.queue.push(transaction);

    console.log(`\n📥 Transaction added to queue`);
    console.log(`   ID:         ${id}`);
    console.log(`   Contract:   ${params.contractAddress}`);
    console.log(`   Entrypoint: ${params.entrypoint}`);
    console.log(`   Queue size: ${this.queue.length}`);

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

    while (this.queue.length > 0) {
      const transaction = this.queue[0];
      this.currentTransaction = transaction;

      console.log(`\n⚙️  Processing transaction from queue`);
      console.log(`   ID:         ${transaction.id}`);
      console.log(`   Contract:   ${transaction.contractAddress}`);
      console.log(`   Entrypoint: ${transaction.entrypoint}`);
      console.log(`   Attempt:    ${transaction.retries + 1}/${transaction.maxRetries + 1}`);
      console.log(`   Queue size: ${this.queue.length}`);

      const result = await this.executeTransaction(transaction);

      if (result.success) {
        console.log(`✅ Transaction executed successfully: ${result.transactionHash}`);
        // Remove from queue on success
        this.queue.shift();
        this.currentTransaction = null;
      } else {
        console.error(`❌ Transaction failed:`, result.error?.message);

        transaction.retries++;

        if (transaction.retries > transaction.maxRetries) {
          console.error(`🚫 Transaction exceeded max retries (${transaction.maxRetries}), removing from queue`);
          console.error(`   ID: ${transaction.id}`);
          console.error(`   Error: ${result.error?.message}`);

          // Remove from queue after max retries
          this.queue.shift();
          this.currentTransaction = null;
        } else {
          console.log(`🔄 Will retry transaction (${transaction.retries}/${transaction.maxRetries})`);
          // Wait before retry (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, transaction.retries), 30000);
          console.log(`   Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
        }
      }
    }

    this.processing = false;
    console.log(`\n✅ Queue processing completed. Queue is now empty.`);
  }

  /**
   * Execute a single transaction
   */
  private async executeTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
    try {
      console.log(`\n📤 Executing transaction on Starknet...`);
      console.log(`   Contract:   ${transaction.contractAddress}`);
      console.log(`   Entrypoint: ${transaction.entrypoint}`);
      console.log(`   Calldata:   ${JSON.stringify(transaction.calldata)}`);

      // Prepare the call
      const call: Call = {
        contractAddress: transaction.contractAddress,
        entrypoint: transaction.entrypoint,
        calldata: transaction.calldata
      };

      console.log(`[${new Date().toISOString()}] Executing ${call.entrypoint} on Starknet...`);

      // Execute transaction
      const starknetNonce = await this.account.getNonce();
      const { transaction_hash } = await this.account.execute(call, {
        nonce: starknetNonce,
        skipValidate: true,
      });

      console.log(`✅ Transaction sent: ${transaction_hash}`);

      // Wait for confirmation
      console.log('⏳ Waiting for confirmation...');
      await this.account.waitForTransaction(transaction_hash);

      console.log(`✅ Transaction confirmed: ${transaction_hash}\n`);

      return {
        success: true,
        transactionHash: transaction_hash
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Get current queue status
   */
  public getStatus(): {
    queueSize: number;
    processing: boolean;
    currentTransaction: QueuedTransaction | null;
  } {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      currentTransaction: this.currentTransaction,
    };
  }

  /**
   * Clear the queue (use with caution)
   */
  public clear(): void {
    console.log(`\n🗑️  Clearing transaction queue (${this.queue.length} items)`);
    this.queue = [];
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
