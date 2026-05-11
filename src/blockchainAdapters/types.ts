import type { BlockchainId, QueuedIntent, TransactionResult } from '../transactionQueueTypes.js';

export interface BlockchainAdapter {
  blockchain: BlockchainId;
  canExecute(intent: QueuedIntent): boolean;
  execute(intent: QueuedIntent): Promise<TransactionResult>;
}
