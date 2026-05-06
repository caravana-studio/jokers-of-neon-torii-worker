import { env } from '../env.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';

function getMissingCeloConfig(): string[] {
  const required: Array<keyof typeof env> = [
    'CELO_RPC_URL',
    'CELO_PRIVATE_KEY',
    'CELO_ADDRESS',
  ];

  return required.filter(key => !env[key]);
}

export async function executeCeloQueueTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  try {
    const missing = getMissingCeloConfig();

    if (missing.length > 0) {
      throw new Error(`Missing Celo write configuration: ${missing.join(', ')}`);
    }

    console.log(`\n📤 Executing Celo transaction...`);
    console.log(`   Contract:   ${transaction.contractAddress}`);
    console.log(`   Entrypoint: ${transaction.entrypoint}`);
    console.log(`   Calldata:   ${JSON.stringify(transaction.calldata)}`);

    throw new Error(
      `Celo executor placeholder reached for ${transaction.entrypoint}. ` +
      'The queue can already route Celo jobs, but the EVM execution is still pending.'
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
