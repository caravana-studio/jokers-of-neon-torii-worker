import { w3cwebsocket } from 'websocket';
import { init } from '@dojoengine/sdk/node';
import { HistoricalToriiQueryBuilder } from '@dojoengine/sdk/node';
import { num, shortString } from 'starknet';
import { env, getWorkerBlockchainFilter } from './env.js';
import { getTransactionQueue } from './transactionQueue.js';
import {
  EmptyGameDataError,
  fetchFullGameData,
  resolveGameBlockchainFromData,
  saveGameStep,
  type FullGameData,
} from './services/gameStepsService.js';
import { markDailyStreakPending } from './services/streakCacheService.js';
import { getSlotToriiUrl, getSlotRelayUrl } from './config/slotConfig.js';
import { getWorldAddress } from './config/manifest.js';
import {
  getAllBlockchainEventHandlers,
  getBlockchainEventHandler,
  type BlockchainEventHandler,
  type MissionCompletedEventData,
} from './blockchainEventHandlers.js';
import type { BlockchainId, EnqueueTransactionParams } from './transactionQueueTypes.js';

// Configuración necesaria para WebSocket en Node.js
// @ts-ignore
global.WebSocket = w3cwebsocket;
// @ts-ignore
global.WorkerGlobalScope = global;

// Initialize transaction queue
const txQueue = getTransactionQueue();

const workerBlockchainFilter = getWorkerBlockchainFilter();
const AGENT_PLAYER_NAME_PREFIX = 'chichilo';
const SUPPRESS_WORKER_LOGS_METADATA_KEY = 'suppressWorkerLogs';

interface GameLogContext {
  blockchain: BlockchainId;
  suppressLogs: boolean;
}

const gameLogContexts = new Map<number, GameLogContext>();

function getGamePlayerName(data: FullGameData): string {
  const game = data.game;
  if (game && typeof game === 'object' && 'player_name' in game) {
    return String((game as { player_name?: unknown }).player_name ?? '');
  }

  if ('player_name' in data) {
    return String(data.player_name ?? '');
  }

  return '';
}

function shouldSuppressGameLogs(data: FullGameData): boolean {
  return getGamePlayerName(data).trim().toLowerCase().startsWith(AGENT_PLAYER_NAME_PREFIX);
}

function rememberGameLogContext(gameId: number, data: FullGameData): GameLogContext {
  const context = {
    blockchain: resolveGameBlockchainFromData(gameId, data),
    suppressLogs: shouldSuppressGameLogs(data),
  };
  gameLogContexts.set(gameId, context);
  return context;
}

async function resolveGameLogContext(gameId: number): Promise<GameLogContext> {
  const cached = gameLogContexts.get(gameId);
  if (cached) {
    return cached;
  }

  const data = await fetchFullGameData(gameId, { logRequest: false });
  return rememberGameLogContext(gameId, data);
}

function shouldLogGame(gameId: number): boolean {
  return gameLogContexts.get(gameId)?.suppressLogs !== true;
}

function compactValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.join(',')}]`;
  }
  if (typeof value === 'string' && value.startsWith('0x') && value.length > 18) {
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
  }
  return String(value);
}

function logWorkerLine(scope: string, fields: Record<string, unknown>): void {
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${compactValue(value)}`)
    .join(' ');
  console.log(details ? `[${scope}] ${details}` : `[${scope}]`);
}

function withWorkerLogsSuppressed(transaction: EnqueueTransactionParams): EnqueueTransactionParams {
  return {
    ...transaction,
    metadata: {
      ...(transaction.metadata ?? {}),
      [SUPPRESS_WORKER_LOGS_METADATA_KEY]: true,
    },
  };
}

async function enqueueTransactions(
  transactions: EnqueueTransactionParams[],
  options: { log?: boolean } = {}
): Promise<void> {
  const shouldLog = options.log !== false;

  if (!env.TRANSACTION_QUEUE_ENABLED) {
    if (transactions.length > 0 && shouldLog) {
      logWorkerLine('queue', { action: 'skip_enqueue', reason: 'disabled', count: transactions.length });
    }
    return;
  }

  for (const transaction of transactions) {
    const transactionToEnqueue = shouldLog ? transaction : withWorkerLogsSuppressed(transaction);
    await txQueue.enqueue(transactionToEnqueue, { log: shouldLog });
  }
}

