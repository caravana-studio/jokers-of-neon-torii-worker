import { ToriiGrpcClient } from '@dojoengine/grpc';
import { num, shortString } from 'starknet';
import { env, getWorkerBlockchainFilter } from './env.js';
import { getTransactionQueue } from './transactionQueue.js';
import {
  EmptyGameDataError,
  fetchFullGameData,
  saveGameStep,
} from './services/gameStepsService.js';
import {
  rememberWorkerGameContext,
  resolveWorkerGameContext,
  shouldLogWorkerGame,
} from './services/workerGameFilter.js';
import { markDailyStreakPending } from './services/streakCacheService.js';
import {
  assertToriiEventCheckpointStorage,
  loadToriiEventCheckpoint,
  saveToriiEventCheckpoint,
  type ToriiEventCheckpoint,
} from './services/toriiEventCheckpointService.js';
import { ToriiCatchUpScheduler } from './services/toriiCatchUpScheduler.js';
import {
  shouldLogEmptyCheckpointInitialization,
  shouldPersistToriiEventCheckpoint,
  type ToriiEventCheckpointSource,
} from './services/toriiEventCheckpointPolicy.js';
import { getSlotToriiUrl, getSlotChainId } from './config/slotConfig.js';
import { getWorldAddress } from './config/manifest.js';
import {
  getAllBlockchainEventHandlers,
  getBlockchainEventHandler,
  type BlockchainEventHandler,
  type MissionCompletedEventData,
} from './blockchainEventHandlers.js';
import type { BlockchainId, EnqueueTransactionParams } from './transactionQueueTypes.js';

// Initialize transaction queue
const txQueue = getTransactionQueue();

const workerBlockchainFilter = getWorkerBlockchainFilter();
const SUPPRESS_WORKER_LOGS_METADATA_KEY = 'suppressWorkerLogs';
const TORII_EVENT_MODELS = [
  'jokers_of_neon_core-MissionCompletedEvent',
  'jokers_of_neon_core-MissionCompletedV2Event',
  'jokers_of_neon_core-CreateGameEvent',
  'jokers_of_neon_core-CurrentHandEvent',
  'jokers_of_neon_core-PlayWinGameEvent',
  'jokers_of_neon_core-PlayGameOverEvent',
  'jokers_of_neon_core-LevelPassedEvent',
  'jokers_of_neon_core-ProgressionGameUpdateEvent',
] as const;
const TORII_GRAPHQL_CATCHUP_LIMIT = 100;
const TORII_GRAPHQL_TIMEOUT_MS = 15_000;
const TORII_RECONNECT_DELAY_MS = 2_000;
const TORII_PERIODIC_CATCHUP_INTERVAL_MS = 2_000;
const TORII_CATCHUP_RETRY_MAX_DELAY_MS = 60_000;
const MAX_SEEN_TORII_EVENTS = 5_000;
const TORII_LISTENER_NAME = 'core-events';
const CORE_NAMESPACE = 'jokers_of_neon_core';
const CORE_TYPENAME_PREFIX = `${CORE_NAMESPACE}_`;
const TORII_EVENT_MODEL_SET = new Set<string>(TORII_EVENT_MODELS);

type GrpcEventMessage = {
  hashed_keys?: string;
  created_at?: number;
  updated_at?: number;
  executed_at?: number;
  world_address?: string;
  models?: Record<string, unknown>;
};

type GraphqlEventModel = Record<string, unknown> & { __typename?: string };

type GraphqlEventEdge = {
  cursor: string;
  node: {
    id: string;
    executedAt: string | null;
    models: GraphqlEventModel[];
  };
};

type GraphqlEventPage = {
  edges: GraphqlEventEdge[];
  pageInfo: {
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
    startCursor?: string | null;
    endCursor?: string | null;
  };
};

type ToriiStreamSubscriptionOptions = {
  createStream: () => unknown;
  onMessage: (response: unknown) => void;
  onError?: (error: unknown) => void;
  onComplete?: () => void;
};

