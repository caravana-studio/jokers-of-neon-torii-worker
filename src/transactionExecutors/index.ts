import { executeCeloQueueTransaction } from './celoTransactionExecutor.js';
import { executeStarknetQueueTransaction } from './starknetTransactionExecutor.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';

export async function executeQueuedTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  switch (transaction.blockchain) {
    case 'starknet':
      return executeStarknetQueueTransaction(transaction);
    case 'celo':
      return executeCeloQueueTransaction(transaction);
    default:
      return {
        success: false,
        error: new Error(`Unsupported blockchain: ${(transaction as { blockchain: string }).blockchain}`),
      };
  }
}