function shouldProcessBlockchain(blockchain: BlockchainId): boolean {
  return !workerBlockchainFilter || workerBlockchainFilter.includes(blockchain);
}

function getEnabledBlockchainEventHandlers(): BlockchainEventHandler[] {
  if (!workerBlockchainFilter) {
    return getAllBlockchainEventHandlers();
  }

  return getAllBlockchainEventHandlers().filter(handler =>
    workerBlockchainFilter.includes(handler.blockchain)
  );
}

function logTransactionBuildResult(
  label: string,
  transactions: EnqueueTransactionParams[],
  options: { log?: boolean } = {}
): void {
  if (options.log === false) {
    return;
  }

  if (transactions.length === 0) {
    logWorkerLine('tx-build', { action: 'empty', label });
    return;
  }

  logWorkerLine('tx-build', { action: 'queued', label, count: transactions.length });
}

async function buildTransactionsForAllChains(
  build: (handler: BlockchainEventHandler) => Promise<EnqueueTransactionParams[]>
): Promise<EnqueueTransactionParams[]> {
  const transactionGroups = await Promise.all(
    getEnabledBlockchainEventHandlers().map(handler => build(handler))
  );

  return transactionGroups.flat();
}

async function buildTransactionsForGameBlockchain(
  blockchain: BlockchainId,
  build: (blockchain: BlockchainId) => Promise<EnqueueTransactionParams[]>,
  options: { log?: boolean } = {}
): Promise<EnqueueTransactionParams[]> {
  return build(blockchain);
}

const MISSION_PERIOD_DAILY = 1;
const MISSION_PERIOD_WEEKLY = 2;
const CURRENT_HAND_DEDUPE_WINDOW_MS = 5000;
const recentCurrentHandEvents = new Map<string, number>();

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function decodeFeltString(value: unknown): string {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
    return '';
  }

  if (typeof value === 'string' && !value.startsWith('0x') && !/^\d+$/.test(value)) {
    return value;
  }

  try {
    return shortString.decodeShortString(num.toHexString(value as any));
  } catch {
    return String(value);
  }
}

function normalizeMissionCompletedEvent(rawEvent: unknown): MissionCompletedEventData | null {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const event = rawEvent as Record<string, unknown>;
  const playerRaw = readField(event, 'player');
  const player = typeof playerRaw === 'string' ? playerRaw : String(playerRaw ?? '');

  if (!player) {
    return null;
  }

  const hasUnifiedShape =
    readField(event, 'period_type', 'periodType') !== undefined &&
    readField(event, 'mission_id', 'missionId') !== undefined &&
    readField(event, 'template_id', 'templateId') !== undefined &&
    readField(event, 'difficulty') !== undefined;

  if (hasUnifiedShape) {
    const periodTypeId = toNumber(readField(event, 'period_type', 'periodType')) ?? MISSION_PERIOD_DAILY;
    const difficulty = toNumber(readField(event, 'difficulty')) ?? 0;
    const xp = toNumber(readField(event, 'xp')) ?? 0;

    return {
      player,
      periodType: periodTypeId === MISSION_PERIOD_WEEKLY ? 'weekly' : 'daily',
      periodTypeId,
      periodId: toNumber(readField(event, 'period_id', 'periodId')) ?? 0,
      missionId: decodeFeltString(readField(event, 'mission_id', 'missionId')),
      templateId: decodeFeltString(readField(event, 'template_id', 'templateId')),
      difficulty,
      target: toNumber(readField(event, 'target')) ?? 0,
      progress: toNumber(readField(event, 'progress')) ?? 0,
      xp,
      gameId: toNumber(readField(event, 'game_id', 'gameId')) ?? 0,
    };
  }

  const legacyMissionId = readField(event, 'id');
  const legacyMissionType = readField(event, 'mission_type', 'missionType');

  if (legacyMissionId === undefined || legacyMissionType === undefined) {
    return null;
  }

  const difficulty = toNumber(legacyMissionType) ?? 0;
  const missionId = decodeFeltString(legacyMissionId);

  return {
    player,
    periodType: 'daily',
    periodTypeId: MISSION_PERIOD_DAILY,
    periodId: 0,
    missionId,
    templateId: missionId,
    difficulty,
    target: 0,
    progress: 0,
    xp: 0,
    gameId: 0,
  };
}