type ToriiClientWithStreamFactory = {
  __jonSubscriptionHandlersInstalled?: boolean;
  createStreamSubscription?: (options: ToriiStreamSubscriptionOptions) => unknown;
};

function unwrapToriiValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unwrapToriiValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  if ('type' in record && 'value' in record) {
    return unwrapToriiValue(record.value);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nestedValue]) => [key, unwrapToriiValue(nestedValue)])
  );
}

export function normalizeGrpcEventMessage(item: GrpcEventMessage): Record<string, unknown> {
  const modelsByNamespace: Record<string, Record<string, unknown>> = {};

  for (const [qualifiedModelName, modelValue] of Object.entries(item.models ?? {})) {
    const separatorIndex = qualifiedModelName.lastIndexOf('-');
    if (separatorIndex <= 0 || separatorIndex === qualifiedModelName.length - 1) {
      continue;
    }

    const namespace = qualifiedModelName.slice(0, separatorIndex);
    const modelName = qualifiedModelName.slice(separatorIndex + 1);
    modelsByNamespace[namespace] ??= {};
    modelsByNamespace[namespace][modelName] = unwrapToriiValue(modelValue);
  }

  return {
    ...item,
    models: modelsByNamespace,
  };
}

function toriiModelFingerprint(
  item: GrpcEventMessage,
  qualifiedModelName: string,
  modelValue: unknown
): string {
  return JSON.stringify(
    [item.world_address, item.hashed_keys, qualifiedModelName, modelValue],
    (_key, value) => typeof value === 'bigint' ? value.toString() : value
  );
}

function createToriiEventClause() {
  return {
    Keys: {
      keys: [],
      pattern_matching: 'VariableLen' as const,
      models: [...TORII_EVENT_MODELS],
    },
  };
}

function createCheckpointKey(slotEnv: string, worldAddress: string): string {
  return `${slotEnv}:${worldAddress.toLowerCase()}:${TORII_LISTENER_NAME}`;
}

function normalizeEventMessageId(worldAddress: string | undefined, hashedKeys: string | undefined): string | null {
  if (!worldAddress || !hashedKeys) {
    return null;
  }

  return `${worldAddress.toLowerCase()}:${hashedKeys.toLowerCase()}`;
}

