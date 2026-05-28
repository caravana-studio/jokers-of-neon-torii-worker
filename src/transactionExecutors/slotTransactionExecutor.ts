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

    console.log(`\n📤 Executing Slot transaction...`);
    console.log(`   Slot:       ${slotInstance}`);
    console.log(`   RPC:        ${slotRpcUrl}`);
    console.log(`   Account:    ${env.SLOT_MASTER_ADDRESS}`);
    console.log(`   Operation:  ${transaction.blockchain}.${transaction.entrypoint}`);
    console.log(`   Contract:   ${call.contractAddress}`);
    console.log(`   Entrypoint: ${call.entrypoint}`);
    console.log(`   Calldata:   ${JSON.stringify(call.calldata)}`);

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

    console.log(`✅ Slot transaction sent: ${transactionHash}`);
    console.log('⏳ Waiting for confirmation...');

    await account.waitForTransaction(transactionHash);

    console.log(`✅ Slot transaction confirmed: ${transactionHash}\n`);

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
