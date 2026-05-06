import { w3cwebsocket } from 'websocket';
import { init } from '@dojoengine/sdk/node';
import { HistoricalToriiQueryBuilder } from '@dojoengine/sdk/node';
import { env } from './env.js';
import { dojoConfig } from './dojoConfig.js';
import { getTransactionQueue } from './transactionQueue.js';
import { fetchAndSaveGameStep, fetchGameBlockchain, EmptyGameDataError } from './services/gameStepsService.js';
import { getCronScheduler } from './cron/cronScheduler.js';
import { preloadSlotConfig, getSlotToriiUrl, getSlotRelayUrl } from './config/slotConfig.js';
import { preloadSlotManifest, getWorldAddress } from './config/manifest.js';
import {
  getAllBlockchainEventHandlers,
  getBlockchainEventHandler,
  type BlockchainEventHandler,
} from './blockchainEventHandlers.js';
import type { EnqueueTransactionParams, SupportedBlockchain } from './transactionQueueTypes.js';

// Configuración necesaria para WebSocket en Node.js
// @ts-ignore
global.WebSocket = w3cwebsocket;
// @ts-ignore
global.WorkerGlobalScope = global;

// Initialize transaction queue
const txQueue = getTransactionQueue();

// Initialize cron scheduler
const cronScheduler = getCronScheduler();

console.log('🎮 Jokers of Neon - Event Listener');
console.log('═'.repeat(60));
console.log(`Slot Env:     ${env.MANIFEST_SLOT_ENV}`);
console.log('═'.repeat(60));
console.log('');

async function resolveGameBlockchain(gameId: number): Promise<SupportedBlockchain> {
  const blockchain = await fetchGameBlockchain(gameId);
  console.log(`   Target blockchain: ${blockchain}`);
  return blockchain;
}

async function enqueueTransactions(transactions: EnqueueTransactionParams[]): Promise<void> {
  for (const transaction of transactions) {
    await txQueue.enqueue(transaction);
  }
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
    getAllBlockchainEventHandlers().map(handler => build(handler))
  );

  return transactionGroups.flat();
}

async function buildTransactionsForGameBlockchain(
  gameId: number,
  build: (blockchain: SupportedBlockchain) => Promise<EnqueueTransactionParams[]>
): Promise<EnqueueTransactionParams[]> {
  const blockchain = await resolveGameBlockchain(gameId);
  return build(blockchain);
}

/**
 * Handles daily mission completed event
 */
async function handleDailyMissionCompleted(player: string, missionId: string, missionType: string) {
  console.log(`\n🔄 Processing completed mission for ${player}...`);
  console.log(`   Mission ID: ${missionId}`);
  console.log(`   Mission Type: ${missionType}`);

  try {
    const transactions = await buildTransactionsForAllChains(handler =>
      handler.buildMissionCompletedTransactions({ player, missionId, missionType })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Daily mission completed', transactions);
  } catch (error) {
    console.error('❌ Error queueing daily mission XP transaction:', error);
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
      // API returned empty data - this is not a critical error, just skip saving
      console.warn(`⚠️  Skipping game step: ${error.message}`);
    } else {
      // Other errors (network, API down, etc.)
      console.error('❌ Error saving game step:', error);
    }
    // Worker continues running - errors don't stop the listener
    console.log('👂 Continuing to listen for events...\n');
  }
}

/**
 * Handles game won event
 */