function toIsoFromUnixSeconds(value: unknown): string | null {
  const timestamp = typeof value === 'number'
    ? value
    : typeof value === 'bigint'
      ? Number(value)
      : undefined;

  if (!timestamp || !Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

function toQualifiedModelName(typename: string | undefined): string | null {
  if (!typename?.startsWith(CORE_TYPENAME_PREFIX)) {
    return null;
  }

  return `${CORE_NAMESPACE}-${typename.slice(CORE_TYPENAME_PREFIX.length)}`;
}

function eventMessageToCheckpointInput(
  item: GrpcEventMessage,
  checkpointKey: string,
  slotEnv: string,
  worldAddress: string,
  source: string,
  cursor: string | null = null
) {
  return {
    checkpointKey,
    slotEnv,
    worldAddress,
    listenerName: TORII_LISTENER_NAME,
    lastEventId: normalizeEventMessageId(item.world_address, item.hashed_keys),
    lastCursor: cursor,
    lastExecutedAt: toIsoFromUnixSeconds(item.executed_at),
    metadata: { source },
  };
}

function graphqlEdgeToEventMessage(edge: GraphqlEventEdge, worldAddress: string): GrpcEventMessage {
  const models: Record<string, unknown> = {};

  for (const model of edge.node.models ?? []) {
    const qualifiedModelName = toQualifiedModelName(model.__typename);
    if (!qualifiedModelName || !TORII_EVENT_MODEL_SET.has(qualifiedModelName)) {
      continue;
    }

    const { __typename: _typename, ...modelValue } = model;
    models[qualifiedModelName] = modelValue;
  }

  const [, hashedKeys] = edge.node.id.split(':');

  return {
    hashed_keys: hashedKeys,
    executed_at: edge.node.executedAt
      ? Math.floor(Date.parse(edge.node.executedAt) / 1000)
      : undefined,
    world_address: worldAddress,
    models,
  };
}

const EVENT_MESSAGES_QUERY = `
  query EventMessages($first: Int, $last: Int, $before: Cursor, $after: Cursor) {
    eventMessages(first: $first, last: $last, before: $before, after: $after) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          id
          executedAt
          models {
            __typename
            ... on jokers_of_neon_core_MissionCompletedEvent {
              player
              id
              mission_type
            }
            ... on jokers_of_neon_core_MissionCompletedV2Event {
              player
              period_type
              period_id
              mission_id
              template_id
              difficulty
              target
              progress
              xp
              game_id
            }
            ... on jokers_of_neon_core_CreateGameEvent {
              player
              game_id
            }
            ... on jokers_of_neon_core_CurrentHandEvent {
              game_id
              cards
            }
            ... on jokers_of_neon_core_PlayWinGameEvent {
              player
              game_id
            }
            ... on jokers_of_neon_core_PlayGameOverEvent {
              player
              game_id
            }
            ... on jokers_of_neon_core_LevelPassedEvent {
              player
              game_id
              previous_level
              new_level
            }
            ... on jokers_of_neon_core_ProgressionGameUpdateEvent {
              player
              game_id
              tier
              total_runs
              max_level
              max_round
            }
          }
        }
      }
    }
  }
`;

function getToriiGraphqlUrl(toriiUrl: string): string {
  const baseUrl = toriiUrl.replace(/\/$/, '');
  return baseUrl.endsWith('/graphql') ? baseUrl : `${baseUrl}/graphql`;
}

async function fetchEventMessagesPage(
  toriiUrl: string,
  options: { first?: number; last?: number; before?: string | null; after?: string | null }
): Promise<GraphqlEventPage> {
  if ((options.first === undefined) === (options.last === undefined)) {
    throw new Error('Torii GraphQL pagination requires exactly one of first or last');
  }

  const response = await fetch(getToriiGraphqlUrl(toriiUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TORII_GRAPHQL_TIMEOUT_MS),
    body: JSON.stringify({
      query: EVENT_MESSAGES_QUERY,
      variables: {
        first: options.first ?? null,
        last: options.last ?? null,
        before: options.before ?? null,
        after: options.after ?? null,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Torii GraphQL request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    data?: { eventMessages?: GraphqlEventPage };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(`Torii GraphQL errors: ${payload.errors.map(error => error.message ?? 'unknown').join('; ')}`);
  }

  return {
    edges: payload.data?.eventMessages?.edges ?? [],
    pageInfo: payload.data?.eventMessages?.pageInfo ?? {},
  };
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

function currentHandEventKey(gameId: number, cards: number[]): string {
  return `${gameId}:${cards.join(',')}`;
}

function isDuplicateCurrentHandEvent(gameId: number, cards: number[]): boolean {
  const now = Date.now();

  for (const [eventKey, timestamp] of recentCurrentHandEvents) {
    if (now - timestamp > CURRENT_HAND_DEDUPE_WINDOW_MS) {
      recentCurrentHandEvents.delete(eventKey);
    }
  }

  const previousTimestamp = recentCurrentHandEvents.get(currentHandEventKey(gameId, cards));
  return Boolean(previousTimestamp && now - previousTimestamp <= CURRENT_HAND_DEDUPE_WINDOW_MS);
}

function rememberCurrentHandEvent(gameId: number, cards: number[]): void {
  recentCurrentHandEvents.set(currentHandEventKey(gameId, cards), Date.now());
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
      const sourceBlockchain = (await resolveWorkerGameContext(event.gameId)).blockchain;
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
    throw error;
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
      if (shouldLogWorkerGame(gameId)) {
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
    const { blockchain, suppressLogs } = rememberWorkerGameContext(gameId, gameData);
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
      if (shouldLogWorkerGame(gameId)) {
        console.warn(`⚠️  Skipping game step: ${error.message}`);
      }
    } else {
      console.error('❌ Error saving game step:', error);
    }

    if (shouldLogWorkerGame(gameId)) {
      logWorkerLine('torii', { action: 'retry_after_game_step_error', game: gameId });
    }

    throw error;
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
    throw error;
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
    throw error;
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
    throw error;
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
    throw error;
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
    throw error;
  }
}

export async function startToriiWorker() {
  const toriiUrl = getSlotToriiUrl();
  const chainId = getSlotChainId();
  const worldAddress = getWorldAddress();
  const checkpointKey = createCheckpointKey(env.MANIFEST_SLOT_ENV, worldAddress);

  await assertToriiEventCheckpointStorage();
  logWorkerLine('torii', { action: 'checkpoint_storage_ready', storage: 'supabase' });

  logWorkerLine('torii', { action: 'config', transport: 'grpc', toriiUrl, chainId, world: worldAddress });
  logWorkerLine('torii', { action: 'grpc_init' });

  const toriiClient = new ToriiGrpcClient({
    toriiUrl,
    worldAddress,
  });

  logWorkerLine('torii', { action: 'grpc_ready' });

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
                      const context = await resolveWorkerGameContext(missionEvent.gameId);
                      shouldLog = !context.suppressLogs;
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
                const { blockchain, suppressLogs } = await resolveWorkerGameContext(gameId);
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

                if (isDuplicateCurrentHandEvent(gameId, cards)) {
                  continue;
                }

                await handleCurrentHand(gameId, cards);
                rememberCurrentHandEvent(gameId, cards);
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
                const { blockchain, suppressLogs } = await resolveWorkerGameContext(gameId);
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
                const { blockchain, suppressLogs } = await resolveWorkerGameContext(gameId);
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
                const { blockchain, suppressLogs } = await resolveWorkerGameContext(gameId);
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
                const { blockchain, suppressLogs } = await resolveWorkerGameContext(gameId);
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
          throw error;
        }
      }
    } catch (error) {
      console.error('❌ Error in callback:', error);
      throw error;
    }
  };

  const seenEvents = new Map<string, true>();
  let processingChain = Promise.resolve();
  let processingFailed = false;
  let failedEvent: {
    item: GrpcEventMessage;
    source: 'live' | 'catchup';
    cursor: string | null;
  } | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let catchUpInFlight: Promise<void> | null = null;
  let activeSubscription: unknown = null;

  const getModelFingerprint = (
    item: GrpcEventMessage,
    qualifiedModelName: string,
    modelValue: unknown
  ): string => toriiModelFingerprint(item, qualifiedModelName, modelValue);

  const rememberModelFingerprint = (fingerprint: string): void => {
    seenEvents.set(fingerprint, true);
    if (seenEvents.size > MAX_SEEN_TORII_EVENTS) {
      const oldestFingerprint = seenEvents.keys().next().value;
      if (oldestFingerprint) {
        seenEvents.delete(oldestFingerprint);
      }
    }
  };

  const saveCheckpointForEvent = async (
    item: GrpcEventMessage,
    source: ToriiEventCheckpointSource,
    cursor: string | null = null
  ): Promise<void> => {
    // The live gRPC message has no GraphQL cursor. Advancing the durable
    // checkpoint with it would discard the last resumable cursor and force a
    // full id scan on the next reconciliation. The GraphQL catch-up runs after
    // subscribing and periodically, so it remains the authoritative durable
    // checkpoint while the live stream is only the low-latency path.
    if (!shouldPersistToriiEventCheckpoint(source, cursor)) {
      return;
    }

    const checkpointInput = eventMessageToCheckpointInput(
      item,
      checkpointKey,
      env.MANIFEST_SLOT_ENV,
      worldAddress,
      source,
      cursor
    );

    if (!checkpointInput.lastEventId && !checkpointInput.lastCursor) {
      return;
    }

    await saveToriiEventCheckpoint(checkpointInput);
  };

  const enqueueEvent = (
    item: GrpcEventMessage,
    source: 'live' | 'catchup',
    cursor: string | null = null
  ): Promise<void> => {
    const eventTask = processingChain
      .then(async () => {
        const normalizedItem = normalizeGrpcEventMessage(item);
        const modelsByNamespace = normalizedItem.models as Record<string, Record<string, unknown>>;

        // Torii event messages are cumulative: a later update can contain both
        // the new model and models delivered previously for the same entity.
        // Process and deduplicate each model payload independently.
        for (const qualifiedModelName of TORII_EVENT_MODELS) {
          const separatorIndex = qualifiedModelName.lastIndexOf('-');
          const namespace = qualifiedModelName.slice(0, separatorIndex);
          const modelName = qualifiedModelName.slice(separatorIndex + 1);
          const modelValue = modelsByNamespace[namespace]?.[modelName];
          if (modelValue === undefined) {
            continue;
          }

          const fingerprint = getModelFingerprint(item, qualifiedModelName, modelValue);
          if (seenEvents.has(fingerprint)) {
            continue;
          }

          await onEventUpdated({
            data: [{
              ...normalizedItem,
              models: {
                [namespace]: {
                  [modelName]: modelValue,
                },
              },
            }],
          });
          rememberModelFingerprint(fingerprint);
        }

        await saveCheckpointForEvent(item, source, cursor);
      });

    processingChain = eventTask.catch(error => {
      processingFailed = true;
      failedEvent ??= { item, source, cursor };
      throw error;
    });

    return processingChain;
  };

  const initializeCheckpointAtHead = async (reason: string): Promise<void> => {
    const page = await fetchEventMessagesPage(toriiUrl, { first: 1 });
    const latestEdge = page.edges[0];

    if (!latestEdge) {
      if (shouldLogEmptyCheckpointInitialization(reason)) {
        logWorkerLine('torii', { action: 'checkpoint_init', reason, result: 'empty' });
      }
      return;
    }

    await saveCheckpointForEvent(
      graphqlEdgeToEventMessage(latestEdge, worldAddress),
      'checkpoint_init',
      latestEdge.cursor
    );

    logWorkerLine('torii', {
      action: 'checkpoint_init',
      reason,
      eventId: latestEdge.node.id,
      executedAt: latestEdge.node.executedAt,
    });
  };

  const findCursorByEventId = async (eventId: string): Promise<GraphqlEventEdge | null> => {
    let after: string | null = null;

    while (true) {
      const page = await fetchEventMessagesPage(toriiUrl, {
        first: TORII_GRAPHQL_CATCHUP_LIMIT,
        after,
      });

      const match = page.edges.find(edge => edge.node.id.toLowerCase() === eventId.toLowerCase());
      if (match) {
        return match;
      }

      if (!page.pageInfo.hasNextPage || page.edges.length === 0) {
        return null;
      }

      const nextAfter = page.pageInfo.endCursor ?? page.edges[page.edges.length - 1]?.cursor ?? null;
      if (!nextAfter || nextAfter === after) {
        throw new Error(`Torii cursor search did not advance for event ${eventId}`);
      }

      after = nextAfter;
    }
  };

  const resolveCheckpointCursor = async (
    checkpoint: ToriiEventCheckpoint,
    reason: string
  ): Promise<string> => {
    if (checkpoint.lastCursor) {
      return checkpoint.lastCursor;
    }

    if (!checkpoint.lastEventId) {
      throw new Error(`Checkpoint ${checkpoint.checkpointKey} has no cursor or event id`);
    }

    const edge = await findCursorByEventId(checkpoint.lastEventId);
    if (!edge) {
      logWorkerLine('torii', {
        action: 'checkpoint_cursor_missing',
        reason,
        eventId: checkpoint.lastEventId,
      });
      throw new Error(`Checkpoint event not found in Torii: ${checkpoint.lastEventId}`);
    }

    await saveCheckpointForEvent(
      graphqlEdgeToEventMessage(edge, worldAddress),
      'checkpoint_init',
      edge.cursor
    );

    return edge.cursor;
  };

  const catchUpFromCheckpoint = async (reason: string): Promise<void> => {
    const checkpoint = await loadToriiEventCheckpoint(checkpointKey);

    if (!checkpoint) {
      await initializeCheckpointAtHead(reason);
      return;
    }

    let before = await resolveCheckpointCursor(checkpoint, reason);
    let eventCount = 0;
    let pageCount = 0;

    while (true) {
      const page = await fetchEventMessagesPage(toriiUrl, {
        last: TORII_GRAPHQL_CATCHUP_LIMIT,
        before,
      });

      if (page.edges.length === 0) {
        break;
      }

      // With `last + before`, Torii returns the page from the checkpoint
      // toward the head. Persisting each edge makes large catch-ups resumable.
      for (const edge of page.edges) {
        await enqueueEvent(graphqlEdgeToEventMessage(edge, worldAddress), 'catchup', edge.cursor);
        eventCount += 1;
      }

      pageCount += 1;
      if (!page.pageInfo.hasNextPage) {
        break;
      }

      const nextBefore = page.pageInfo.endCursor ?? page.edges[page.edges.length - 1]?.cursor ?? null;
      if (!nextBefore || nextBefore === before) {
        throw new Error('Torii catch-up cursor did not advance');
      }

      before = nextBefore;
    }

    if (reason !== 'periodic' || eventCount > 0) {
      logWorkerLine('torii', {
        action: 'checkpoint_catchup',
        reason,
        count: eventCount,
        pages: pageCount,
        checkpointEventId: checkpoint.lastEventId,
      });
    }
  };

  const runCatchUp = async (reason: string): Promise<void> => {
    if (catchUpInFlight) {
      return catchUpInFlight;
    }

    const catchUpTask = (async () => {
      if (processingFailed) {
        await processingChain.catch(() => undefined);
        processingChain = Promise.resolve();
        processingFailed = false;
      }

      if (failedEvent) {
        const eventToRetry = failedEvent;
        failedEvent = null;
        logWorkerLine('torii', {
          action: 'retry_failed_event',
          source: eventToRetry.source,
        });
        await enqueueEvent(eventToRetry.item, eventToRetry.source, eventToRetry.cursor);
      }

      await catchUpFromCheckpoint(reason);
    })();

    catchUpInFlight = catchUpTask;
    try {
      await catchUpTask;
    } finally {
      if (catchUpInFlight === catchUpTask) {
        catchUpInFlight = null;
      }
    }
  };

  const catchUpScheduler = new ToriiCatchUpScheduler({
    runCatchUp,
    periodicIntervalMs: TORII_PERIODIC_CATCHUP_INTERVAL_MS,
    retryBaseDelayMs: TORII_RECONNECT_DELAY_MS,
    retryMaxDelayMs: TORII_CATCHUP_RETRY_MAX_DELAY_MS,
    onPeriodicFailure: error => {
      logWorkerLine('torii', {
        action: 'periodic_catchup_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onRetryScheduled: ({ reason, attempt, delayMs, error }) => {
      logWorkerLine('torii', {
        action: 'checkpoint_catchup_retry_scheduled',
        reason,
        attempt,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onRetryFailure: (reason, retryError) => {
      logWorkerLine('torii', {
        action: 'checkpoint_catchup_retry_failed',
        reason,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      });
    },
  });

  const cancelSubscription = (subscription: unknown): void => {
    try {
      (subscription as { cancel?: () => void } | null)?.cancel?.();
    } catch (error) {
      console.warn('[torii] action=subscription_cancel_failed', error);
    }
  };

  const scheduleReconnect = (reason: string, error?: unknown): void => {
    if (stopped || reconnectTimer) {
      return;
    }

    logWorkerLine('torii', {
      action: 'subscription_reconnect_scheduled',
      reason,
      delayMs: TORII_RECONNECT_DELAY_MS,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectSubscription(`reconnect_${reason}`).catch((reconnectError: unknown) => {
        logWorkerLine('torii', {
          action: 'subscription_reconnect_failed',
          reason,
          error: reconnectError instanceof Error ? reconnectError.message : String(reconnectError),
        });
        scheduleReconnect('reconnect_failed', reconnectError);
      });
    }, TORII_RECONNECT_DELAY_MS);
  };

  const formatSubscriptionError = (error: unknown): { message: string; code?: string } => {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    return {
      message: error instanceof Error ? error.message : String(error),
      code: typeof record?.code === 'string' ? record.code : undefined,
    };
  };

  const installToriiStreamHandlers = (): boolean => {
    const streamClient = toriiClient as unknown as ToriiClientWithStreamFactory;
    if (streamClient.__jonSubscriptionHandlersInstalled) {
      return true;
    }

    const createStreamSubscription = streamClient.createStreamSubscription?.bind(streamClient);
    if (!createStreamSubscription) {
      return false;
    }

    streamClient.createStreamSubscription = (options: ToriiStreamSubscriptionOptions) => createStreamSubscription({
      ...options,
      onError: options.onError ?? ((error: unknown) => {
        const { message, code } = formatSubscriptionError(error);
        logWorkerLine('torii', {
          action: 'subscription_error',
          message,
          code,
        });
        scheduleReconnect('stream_error', error);
      }),
      onComplete: options.onComplete ?? (() => {
        logWorkerLine('torii', { action: 'subscription_complete' });
        scheduleReconnect('stream_complete');
      }),
    });
    streamClient.__jonSubscriptionHandlersInstalled = true;
    return true;
  };

  const watchSubscription = (subscription: unknown): void => {
    const stream = (subscription as { _subscription?: { stream?: unknown } } | null)?._subscription?.stream as
      | { responses?: { onError?: (callback: (error: unknown) => void) => void; onComplete?: (callback: () => void) => void } }
      | undefined;

    stream?.responses?.onError?.((error: unknown) => {
      const { message, code } = formatSubscriptionError(error);
      logWorkerLine('torii', {
        action: 'subscription_error',
        message,
        code,
      });
      scheduleReconnect('stream_error', error);
    });

    stream?.responses?.onComplete?.(() => {
      logWorkerLine('torii', { action: 'subscription_complete' });
      scheduleReconnect('stream_complete');
    });
  };

  async function connectSubscription(reason: string): Promise<void> {
    if (stopped) {
      return;
    }

    if (activeSubscription) {
      cancelSubscription(activeSubscription);
      activeSubscription = null;
    }

    const hasManagedStreamHandlers = installToriiStreamHandlers();

    logWorkerLine('torii', { action: 'subscribe', reason });
    const subscription = await toriiClient.onEventMessageUpdated(
      createToriiEventClause(),
      (item: GrpcEventMessage) => {
        void enqueueEvent(item, 'live').catch(error => {
          logWorkerLine('torii', {
            action: 'process_event_failed',
            source: 'live',
            error: error instanceof Error ? error.message : String(error),
          });
          catchUpScheduler.scheduleRetry('live_processing_failed', error);
        });
      },
      [worldAddress]
    );
    activeSubscription = subscription;
    if (!hasManagedStreamHandlers) {
      watchSubscription(subscription);
    }
    logWorkerLine('torii', { action: 'subscribed', reason });
    try {
      await catchUpScheduler.requestCatchUp(reason);
    } catch (error) {
      logWorkerLine('torii', {
        action: 'checkpoint_catchup_failed',
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await connectSubscription('startup');
  catchUpScheduler.start();

  logWorkerLine('torii', {
    action: 'listener_ready',
    transport: 'grpc',
    events: 'MissionCompletedV2,CreateGame,CurrentHand,PlayWin,PlayGameOver,LevelPassed,ProgressionUpdate',
  });

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    catchUpScheduler.stop();
    logWorkerLine('torii', { action: 'subscription_cancel' });
    cancelSubscription(activeSubscription);
    activeSubscription = null;
  };
}
