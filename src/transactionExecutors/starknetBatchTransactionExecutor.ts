import {
  Account,
  RpcProvider,
  type Call,
  type GetTransactionReceiptResponse,
  type ResourceBoundsOverhead,
} from 'starknet';
import { compileStarknetIntent } from '../blockchainAdapters/starknetAdapter.js';
import { env } from '../env.js';
import { withStarknetWriteLock } from '../runtime/StarknetWriteCoordinator.js';
import type { QueuedIntent } from '../transactionQueueTypes.js';
import { ensureStarknetRpcReachable } from './starknetTransactionExecutor.js';
import { resolveStarknetRecommendedTip } from './starknetTip.js';

export interface StarknetBatchExecutorAccount {
  id: number;
  name: string;
  address: string;
  privateKey: string;
}

export type StarknetTransactionInspection =
  | { status: 'succeeded'; actualFee?: unknown }
  | { status: 'reverted'; error: string; actualFee?: unknown }
  | { status: 'unknown'; error?: string };

export type StarknetBatchExecutionResult =
  | {
      status: 'succeeded';
      transactionHash: string;
      nonce: string;
      actualFee?: unknown;
    }
  | {
      status: 'reverted';
      transactionHash: string;
      nonce: string;
      error: Error;
      actualFee?: unknown;
    }
  | {
      status: 'submitted_unknown';
      transactionHash: string;
      nonce: string;
      error: Error;
    }
  | {
      status: 'not_submitted';
      error: Error;
      retryAsBatch: boolean;
    };

export const STARKNET_BATCH_RESOURCE_BOUNDS_OVERHEAD = {
  l1_gas: { max_amount: 50, max_price_per_unit: 50 },
  l1_data_gas: { max_amount: 50, max_price_per_unit: 50 },
  l2_gas: { max_amount: 40, max_price_per_unit: 50 },
} satisfies ResourceBoundsOverhead;

function getProvider(): RpcProvider {
  return new RpcProvider({
    nodeUrl: env.BACKGROUND_STARKNET_RPC_URL,
    resourceBoundsOverhead: STARKNET_BATCH_RESOURCE_BOUNDS_OVERHEAD,
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isRetryableTransportError(error: unknown): boolean {
  const message = asError(error).message.toLowerCase();
  const deterministicExecutionFragments = [
    'transaction execution error',
    'execution_error',
    'execution error',
    'runresources has no remaining steps',
  ];
  if (deterministicExecutionFragments.some(fragment => message.includes(fragment))) {
    return false;
  }

  const transportFragments = [
    'fetch failed',
    'network',
    'timeout',
    'timed out',
    'rate limit',
    'too many requests',
    'econn',
    'socket',
    'gateway',
  ];
  if (transportFragments.some(fragment => message.includes(fragment))) {
    return true;
  }

  return /\b(?:http|status|response)[^\n]{0,40}\b(?:429|502|503|504)\b/.test(message);
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)])
    );
  }

  return value;
}

function getActualFee(receipt: GetTransactionReceiptResponse): unknown {
  const value = receipt.value as unknown as Record<string, unknown>;
  return value.actual_fee === undefined ? undefined : jsonSafe(value.actual_fee);
}

function getRevertReason(receipt: GetTransactionReceiptResponse): string {
  const value = receipt.value as unknown as Record<string, unknown>;
  return String(value.revert_reason ?? 'Starknet transaction reverted');
}

export async function inspectStarknetTransaction(
  transactionHash: string
): Promise<StarknetTransactionInspection> {
  try {
    const receipt = await getProvider().getTransactionReceipt(transactionHash);
    const actualFee = getActualFee(receipt);

    if (receipt.isSuccess()) {
      return { status: 'succeeded', actualFee };
    }

    if (receipt.isReverted()) {
      return {
        status: 'reverted',
        error: getRevertReason(receipt),
        actualFee,
      };
    }

    return { status: 'unknown', error: 'Receipt is not final' };
  } catch (error) {
    return { status: 'unknown', error: asError(error).message };
  }
}

export async function executeStarknetIntentBatch(
  intents: QueuedIntent[],
  executor: StarknetBatchExecutorAccount,
  onSubmitted: (transactionHash: string, nonce: string) => Promise<void>
): Promise<StarknetBatchExecutionResult> {
  if (intents.length === 0) {
    return {
      status: 'not_submitted',
      error: new Error('Cannot execute an empty Starknet batch'),
      retryAsBatch: false,
    };
  }

  let transactionHash: string | undefined;
  let nonce: string | undefined;
  let calls: Call[];

  try {
    calls = intents.map(intent => {
      const transaction = compileStarknetIntent(intent);
      return {
        contractAddress: transaction.contractAddress,
        entrypoint: transaction.entrypoint,
        calldata: transaction.calldata,
      };
    });
  } catch (error) {
    return {
      status: 'not_submitted',
      error: asError(error),
      retryAsBatch: false,
    };
  }

  try {
    await ensureStarknetRpcReachable(
      'BACKGROUND_STARKNET_RPC_URL',
      env.BACKGROUND_STARKNET_RPC_URL
    );

    const provider = getProvider();
    const account = new Account({
      provider,
      address: executor.address,
      signer: executor.privateKey,
    });
    const tip = await resolveStarknetRecommendedTip(provider);

    const submission = await withStarknetWriteLock(executor.address, async () => {
      const accountNonce = await account.getNonce();
      const response = await account.execute(calls, {
        nonce: accountNonce,
        skipValidate: true,
        tip,
      });

      return {
        transactionHash: response.transaction_hash,
        nonce: String(accountNonce),
      };
    });

    transactionHash = submission.transactionHash;
    nonce = submission.nonce;
    await onSubmitted(transactionHash, nonce);

    try {
      const receipt = await account.waitForTransaction(transactionHash);
      const actualFee = getActualFee(receipt);

      if (receipt.isSuccess()) {
        return { status: 'succeeded', transactionHash, nonce, actualFee };
      }

      if (receipt.isReverted()) {
        return {
          status: 'reverted',
          transactionHash,
          nonce,
          error: new Error(getRevertReason(receipt)),
          actualFee,
        };
      }
    } catch (waitError) {
      const inspection = await inspectStarknetTransaction(transactionHash);
      if (inspection.status === 'succeeded') {
        return {
          status: 'succeeded',
          transactionHash,
          nonce,
          actualFee: inspection.actualFee,
        };
      }
      if (inspection.status === 'reverted') {
        return {
          status: 'reverted',
          transactionHash,
          nonce,
          error: new Error(inspection.error),
          actualFee: inspection.actualFee,
        };
      }

      return {
        status: 'submitted_unknown',
        transactionHash,
        nonce,
        error: asError(waitError),
      };
    }

    return {
      status: 'submitted_unknown',
      transactionHash,
      nonce,
      error: new Error('Starknet receipt did not reach a final state'),
    };
  } catch (error) {
    if (transactionHash && nonce) {
      return {
        status: 'submitted_unknown',
        transactionHash,
        nonce,
        error: asError(error),
      };
    }

    return {
      status: 'not_submitted',
      error: asError(error),
      retryAsBatch: isRetryableTransportError(error),
    };
  }
}
