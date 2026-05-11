export type BlockchainId = string;

export type TransactionOperation =
  | 'game.snapshot'
  | 'round.snapshot'
  | 'progression.sync'
  | 'xp.daily_mission'
  | 'xp.level_completion'
  | 'stats.game_created'
  | 'stats.game_won'
  | 'stats.player'
  | 'pack.claimable.add';

export const TRANSACTION_OPERATIONS: readonly TransactionOperation[] = [
  'game.snapshot',
  'round.snapshot',
  'progression.sync',
  'xp.daily_mission',
  'xp.level_completion',
  'stats.game_created',
  'stats.game_won',
  'stats.player',
  'pack.claimable.add',
];

export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface EnqueueTransactionParams {
  blockchain: BlockchainId;
  operation: TransactionOperation;
  targetRef?: string;
  payload: Record<string, unknown>;
  intentVersion?: number;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
}

export interface QueuedIntent {
  id: string;
  blockchain: BlockchainId;
  operation: TransactionOperation;
  targetRef?: string;
  payload: Record<string, unknown>;
  intentVersion: number;
  metadata: Record<string, unknown>;
  retries: number;
  maxRetries: number;
  status: TransactionStatus;
}

export interface QueuedTransaction {
  id: string;
  blockchain: BlockchainId;
  contractAddress: string;
  entrypoint: string;
  calldata: any[];
  retries: number;
  maxRetries: number;
  status: TransactionStatus;
}

export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: Error;
}

export function isTransactionOperation(value: unknown): value is TransactionOperation {
  return typeof value === 'string' && TRANSACTION_OPERATIONS.includes(value as TransactionOperation);
}
