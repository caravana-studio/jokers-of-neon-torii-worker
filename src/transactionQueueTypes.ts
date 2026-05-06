export type SupportedBlockchain = 'starknet' | 'celo';

export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface EnqueueTransactionParams {
  blockchain: SupportedBlockchain;
  contractAddress: string;
  entrypoint: string;
  calldata: unknown[];
  maxRetries?: number;
}

export interface QueuedTransaction {
  id: string;
  blockchain: SupportedBlockchain;
  contractAddress: string;
  entrypoint: string;
  calldata: unknown[];
  retries: number;
  maxRetries: number;
  status: TransactionStatus;
}

export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: Error;
}

export function isSupportedBlockchain(value: unknown): value is SupportedBlockchain {
  return value === 'starknet' || value === 'celo';
}
