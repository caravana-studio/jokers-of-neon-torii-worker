import { Account, Call, RpcProvider, type UniversalDetails } from 'starknet';
import { env } from '../env.js';
import { getSlotInstance, getSlotRpcUrl } from '../config/slotConfig.js';
import { withStarknetWriteLock } from '../runtime/StarknetWriteCoordinator.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';
import { ensureStarknetRpcReachable } from './starknetTransactionExecutor.js';

function getSlotProvider(): RpcProvider {
  return new RpcProvider({
    nodeUrl: getSlotRpcUrl(),
  });
}

function getSlotAccount(): Account {
  return new Account({
    provider: getSlotProvider(),
    address: env.SLOT_MASTER_ADDRESS,
    signer: env.SLOT_MASTER_PRIVATE_KEY,
  });
}

function ensureSlotWriteConfig(): void {
  const required: Array<keyof typeof env> = ['SLOT_MASTER_ADDRESS', 'SLOT_MASTER_PRIVATE_KEY'];
  const missing = required.filter(key => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Slot write configuration: ${missing.join(', ')}`);
  }
}

function withSlotNoFeeExecuteOptions(options: UniversalDetails = {}): UniversalDetails {
  return {
    ...options,
    tip: 0n,
  };
}

function compactValue(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export async function executeSlotQueueTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  try {
    ensureSlotWriteConfig();

    const slotInstance = getSlotInstance();
    const slotRpcUrl = getSlotRpcUrl();
    await ensureStarknetRpcReachable(`Slot RPC (${slotInstance})`, slotRpcUrl);

    const call: Call = {
      contractAddress: transaction.contractAddress,
      entrypoint: transaction.entrypoint,
      calldata: transaction.calldata,
    };

    console.log(
      `[executor] send chain=slot slot=${slotInstance} op=${transaction.blockchain}.${transaction.entrypoint} account=${compactValue(env.SLOT_MASTER_ADDRESS)} contract=${compactValue(call.contractAddress)}`
    );

    const account = getSlotAccount();
    const transactionHash = await withStarknetWriteLock(`slot:${env.SLOT_MASTER_ADDRESS}`, async () => {
      const slotNonce = await account.getNonce();
      const { transaction_hash } = await account.execute(
        call,
        withSlotNoFeeExecuteOptions({
          nonce: slotNonce,
          skipValidate: true,
        })
      );
      return transaction_hash;
    });

    await account.waitForTransaction(transactionHash);

    console.log(`[executor] confirmed chain=slot hash=${compactValue(transactionHash)}`);

    return {
      success: true,
      transactionHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