function shouldProcessCurrentHandEvent(gameId: number, cards: number[]): boolean {
  const now = Date.now();
  const key = `${gameId}:${cards.join(',')}`;

  for (const [eventKey, timestamp] of recentCurrentHandEvents) {
    if (now - timestamp > CURRENT_HAND_DEDUPE_WINDOW_MS) {
      recentCurrentHandEvents.delete(eventKey);
    }
  }

  const previousTimestamp = recentCurrentHandEvents.get(key);
  if (previousTimestamp && now - previousTimestamp <= CURRENT_HAND_DEDUPE_WINDOW_MS) {
    return false;
  }

  recentCurrentHandEvents.set(key, now);
  return true;
}

/**
 * Handles mission completed event
 */
async function handleMissionCompleted(event: MissionCompletedEventData, options: { log?: boolean } = {}) {
  const shouldLog = options.log !== false;

  if (shouldLog) {
    logWorkerLine('event', {
      type: 'mission_completed',
      player: event.player,
      period: event.periodType,
      periodId: event.periodId,
      mission: event.templateId || event.missionId,
      progress: `${event.progress}/${event.target}`,
      xp: event.xp,
      game: event.gameId,
    });
  }

  try {
    await markDailyStreakPending(event);

    if (event.periodType === 'daily' && event.gameId > 0) {
      const sourceBlockchain = (await resolveGameLogContext(event.gameId)).blockchain;
      if (shouldLog) {
        logWorkerLine('event', {
          type: 'mission_routing',
          game: event.gameId,
          source: sourceBlockchain,
          target: 'starknet',
        });
      }
    }

    const transactions = await buildTransactionsForGameBlockchain(
      'starknet',
      selectedBlockchain => getBlockchainEventHandler(selectedBlockchain).buildMissionCompletedTransactions(event),
      { log: shouldLog }
    );
    await enqueueTransactions(transactions, { log: shouldLog });
    logTransactionBuildResult('Mission completed', transactions, { log: shouldLog });
  } catch (error) {
    console.error('❌ Error queueing mission XP transaction:', error);
  }
}

/**
 * Handles current hand event
 * Fetches game data from API and saves it as a game step
 */
async function handleCurrentHand(gameId: number, cards: number[]) {
  try {
    // Check if Supabase is configured
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      if (shouldLogGame(gameId)) {
        logWorkerLine('event', {
          type: 'current_hand',
          game: gameId,
          cards,
          result: 'skip_step',
          reason: 'supabase_unconfigured',
        });
      }
      return;
    }

    const gameData = await fetchFullGameData(gameId, { logRequest: false });
    const { blockchain, suppressLogs } = rememberGameLogContext(gameId, gameData);
    if (!shouldProcessBlockchain(blockchain)) {
      return;
    }

    const shouldLog = !suppressLogs;

    if (shouldLog) {
      logWorkerLine('event', { type: 'current_hand', game: gameId, cards, chain: blockchain });
    }

    const result = await saveGameStep(gameId, gameData, { log: shouldLog });

    if (result && shouldLog) {
      logWorkerLine('game-step', { action: 'saved', game: gameId, step: result.step });
    } else if (shouldLog) {
      logWorkerLine('game-step', { action: 'skip', game: gameId, reason: 'supabase_unconfigured' });
    }
  } catch (error) {
    if (error instanceof EmptyGameDataError) {
      if (shouldLogGame(gameId)) {
        console.warn(`⚠️  Skipping game step: ${error.message}`);
      }
    } else {
      console.error('❌ Error saving game step:', error);
    }

    if (shouldLogGame(gameId)) {
      logWorkerLine('torii', { action: 'continue_after_game_step_error', game: gameId });
    }
  }
}

/**
 * Handles game won event
 */
