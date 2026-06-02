import { getSlotDailyMissionsSystemAddress } from '../config/manifest.js';
import { executeSlotQueueTransaction } from '../transactionExecutors/slotTransactionExecutor.js';
import {
  isSlotTransactionOperation,
  type QueuedIntent,
  type QueuedTransaction,
  type TransactionResult,
} from '../transactionQueueTypes.js';
import type { BlockchainAdapter } from './types.js';

export function buildSlotTransaction(intent: QueuedIntent): QueuedTransaction {
  switch (intent.operation) {
    case 'missions.generate_daily':
      return {
        id: intent.id,
        blockchain: 'slot',
        contractAddress: getSlotDailyMissionsSystemAddress(),
        entrypoint: 'generate_daily_missions',
        calldata: [],
        retries: intent.retries,
        maxRetries: intent.maxRetries,
        status: intent.status,
      };

    case 'missions.generate_weekly':
      return {
        id: intent.id,
        blockchain: 'slot',
        contractAddress: getSlotDailyMissionsSystemAddress(),
        entrypoint: 'generate_weekly_missions',
        calldata: [],
        retries: intent.retries,
        maxRetries: intent.maxRetries,
        status: intent.status,
      };

    default:
      throw new Error(`Unsupported Slot operation: ${intent.operation}`);
  }
}

export const slotAdapter: BlockchainAdapter = {
  blockchain: 'slot',

  canExecute(intent) {
    return isSlotTransactionOperation(intent.operation);
  },

  async execute(intent: QueuedIntent): Promise<TransactionResult> {
    try {
      return await executeSlotQueueTransaction(buildSlotTransaction(intent));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