async function handlePlayWinGame(player: string, gameId: number) {
  console.log(`\n🔄 Processing game won for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(gameId, async blockchain =>
      getBlockchainEventHandler(blockchain).buildPlayWinGameTransactions({ player, gameId })
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
async function handleGameOver(player: string, gameId: number) {
  console.log(`\n🔄 Processing game over for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(gameId, async blockchain =>
      getBlockchainEventHandler(blockchain).buildPlayGameOverTransactions({ player, gameId })
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
async function handleCreateGame(player: string, gameId: number) {
  console.log(`\n🔄 Processing game creation for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    console.log('🎮 Recording game played in stats...');
    const transactions = await buildTransactionsForGameBlockchain(gameId, async blockchain =>
      getBlockchainEventHandler(blockchain).buildCreateGameTransactions({ player, gameId })
    );
    await enqueueTransactions(transactions);
    logTransactionBuildResult('Create game', transactions);
  } catch (error) {
    console.error('❌ Error recording game creation:', error);
  }
}

/**
 * Handles progression updated event
 * Syncs player progression from Core (Slot) to Profile (Mainnet)
 */
async function handleProgressionUpdated(player: string, tier: number, totalRuns: number, maxLevel: number, maxRound: number) {
  console.log(`\n🔄 Processing progression update for ${player}...`);
  console.log(`   Tier: ${tier}, Total Runs: ${totalRuns}, Max Level: ${maxLevel}, Max Round: ${maxRound}`);

  try {
    const transactions = await buildTransactionsForAllChains(handler =>
      handler.buildProgressionUpdatedTransactions({ player, tier, totalRuns, maxLevel, maxRound })
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
async function handleLevelPassed(player: string, gameId: number, previousLevel: number, newLevel: number) {
  console.log(`\n🔄 Processing level passed for ${player}...`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Previous Level: ${previousLevel}`);
  console.log(`   New Level: ${newLevel}`);

  try {
    const transactions = await buildTransactionsForGameBlockchain(gameId, async blockchain =>
      getBlockchainEventHandler(blockchain).buildLevelPassedTransactions({
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

// Create main worker
async function createWorker() {
  // Preload remote configs
  console.log('🔌 Loading remote Slot config and manifest...\n');
  await preloadSlotConfig();
  await preloadSlotManifest();

  const toriiUrl = getSlotToriiUrl();
  const relayUrl = getSlotRelayUrl();
  const worldAddress = getWorldAddress();

  console.log(`Torii URL:    ${toriiUrl}`);
  console.log(`Relay URL:    ${relayUrl}`);
  console.log(`World:        ${worldAddress}`);
  console.log('');

  console.log('🔌 Initializing Dojo SDK...\n');

  // Initialize transaction queue
  await txQueue.initialize();
  console.log('');

  // Start cron scheduler for pack distribution
  cronScheduler.start();

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

            // Check if MissionCompletedEvent exists
            if (coreModels.MissionCompletedEvent) {
              const event = coreModels.MissionCompletedEvent;

              console.log('\n📊 MissionCompletedEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Mission ID:    ${event.id || 'N/A'}`);
              console.log(`   Mission Type:  ${event.mission_type || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.player && event.id !== undefined && event.mission_type !== undefined) {
                await handleDailyMissionCompleted(
                  event.player,
                  event.id.toString(),
                  event.mission_type.toString()
                );
              } else {
                console.log('⚠️  Incomplete MissionCompletedEvent - will not be processed');
              }
            }

            // Check if CreateGameEvent exists
            if (coreModels.CreateGameEvent) {
              const event = coreModels.CreateGameEvent;

              console.log('\n🎮 CreateGameEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.player && event.game_id !== undefined) {
                await handleCreateGame(event.player, event.game_id);
              } else {
                console.log('⚠️  Incomplete CreateGameEvent - will not be processed');
              }
            }

            // Check if CurrentHandEvent exists
            if (coreModels.CurrentHandEvent) {
              const event = coreModels.CurrentHandEvent;

              console.log('\n🎮 CurrentHandEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Cards:         ${event.cards ? `[${event.cards.join(', ')}]` : 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.game_id !== undefined && event.cards !== undefined) {
                await handleCurrentHand(event.game_id, event.cards);
              } else {
                console.log('⚠️  Incomplete CurrentHandEvent - will not be processed');
              }
            }

            // Check if PlayWinGameEvent exists
            if (coreModels.PlayWinGameEvent) {
              const event = coreModels.PlayWinGameEvent;

              console.log('\n🏆 PlayWinGameEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.player && event.game_id !== undefined) {
                await handlePlayWinGame(event.player, event.game_id);
              } else {
                console.log('⚠️  Incomplete PlayWinGameEvent - will not be processed');
              }
            }

            // Check if PlayGameOverEvent exists
            if (coreModels.PlayGameOverEvent) {
              const event = coreModels.PlayGameOverEvent;

              console.log('\n🏁 PlayGameOverEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.player && event.game_id !== undefined) {
                await handleGameOver(event.player, event.game_id);
              } else {
                console.log('⚠️  Incomplete PlayGameOverEvent - will not be processed');
              }
            }

            // Check if LevelPassedEvent exists
            if (coreModels.LevelPassedEvent) {
              const event = coreModels.LevelPassedEvent;

              console.log('\n⬆️  LevelPassedEvent found!');
              console.log(`   Entity ID:       ${entityId}`);
              console.log(`   Player:          ${event.player || 'N/A'}`);
              console.log(`   Game ID:         ${event.game_id || 'N/A'}`);
              console.log(`   Previous Level:  ${event.previous_level || 'N/A'}`);
              console.log(`   New Level:       ${event.new_level || 'N/A'}`);
              console.log(`   Timestamp:       ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.player && event.game_id !== undefined && event.previous_level !== undefined && event.new_level !== undefined) {
                await handleLevelPassed(
                  event.player,
                  Number(event.game_id),
                  Number(event.previous_level),
                  Number(event.new_level)
                );
              } else {
                console.log('⚠️  Incomplete LevelPassedEvent - will not be processed');
              }
            }

            // Check if ProgressionUpdatedEvent exists
            if (coreModels.ProgressionUpdatedEvent) {
              const event = coreModels.ProgressionUpdatedEvent;

              console.log('\n📈 ProgressionUpdatedEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Tier:          ${event.tier ?? 'N/A'}`);
              console.log(`   Total Runs:    ${event.total_runs ?? 'N/A'}`);
              console.log(`   Max Level:     ${event.max_level ?? 'N/A'}`);
              console.log(`   Max Round:     ${event.max_round ?? 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              if (event.player && event.tier !== undefined && event.total_runs !== undefined && event.max_level !== undefined && event.max_round !== undefined) {
                await handleProgressionUpdated(
                  event.player,
                  Number(event.tier),
                  Number(event.total_runs),
                  Number(event.max_level),
                  Number(event.max_round)
                );
              } else {
                console.log('⚠️  Incomplete ProgressionUpdatedEvent - will not be processed');
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
      'jokers_of_neon_core-CreateGameEvent',
      'jokers_of_neon_core-CurrentHandEvent',
      'jokers_of_neon_core-PlayWinGameEvent',
      'jokers_of_neon_core-PlayGameOverEvent',
      'jokers_of_neon_core-LevelPassedEvent',
      'jokers_of_neon_core-ProgressionUpdatedEvent'
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
        console.log(`   ${index + 1}. Player: ${event.player || 'N/A'}, Mission: ${event.id || 'N/A'}`);
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
  console.log('   - MissionCompletedEvent');
  console.log('   - CreateGameEvent');
  console.log('   - CurrentHandEvent');
  console.log('   - PlayWinGameEvent');
  console.log('   - PlayGameOverEvent');
  console.log('   - LevelPassedEvent');
  console.log('   - ProgressionUpdatedEvent\n');
  console.log('Press Ctrl+C to stop\n');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Stopping listeners...');
    subscription.cancel();
    cronScheduler.stop();
    process.exit(0);
  });
}

// Start the worker
createWorker().catch((error) => {
  console.error('❌ Fatal error starting worker:', error);
  process.exit(1);
});