async function handlePlayWinGame(
  player: string,
  gameId: number,
  blockchain: BlockchainId,
  options: { log?: boolean } = {}
) {
  const shouldLog = options.log !== false;

  if (shouldLog) {
    logWorkerLine('event', { type: 'play_win', player, game: gameId, chain: blockchain });
  }

  try {
    const transactions = await buildTransactionsForGameBlockchain(
      blockchain,
      async selectedBlockchain => getBlockchainEventHandler(selectedBlockchain).buildPlayWinGameTransactions({ player, gameId }),
      { log: shouldLog }
    );
    await enqueueTransactions(transactions, { log: shouldLog });
    logTransactionBuildResult('Play win game', transactions, { log: shouldLog });
  } catch (error) {
    console.error('❌ Error recording won game:', error);
  }
}

/**
 * Handles game over event
 */
async function handleGameOver(
  player: string,
  gameId: number,
  blockchain: BlockchainId,
  options: { log?: boolean } = {}
) {
  const shouldLog = options.log !== false;

  if (shouldLog) {
    logWorkerLine('event', { type: 'play_game_over', player, game: gameId, chain: blockchain });
  }

  try {
    const transactions = await buildTransactionsForGameBlockchain(
      blockchain,
      async selectedBlockchain => getBlockchainEventHandler(selectedBlockchain).buildPlayGameOverTransactions({ player, gameId }),
      { log: shouldLog }
    );
    await enqueueTransactions(transactions, { log: shouldLog });
    logTransactionBuildResult('Play game over', transactions, { log: shouldLog });
  } catch (error) {
    console.error('❌ Error recording game over:', error);
  }
}

/**
 * Handles create game event
 */
async function handleCreateGame(
  player: string,
  gameId: number,
  blockchain: BlockchainId,
  options: { log?: boolean } = {}
) {
  const shouldLog = options.log !== false;

  if (shouldLog) {
    logWorkerLine('event', { type: 'create_game', player, game: gameId, chain: blockchain });
  }

  try {
    const transactions = await buildTransactionsForGameBlockchain(
      blockchain,
      async selectedBlockchain => getBlockchainEventHandler(selectedBlockchain).buildCreateGameTransactions({ player, gameId }),
      { log: shouldLog }
    );
    await enqueueTransactions(transactions, { log: shouldLog });
    logTransactionBuildResult('Create game', transactions, { log: shouldLog });
  } catch (error) {
    console.error('❌ Error recording game creation:', error);
  }
}

/**
 * Handles progression game update event
 * Syncs player progression only to the blockchain that owns the game.
 */
async function handleProgressionUpdated(
  player: string,
  gameId: number,
  tier: number,
  totalRuns: number,
  maxLevel: number,
  maxRound: number,
  blockchain: BlockchainId,
  options: { log?: boolean } = {}
) {
  const shouldLog = options.log !== false;

  if (shouldLog) {
    logWorkerLine('event', {
      type: 'progression_update',
      player,
      game: gameId,
      chain: blockchain,
      tier,
      runs: totalRuns,
      maxLevel,
      maxRound,
    });
  }

  try {
    const transactions = await buildTransactionsForGameBlockchain(
      blockchain,
      selectedBlockchain => getBlockchainEventHandler(selectedBlockchain).buildProgressionUpdatedTransactions({
        player,
        gameId,
        tier,
        totalRuns,
        maxLevel,
        maxRound,
      }),
      { log: shouldLog }
    );
    await enqueueTransactions(transactions, { log: shouldLog });
    logTransactionBuildResult('Progression updated', transactions, { log: shouldLog });
  } catch (error) {
    console.error('❌ Error processing progression event:', error);
  }
}

/**
 * Handles level passed event
 */
async function handleLevelPassed(
  player: string,
  gameId: number,
  previousLevel: number,
  newLevel: number,
  blockchain: BlockchainId,
  options: { log?: boolean } = {}
) {
  const shouldLog = options.log !== false;

  if (shouldLog) {
    logWorkerLine('event', {
      type: 'level_passed',
      player,
      game: gameId,
      chain: blockchain,
      from: previousLevel,
      to: newLevel,
    });
  }

  try {
    const transactions = await buildTransactionsForGameBlockchain(
      blockchain,
      async selectedBlockchain => getBlockchainEventHandler(selectedBlockchain).buildLevelPassedTransactions({
        player,
        gameId,
        previousLevel,
        newLevel,
      }),
      { log: shouldLog }
    );
    await enqueueTransactions(transactions, { log: shouldLog });
    logTransactionBuildResult('Level passed', transactions, { log: shouldLog });
  } catch (error) {
    console.error('❌ Error adding level completion XP:', error);
  }
}

