import { Account, Call, RpcProvider } from 'starknet';
import { env } from '../env.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';

function getStarknetProvider(): RpcProvider {
  return new RpcProvider({
    nodeUrl: env.STARKNET_RPC_URL,
    headers: env.STARKNET_RPC_API_KEY
      ? { Authorization: `Bearer ${env.STARKNET_RPC_API_KEY}` }
      : undefined,
  });
}

function getStarknetAccount(): Account {
  return new Account({
    provider: getStarknetProvider(),
    address: env.STARKNET_ADDRESS,
    signer: env.STARKNET_PRIVATE_KEY,
  });
}

function ensureStarknetWriteConfig(): void {
  const required: Array<keyof typeof env> = ['STARKNET_RPC_URL', 'STARKNET_ADDRESS', 'STARKNET_PRIVATE_KEY'];
  const missing = required.filter(key => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Starknet write configuration: ${missing.join(', ')}`);
  }
}

export async function executeStarknetQueueTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  try {
    ensureStarknetWriteConfig();

    const call: Call = {
      contractAddress: transaction.contractAddress,
      entrypoint: transaction.entrypoint,
      calldata: transaction.calldata,
    };

    console.log(`\n📤 Executing Starknet transaction...`);
    console.log(`   Contract:   ${call.contractAddress}`);
    console.log(`   Entrypoint: ${call.entrypoint}`);
    console.log(`   Calldata:   ${JSON.stringify(call.calldata)}`);

    const account = getStarknetAccount();
    const starknetNonce = await account.getNonce();
    const { transaction_hash } = await account.execute(call, {
      nonce: starknetNonce,
      skipValidate: true,
    });

    console.log(`✅ Transaction sent: ${transaction_hash}`);
    console.log('⏳ Waiting for confirmation...');

    await account.waitForTransaction(transaction_hash);

    console.log(`✅ Transaction confirmed: ${transaction_hash}\n`);

    return {
      success: true,
      transactionHash: transaction_hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
