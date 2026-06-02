import { w3cwebsocket } from 'websocket';
import { init } from '@dojoengine/sdk/node';
import { HistoricalToriiQueryBuilder } from '@dojoengine/sdk/node';
import { num, shortString } from 'starknet';
import { env, getWorkerBlockchainFilter } from './env.js';
import { getTransactionQueue } from './transactionQueue.js';
import { EmptyGameDataError, fetchAndSaveGameStep, fetchGameBlockchain } from './services/gameStepsService.js';
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

async function resolveGameBlockchain(
  gameId: number,
  options: { logTarget?: boolean; logFetch?: boolean } = {}
): Promise<BlockchainId> {
  const { logTarget = true, logFetch = true } = options;
  const blockchain = await fetchGameBlockchain(gameId, { logRequest: logFetch });

  if (logTarget) {
    console.log(`   Target blockchain: ${blockchain}`);
  }

  return blockchain;
}

async function enqueueTransactions(transactions: EnqueueTransactionParams[]): Promise<void> {
  if (!env.TRANSACTION_QUEUE_ENABLED) {
    if (transactions.length > 0) {
      console.log(`ℹ️  Transaction queue disabled; skipping ${transactions.length} transaction(s)`);
    }
    return;
  }

  for (const transaction of transactions) {
    await txQueue.enqueue(transaction);
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

function logTransactionBuildResult(label: string, transactions: EnqueueTransactionParams[]): void {
  if (transactions.length === 0) {
    console.log(`ℹ️  ${label}: no blockchain handler produced transactions\n`);
    return;
  }

  console.log(`✅ ${label}: queued ${transactions.length} transaction(s)\n`);
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
  build: (blockchain: BlockchainId) => Promise<EnqueueTransactionParams[]>
): Promise<EnqueueTransactionParams[]> {
  console.log(`   Target blockchain: ${blockchain}`);
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
async function handleMissionCompleted(event: MissionCompletedEventData) {
  console.log(`\n🔄 Processing completed mission for ${event.player}...`);
  console.log(`   Period:      ${event.periodType} (${event.periodId})`);
  console.log(`   Mission ID:  ${event.missionId}`);
  console.log(`   Template ID: ${event.templateId}`);
  console.log(`   Difficulty:  ${event.difficulty}`);
  console.log(`   Progress:    ${event.progress}/${event.target}`);
  console.log(`   XP:          ${event.xp}`);
  console.log(`   Game ID:     ${event.gameId}`);

  try {
    await markDailyStreakPending(event);

    if (event.periodType === 'daily' && event.gameId > 0) {
      const sourceBlockchain = await resolveGameBlockchain(event.gameId, {
        logTarget: false,
        logFetch: false,
      });
      console.log(`   Source chain: ${sourceBlockchain}`);
      console.log('   XP profile target: starknet');
    }

    const transactions = await buildTransactionsForGameBlockchain('starknet', selectedBlockchain =>
      getBlockchainEventHandler(selectedBlockchain).buildMissionCompletedTransactions(event)
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Mission completed', transactions);
  } catch (error) {
    console.error('❌ Error queueing mission XP transaction:', error);
  }
}

/**
 * Handles current hand event
 * Fetches game data from API and saves it as a game step
 */
async function handleCurrentHand(gameId: number, cards: number[]) {
  console.log(`\n📊 CurrentHandEvent received`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Cards: [${cards.join(', ')}]`);

  try {
    // Check if Supabase is configured
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      console.log('ℹ️  Supabase not configured (read-only mode)');
      console.log('✅ Event processed (without saving game step)\n');
      return;
    }

    // Fetch game data from API and save as a game step
    console.log('🔄 Fetching and saving game step...');
    const result = await fetchAndSaveGameStep(gameId);

    if (result) {
      console.log(`✅ Game step saved successfully: step=${result.step}\n`);
    } else {
      console.log('ℹ️  Game step not saved (Supabase not configured)\n');
    }
  } catch (error) {
    if (error instanceof EmptyGameDataError) {
      console.warn(`⚠️  Skipping game step: ${error.message}`);
    } else {
      console.error('❌ Error saving game step:', error);
    }

    console.log('👂 Continuing to listen for events...\n');
  }
}

/**
 * Handles game won event
 */
async function handlePlayWinGame(player: string, gameId: number, blockchain: BlockchainId) {
  console.log(`\n🔄 Processing game won for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(blockchain, async selectedBlockchain =>
      getBlockchainEventHandler(selectedBlockchain).buildPlayWinGameTransactions({ player, gameId })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Play win game', transactions);
  } catch (error) {
    console.error('❌ Error recording won game:', error);
  }
}

/**
 * Handles game over event
 */
async function handleGameOver(player: string, gameId: number, blockchain: BlockchainId) {
  console.log(`\n🔄 Processing game over for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(blockchain, async selectedBlockchain =>
      getBlockchainEventHandler(selectedBlockchain).buildPlayGameOverTransactions({ player, gameId })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Play game over', transactions);
  } catch (error) {
    console.error('❌ Error recording game over:', error);
  }
}

/**
 * Handles create game event
 */
async function handleCreateGame(player: string, gameId: number, blockchain: BlockchainId) {
  console.log(`\n🔄 Processing game creation for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    console.log('🎮 Recording game played in stats...');
    const transactions = await buildTransactionsForGameBlockchain(blockchain, async selectedBlockchain =>
      getBlockchainEventHandler(selectedBlockchain).buildCreateGameTransactions({ player, gameId })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Create game', transactions);
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
  blockchain: BlockchainId
) {
  console.log(`\n🔄 Processing progression update for ${player}...`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Tier: ${tier}, Total Runs: ${totalRuns}, Max Level: ${maxLevel}, Max Round: ${maxRound}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(blockchain, selectedBlockchain =>
      getBlockchainEventHandler(selectedBlockchain).buildProgressionUpdatedTransactions({
        player,
        gameId,
        tier,
        totalRuns,
        maxLevel,
        maxRound,
      })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Progression updated', transactions);
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
  blockchain: BlockchainId
) {
  console.log(`\n🔄 Processing level passed for ${player}...`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Previous Level: ${previousLevel}`);
  console.log(`   New Level: ${newLevel}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(blockchain, async selectedBlockchain =>
      getBlockchainEventHandler(selectedBlockchain).buildLevelPassedTransactions({
        player,
        gameId,
        previousLevel,
        newLevel,
      })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Level passed', transactions);
  } catch (error) {
    console.error('❌ Error adding level completion XP:', error);
  }
}

export async function startToriiWorker() {
  const toriiUrl = getSlotToriiUrl();
  const relayUrl = getSlotRelayUrl();
  const worldAddress = getWorldAddress();

  console.log(`Torii URL:    ${toriiUrl}`);
  console.log(`Relay URL:    ${relayUrl}`);
  console.log(`World:        ${worldAddress}`);
  console.log('');

  console.log('🔌 Initializing Dojo SDK...\n');

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

  console.log('✅ SDK initialized successfully\n');
  console.log('🚀 Setting up event listeners...\n');

  // Callback when an event is detected
  const onEventUpdated = async (response: any) => {
    try {
      // Response has a 'data' property with an array of entities
      if (!response || !response.data || response.data.length === 0) return;


      // Process each entity in response.data
      for (const item of response.data) {
        try {
          const { entityId, models } = item;

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
                  console.log('\n🎯 MissionCompletedV2Event found!');
                  console.log(`   Entity ID:     ${entityId}`);
                  console.log(`   Player:        ${missionEvent.player}`);
                  console.log(`   Period:        ${missionEvent.periodType} (${missionEvent.periodId})`);
                  console.log(`   Mission ID:    ${missionEvent.missionId}`);
                  console.log(`   Template ID:   ${missionEvent.templateId}`);
                  console.log(`   Difficulty:    ${missionEvent.difficulty}`);
                  console.log(`   XP:            ${missionEvent.xp}`);
                  console.log(`   Game ID:       ${missionEvent.gameId}`);
                  console.log(`   Timestamp:     ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handleMissionCompleted(missionEvent);
                }
              } else {
                console.log('⚠️  Incomplete MissionCompletedV2Event - will not be processed');
              }
            }

            // Check if CreateGameEvent exists
            if (coreModels.CreateGameEvent) {
              const event = coreModels.CreateGameEvent;

              // Process the event
              if (event.player && event.game_id !== undefined) {
                const gameId = Number(event.game_id);
                const blockchain = await resolveGameBlockchain(gameId, { logTarget: false, logFetch: false });

                if (shouldProcessBlockchain(blockchain)) {
                  console.log('\n🎮 CreateGameEvent found!');
                  console.log(`   Entity ID:     ${entityId}`);
                  console.log(`   Player:        ${event.player || 'N/A'}`);
                  console.log(`   Game ID:       ${gameId}`);
                  console.log(`   Timestamp:     ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handleCreateGame(event.player, gameId, blockchain);
                }
              } else {
                console.log('⚠️  Incomplete CreateGameEvent - will not be processed');
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
                  console.log(`↩️  Duplicate CurrentHandEvent skipped: game_id=${gameId}, cards=[${cards.join(', ')}]`);
                  continue;
                }

                const blockchain = await resolveGameBlockchain(gameId, { logTarget: false, logFetch: false });

                if (shouldProcessBlockchain(blockchain)) {
                  console.log('\n🎮 CurrentHandEvent found!');
                  console.log(`   Entity ID:     ${entityId}`);
                  console.log(`   Game ID:       ${gameId}`);
                  console.log(`   Cards:         [${cards.join(', ')}]`);
                  console.log(`   Timestamp:     ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handleCurrentHand(gameId, cards);
                }
              } else {
                console.log('⚠️  Incomplete CurrentHandEvent - will not be processed');
              }
            }

            // Check if PlayWinGameEvent exists
            if (coreModels.PlayWinGameEvent) {
              const event = coreModels.PlayWinGameEvent;

              // Process the event
              if (event.player && event.game_id !== undefined) {
                const gameId = Number(event.game_id);
                const blockchain = await resolveGameBlockchain(gameId, { logTarget: false, logFetch: false });

                if (shouldProcessBlockchain(blockchain)) {
                  console.log('\n🏆 PlayWinGameEvent found!');
                  console.log(`   Entity ID:     ${entityId}`);
                  console.log(`   Player:        ${event.player || 'N/A'}`);
                  console.log(`   Game ID:       ${gameId}`);
                  console.log(`   Timestamp:     ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handlePlayWinGame(event.player, gameId, blockchain);
                }
              } else {
                console.log('⚠️  Incomplete PlayWinGameEvent - will not be processed');
              }
            }

            // Check if PlayGameOverEvent exists
            if (coreModels.PlayGameOverEvent) {
              const event = coreModels.PlayGameOverEvent;

              // Process the event
              if (event.player && event.game_id !== undefined) {
                const gameId = Number(event.game_id);
                const blockchain = await resolveGameBlockchain(gameId, { logTarget: false, logFetch: false });

                if (shouldProcessBlockchain(blockchain)) {
                  console.log('\n🏁 PlayGameOverEvent found!');
                  console.log(`   Entity ID:     ${entityId}`);
                  console.log(`   Player:        ${event.player || 'N/A'}`);
                  console.log(`   Game ID:       ${gameId}`);
                  console.log(`   Timestamp:     ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handleGameOver(event.player, gameId, blockchain);
                }
              } else {
                console.log('⚠️  Incomplete PlayGameOverEvent - will not be processed');
              }
            }

            // Check if LevelPassedEvent exists
            if (coreModels.LevelPassedEvent) {
              const event = coreModels.LevelPassedEvent;

              // Process the event
              if (event.player && event.game_id !== undefined && event.previous_level !== undefined && event.new_level !== undefined) {
                const gameId = Number(event.game_id);
                const blockchain = await resolveGameBlockchain(gameId, { logTarget: false, logFetch: false });

                if (shouldProcessBlockchain(blockchain)) {
                  console.log('\n⬆️  LevelPassedEvent found!');
                  console.log(`   Entity ID:       ${entityId}`);
                  console.log(`   Player:          ${event.player || 'N/A'}`);
                  console.log(`   Game ID:         ${gameId}`);
                  console.log(`   Previous Level:  ${event.previous_level || 'N/A'}`);
                  console.log(`   New Level:       ${event.new_level || 'N/A'}`);
                  console.log(`   Timestamp:       ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handleLevelPassed(
                    event.player,
                    gameId,
                    Number(event.previous_level),
                    Number(event.new_level),
                    blockchain
                  );
                }
              } else {
                console.log('⚠️  Incomplete LevelPassedEvent - will not be processed');
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
                const blockchain = await resolveGameBlockchain(gameId, { logTarget: false, logFetch: false });

                if (shouldProcessBlockchain(blockchain)) {
                  console.log('\n📈 ProgressionGameUpdateEvent found!');
                  console.log(`   Entity ID:     ${entityId}`);
                  console.log(`   Player:        ${event.player || 'N/A'}`);
                  console.log(`   Game ID:       ${gameId}`);
                  console.log(`   Tier:          ${event.tier ?? 'N/A'}`);
                  console.log(`   Total Runs:    ${event.total_runs ?? 'N/A'}`);
                  console.log(`   Max Level:     ${event.max_level ?? 'N/A'}`);
                  console.log(`   Max Round:     ${event.max_round ?? 'N/A'}`);
                  console.log(`   Timestamp:     ${new Date().toISOString()}`);
                  console.log('─'.repeat(60));

                  await handleProgressionUpdated(
                    event.player,
                    gameId,
                    Number(event.tier),
                    Number(event.total_runs),
                    Number(event.max_level),
                    Number(event.max_round),
                    blockchain
                  );
                }
              } else {
                console.log('⚠️  Incomplete ProgressionGameUpdateEvent - will not be processed');
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
    console.log(`📊 Initial historical events: ${items.length}\n`);

    // Show historical events if they exist
    if (items.length > 0) {
      console.log('📜 Historical events found:');
      items.forEach((event: any, index: number) => {
        const missionEvent = normalizeMissionCompletedEvent(
          event?.models?.jokers_of_neon_core?.MissionCompletedV2Event ??
            event?.models?.jokers_of_neon_core?.MissionCompletedEvent ??
            event
        );
        if (missionEvent) {
          console.log(
            `   ${index + 1}. Player: ${missionEvent.player}, Period: ${missionEvent.periodType}, Mission: ${missionEvent.templateId || missionEvent.missionId}`
          );
        } else {
          console.log(`   ${index + 1}. Event entity: ${event?.entityId || 'N/A'}`);
        }
      });
      console.log('');
    }
  } catch (error) {
    console.warn('⚠️  Error retrieving historical events:', error);
  }

  // Subscribe to real-time events
  console.log('📡 Subscribing to real-time events...\n');

  const [, subscription] = await sdk.subscribeEventQuery({
    query,
    callback: onEventUpdated,
  });

  console.log('✅ Listener configured successfully\n');
  console.log('👂 Listening for events:');
  console.log('   - MissionCompletedV2Event');
  console.log('   - CreateGameEvent');
  console.log('   - CurrentHandEvent');
  console.log('   - PlayWinGameEvent');
  console.log('   - PlayGameOverEvent');
  console.log('   - LevelPassedEvent');
  console.log('   - ProgressionGameUpdateEvent\n');
  console.log('Press Ctrl+C to stop\n');

  return () => {
    console.log('⏹️  Cancelling Torii subscription...');
    subscription.cancel();
  };
}