export async function startToriiWorker() {
  const toriiUrl = getSlotToriiUrl();
  const relayUrl = getSlotRelayUrl();
  const worldAddress = getWorldAddress();

  logWorkerLine('torii', { action: 'config', toriiUrl, relayUrl, world: worldAddress });
  logWorkerLine('torii', { action: 'sdk_init' });

  // Initialize SDK with example configuration
  const sdk = await init({
    client: {
      toriiUrl,
      relayUrl, // Must be in multiaddr format
      worldAddress,
    },
    domain: {
      name: 'jokers-of-neon-worker',
      version: '1.0',
      chainId: 'SN_SEPOLIA',
      revision: '1',
    },
  });

  logWorkerLine('torii', { action: 'sdk_ready' });

  // Callback when an event is detected
  const onEventUpdated = async (response: any) => {
    try {
      // Response has a 'data' property with an array of entities
      if (!response || !response.data || response.data.length === 0) return;


      // Process each entity in response.data
      for (const item of response.data) {
        try {
          const { models } = item;

          // Search for events in models
          if (models && models.jokers_of_neon_core) {
            const coreModels = models.jokers_of_neon_core;

            // Check if MissionCompletedV2Event exists
            if (coreModels.MissionCompletedV2Event || coreModels.MissionCompletedEvent) {
              const missionEvent = normalizeMissionCompletedEvent(
                coreModels.MissionCompletedV2Event ?? coreModels.MissionCompletedEvent
              );

              if (missionEvent) {
                if (shouldProcessBlockchain('starknet')) {
                  let shouldLog = true;
                  if (missionEvent.gameId > 0) {
                    try {
                      shouldLog = !(await resolveGameLogContext(missionEvent.gameId)).suppressLogs;
                    } catch {
                      shouldLog = true;
                    }
                  }

                  await handleMissionCompleted(missionEvent, { log: shouldLog });
                }
              } else {
                logWorkerLine('event', { type: 'mission_completed', result: 'skip', reason: 'incomplete' });
              }
            }

            // Check if CreateGameEvent exists
            if (coreModels.CreateGameEvent) {
              const event = coreModels.CreateGameEvent;

              // Process the event
              if (event.player && event.game_id !== undefined) {
                const gameId = Number(event.game_id);
                const { blockchain, suppressLogs } = await resolveGameLogContext(gameId);
                const shouldLog = !suppressLogs;

                if (shouldProcessBlockchain(blockchain)) {
                  await handleCreateGame(event.player, gameId, blockchain, { log: shouldLog });
                }
              } else {
                logWorkerLine('event', { type: 'create_game', result: 'skip', reason: 'incomplete' });
              }
            }

            // Check if CurrentHandEvent exists
            if (coreModels.CurrentHandEvent) {
              const event = coreModels.CurrentHandEvent;

              // Process the event
              if (event.game_id !== undefined && event.cards !== undefined) {
                const gameId = Number(event.game_id);
                const cards = Array.isArray(event.cards) ? event.cards.map(Number) : [];

                if (!shouldProcessCurrentHandEvent(gameId, cards)) {
                  continue;
                }

                await handleCurrentHand(gameId, cards);
              } else {
                logWorkerLine('event', { type: 'current_hand', result: 'skip', reason: 'incomplete' });
              }
            }

            // Check if PlayWinGameEvent exists
            if (coreModels.PlayWinGameEvent) {
              const event = coreModels.PlayWinGameEvent;

              // Process the event
              if (event.player && event.game_id !== undefined) {
                const gameId = Number(event.game_id);
                const { blockchain, suppressLogs } = await resolveGameLogContext(gameId);
                const shouldLog = !suppressLogs;

                if (shouldProcessBlockchain(blockchain)) {
                  await handlePlayWinGame(event.player, gameId, blockchain, { log: shouldLog });
                }
              } else {
                logWorkerLine('event', { type: 'play_win', result: 'skip', reason: 'incomplete' });
              }
            }

            // Check if PlayGameOverEvent exists
            if (coreModels.PlayGameOverEvent) {
              const event = coreModels.PlayGameOverEvent;

              // Process the event
              if (event.player && event.game_id !== undefined) {
                const gameId = Number(event.game_id);
                const { blockchain, suppressLogs } = await resolveGameLogContext(gameId);
                const shouldLog = !suppressLogs;

                if (shouldProcessBlockchain(blockchain)) {
                  await handleGameOver(event.player, gameId, blockchain, { log: shouldLog });
                }
              } else {
                logWorkerLine('event', { type: 'play_game_over', result: 'skip', reason: 'incomplete' });
              }
            }

            // Check if LevelPassedEvent exists
            if (coreModels.LevelPassedEvent) {
              const event = coreModels.LevelPassedEvent;

              // Process the event
              if (event.player && event.game_id !== undefined && event.previous_level !== undefined && event.new_level !== undefined) {
                const gameId = Number(event.game_id);
                const { blockchain, suppressLogs } = await resolveGameLogContext(gameId);
                const shouldLog = !suppressLogs;

                if (shouldProcessBlockchain(blockchain)) {
                  await handleLevelPassed(
                    event.player,
                    gameId,
                    Number(event.previous_level),
                    Number(event.new_level),
                    blockchain,
                    { log: shouldLog }
                  );
                }
              } else {
                logWorkerLine('event', { type: 'level_passed', result: 'skip', reason: 'incomplete' });
              }
            }

            // Check if ProgressionGameUpdateEvent exists
            if (coreModels.ProgressionGameUpdateEvent) {
              const event = coreModels.ProgressionGameUpdateEvent;

              if (
                event.player &&
                event.game_id !== undefined &&
                event.tier !== undefined &&
                event.total_runs !== undefined &&
                event.max_level !== undefined &&
                event.max_round !== undefined
              ) {
                const gameId = Number(event.game_id);
                const { blockchain, suppressLogs } = await resolveGameLogContext(gameId);
                const shouldLog = !suppressLogs;

                if (shouldProcessBlockchain(blockchain)) {
                  await handleProgressionUpdated(
                    event.player,
                    gameId,
                    Number(event.tier),
                    Number(event.total_runs),
                    Number(event.max_level),
                    Number(event.max_round),
                    blockchain,
                    { log: shouldLog }
                  );
                }
              } else {
                logWorkerLine('event', { type: 'progression_update', result: 'skip', reason: 'incomplete' });
              }
            }

            // If it's not one of the events we're interested in, silently ignore it
          }
        } catch (error) {
          console.error('❌ Error processing item:', error);
          console.error(error);
        }
      }
    } catch (error) {
      console.error('❌ Error in callback:', error);
    }
  };

  // Create query for events
  const query = new HistoricalToriiQueryBuilder()
    .withEntityModels([
      'jokers_of_neon_core-MissionCompletedEvent',
      'jokers_of_neon_core-MissionCompletedV2Event',
      'jokers_of_neon_core-CreateGameEvent',
      'jokers_of_neon_core-CurrentHandEvent',
      'jokers_of_neon_core-PlayWinGameEvent',
      'jokers_of_neon_core-PlayGameOverEvent',
      'jokers_of_neon_core-LevelPassedEvent',
      'jokers_of_neon_core-ProgressionGameUpdateEvent'
    ])
    .withDirection('Backward')
    .withLimit(10);

  try {
    // Get initial historical events
    const historicalEvents = await sdk.getEventMessages({ query });
    const items = historicalEvents.getItems();
    logWorkerLine('torii', { action: 'historical_events', count: items.length });
  } catch (error) {
    console.warn('⚠️  Error retrieving historical events:', error);
  }

  // Subscribe to real-time events
  logWorkerLine('torii', { action: 'subscribe' });

  const [, subscription] = await sdk.subscribeEventQuery({
    query,
    callback: onEventUpdated,
  });

  logWorkerLine('torii', {
    action: 'listener_ready',
    events: 'MissionCompletedV2,CreateGame,CurrentHand,PlayWin,PlayGameOver,LevelPassed,ProgressionUpdate',
  });

  return () => {
    logWorkerLine('torii', { action: 'subscription_cancel' });
    subscription.cancel();
  };
}
