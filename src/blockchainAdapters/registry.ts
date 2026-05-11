import type { BlockchainId, QueuedIntent, TransactionResult } from '../transactionQueueTypes.js';
import type { BlockchainAdapter } from './types.js';

const adapters = new Map<BlockchainId, BlockchainAdapter>();

export function registerBlockchainAdapter(adapter: BlockchainAdapter): void {
  adapters.set(adapter.blockchain, adapter);
}

export function getBlockchainAdapter(blockchain: BlockchainId): BlockchainAdapter | null {
  return adapters.get(blockchain) ?? null;
}

export function isRegisteredBlockchain(blockchain: BlockchainId): boolean {
  return adapters.has(blockchain);
}

export function getRegisteredBlockchains(): BlockchainId[] {
  return Array.from(adapters.keys());
}

export async function executeIntent(intent: QueuedIntent): Promise<TransactionResult> {
  const adapter = getBlockchainAdapter(intent.blockchain);

  if (!adapter) {
    return {
      success: false,
      error: new Error(`Unsupported blockchain: ${intent.blockchain}`),
    };
  }

  if (!adapter.canExecute(intent)) {
    return {
      success: false,
      error: new Error(`Adapter ${adapter.blockchain} cannot execute operation: ${intent.operation}`),
    };
  }

  return adapter.execute(intent);
}
