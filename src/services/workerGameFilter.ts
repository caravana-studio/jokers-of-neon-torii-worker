import type { BlockchainId } from '../transactionQueueTypes.js';
import {
  fetchFullGameData,
  resolveGameBlockchainFromData,
  type FullGameData,
} from './gameStepsService.js';

const SUPPRESSED_PLAYER_NAME_PREFIXES = ['chichilo'];

export interface WorkerGameContext {
  blockchain: BlockchainId;
  playerName: string;
  suppressLogs: boolean;
  suppressTransactions: boolean;
}

const gameContexts = new Map<number, WorkerGameContext>();
const pendingGameContexts = new Map<number, Promise<WorkerGameContext>>();

export function getGamePlayerName(data: FullGameData): string {
  const game = data.game;
  if (game && typeof game === 'object' && 'player_name' in game) {
    return String((game as { player_name?: unknown }).player_name ?? '');
  }

  if ('player_name' in data) {
    return String(data.player_name ?? '');
  }

  return '';
}

export function shouldSuppressWorkerGame(data: FullGameData): boolean {
  const playerName = getGamePlayerName(data).trim().toLowerCase();
  return SUPPRESSED_PLAYER_NAME_PREFIXES.some(prefix => playerName.startsWith(prefix));
}

export function rememberWorkerGameContext(gameId: number, data: FullGameData): WorkerGameContext {
  const suppress = shouldSuppressWorkerGame(data);
  const context = {
    blockchain: resolveGameBlockchainFromData(gameId, data),
    playerName: getGamePlayerName(data),
    suppressLogs: suppress,
    suppressTransactions: suppress,
  };

  gameContexts.set(gameId, context);
  pendingGameContexts.delete(gameId);
  return context;
}

export async function resolveWorkerGameContext(gameId: number): Promise<WorkerGameContext> {
  const cached = gameContexts.get(gameId);
  if (cached) {
    return cached;
  }

  const pending = pendingGameContexts.get(gameId);
  if (pending) {
    return pending;
  }

  const promise = fetchFullGameData(gameId, { logRequest: false })
    .then(data => rememberWorkerGameContext(gameId, data))
    .finally(() => pendingGameContexts.delete(gameId));

  pendingGameContexts.set(gameId, promise);
  return promise;
}

export function shouldLogWorkerGame(gameId: number): boolean {
  return gameContexts.get(gameId)?.suppressLogs !== true;
}
