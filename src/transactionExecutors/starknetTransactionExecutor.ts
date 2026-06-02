import { Account, Call, RpcProvider } from 'starknet';
import { env } from '../env.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';
import { withStarknetWriteLock } from '../runtime/StarknetWriteCoordinator.js';

const rpcHealthCheckPromises = new Map<string, Promise<void>>();

function getStarknetProvider(): RpcProvider {
  return new RpcProvider({
    nodeUrl: env.STARKNET_RPC_URL,
    headers: env.STARKNET_RPC_API_KEY
      ? { Authorization: `Bearer ${env.STARKNET_RPC_API_KEY}` }
      : undefined,
  });
}

function truncateBody(body: string): string {
  return body.length > 240 ? `${body.slice(0, 240)}...` : body;
}

export async function ensureStarknetRpcReachable(label: string, nodeUrl: string, apiKey = ''): Promise<void> {
  const cacheKey = `${label}:${nodeUrl}`;

  if (!rpcHealthCheckPromises.has(cacheKey)) {
    const promise = (async () => {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'starknet_chainId',
          params: [],
        }),
      });

      const body = await response.text();
      let parsed: unknown;

      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(
          `${label} returned a non-JSON response (${response.status}). Check that it points to a Starknet JSON-RPC endpoint. Body: ${truncateBody(body)}`
        );
      }

      const rpcResponse = parsed as { result?: unknown; error?: { code?: number; message?: string } };
      if (rpcResponse.error) {
        throw new Error(
          `${label} rejected starknet_chainId (${rpcResponse.error.code ?? 'unknown'}): ${rpcResponse.error.message ?? 'Unknown RPC error'}`
        );
      }

      if (!rpcResponse.result) {
        throw new Error(`${label} returned an invalid starknet_chainId response: ${truncateBody(body)}`);
      }
    })();

    rpcHealthCheckPromises.set(cacheKey, promise.catch(error => {
      rpcHealthCheckPromises.delete(cacheKey);
      throw error;
    }));
  }

  return rpcHealthCheckPromises.get(cacheKey)!;
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

function compactValue(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export async function executeStarknetQueueTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  try {
    ensureStarknetWriteConfig();
    await ensureStarknetRpcReachable('STARKNET_RPC_URL', env.STARKNET_RPC_URL, env.STARKNET_RPC_API_KEY);

    const call: Call = {
      contractAddress: transaction.contractAddress,
      entrypoint: transaction.entrypoint,
      calldata: transaction.calldata,
    };

    console.log(
      `[executor] send chain=starknet op=${transaction.entrypoint} account=${compactValue(env.STARKNET_ADDRESS)} contract=${compactValue(call.contractAddress)}`
    );

    const account = getStarknetAccount();
    const transactionHash = await withStarknetWriteLock(env.STARKNET_ADDRESS, async () => {
      const starknetNonce = await account.getNonce();
      const { transaction_hash } = await account.execute(call, {
        nonce: starknetNonce,
        skipValidate: true,
      });
      return transaction_hash;
    });

    await account.waitForTransaction(transactionHash);

    console.log(`[executor] confirmed chain=starknet hash=${compactValue(transactionHash)}`);

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
