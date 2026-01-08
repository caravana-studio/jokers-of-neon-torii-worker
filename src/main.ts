import { w3cwebsocket } from 'websocket';
import { init } from '@dojoengine/sdk/node';
import { HistoricalToriiQueryBuilder } from '@dojoengine/sdk/node';
import { env } from './env.js';
import { dojoConfig } from './dojoConfig.js';
import { getGameData, getGameSpecials, buildGameDataCalldata, getPlayerStats, buildPlayerStatsCalldata, buildRoundDataCalldata } from './starknetExecutor.js';
import { getTransactionQueue } from './transactionQueue.js';

// Configuración necesaria para WebSocket en Node.js
// @ts-ignore
global.WebSocket = w3cwebsocket;
// @ts-ignore
global.WorkerGlobalScope = global;

// Initialize transaction queue
const txQueue = getTransactionQueue();

console.log('🎮 Jokers of Neon - Event Listener');
console.log('═'.repeat(60));
console.log(`Torii URL:    ${env.TORII_URL}`);
console.log(`Relay URL:    ${env.RELAY_URL}`);
console.log(`World:        ${env.WORLD_ADDRESS}`);
console.log('═'.repeat(60));
console.log('');

/**
 * Handles daily mission completed event
 */
async function handleDailyMissionCompleted(player: string, missionId: string, missionType: string) {
  console.log(`\n🔄 Processing completed mission for ${player}...`);
  console.log(`   Mission ID: ${missionId}`);
  console.log(`   Mission Type: ${missionType}`);

  try {
    // Check if Starknet executor is configured
    if (!env.XP_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  XP System not configured (read-only mode)');
      console.log('✅ Event processed (without executing transaction)\n');
      return;
    }

    // Add transaction to queue instead of executing directly
    txQueue.enqueue({
      contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_daily_mission_xp',
      calldata: [player, missionType],
    });

    console.log('✅ Daily mission XP transaction queued successfully\n');
  } catch (error) {
    console.error('❌ Error queueing daily mission XP transaction:', error);
  }
}

/**
 * Handles round score event
 * Note: set_round_data is called in handlePlayWinGame instead
 */
async function handleRoundScore(player: string, gameId: number, playerScore: number) {
  console.log(`\n📊 RoundScoreEvent received for ${player}`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Score: ${playerScore}`);
  console.log('ℹ️  No action taken (set_round_data is called on PlayWinGameEvent)\n');
}

/**
 * Handles game won event
 */
async function handlePlayWinGame(player: string, gameId: number) {
  console.log(`\n🔄 Processing game won for ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    // Check if Profile System and Game View are configured
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.GAME_VIEW_CONTRACT_ADDRESS) {
      console.log('ℹ️  Profile System or Game View not configured (read-only mode)');
      console.log('✅ Event processed (without executing transaction)\n');
      return;
    }

    // Get game data from Game View
    const { game, round } = await getGameData(gameId);
    console.log(`📊 Game data retrieved:`);
    console.log(`   Level: ${game.level}, Score: ${game.player_score}`);
    console.log(`   Round Score: ${round.current_score}/${round.target_score}`);
    console.log(`   Rages: [${round.rages.join(', ')}]`);

    // Save RoundData to Profile System
    console.log('📝 Saving round data to Profile System...');

    // Build calldata for RoundData
    const roundDataCalldata = buildRoundDataCalldata(game, round, player);

    // Add transaction to queue
    txQueue.enqueue({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'set_round_data',
      calldata: roundDataCalldata,
    });

    console.log('✅ Round data transaction queued successfully');

    // Save GameData to Profile System
    console.log('📝 Saving game data to Profile System...');

    // Get game specials
    const specials = await getGameSpecials(gameId);

    // Build calldata for GameData
    const gameDataCalldata = buildGameDataCalldata(game, specials);

    // Add transaction to queue instead of executing directly
    txQueue.enqueue({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'set_game_data',
      calldata: gameDataCalldata,
    });

    console.log('✅ Game data transaction queued successfully\n');
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
    // Check if Profile System and Game View are configured
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY || !env.GAME_VIEW_CONTRACT_ADDRESS) {
      console.log('ℹ️  Profile System or Game View not configured (read-only mode)');
      console.log('✅ Event processed (without executing transaction)\n');
      return;
    }

    // Get game data from Game View
    const { game } = await getGameData(gameId);
    console.log(`📊 Game data retrieved:`);
    console.log(`   Level: ${game.level}, Score: ${game.player_score}`);

    // Save GameData to Profile System
    console.log('📝 Saving game data to Profile System...');

    // Get game specials
    const specials = await getGameSpecials(gameId);

    // Build calldata for GameData
    const gameDataCalldata = buildGameDataCalldata(game, specials);

    // Add transaction to queue instead of executing directly
    txQueue.enqueue({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'set_game_data',
      calldata: gameDataCalldata,
    });

    console.log('✅ Game data transaction queued successfully\n');

    // Get player stats from Game View
    console.log('📊 Obtaining player stats from Game View...');
    const playerStats = await getPlayerStats(gameId);
    console.log(`   Player Stats retrieved for ${playerStats.address}`);

    // Build calldata for PlayerStats
    const playerStatsCalldata = buildPlayerStatsCalldata(player, playerStats);

    // Add stats transaction to queue
    txQueue.enqueue({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_stats',
      calldata: playerStatsCalldata,
    });

    console.log('✅ Player stats transaction queued successfully\n');

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
    // Check if Profile System is configured
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  Profile System not configured (read-only mode)');
      console.log('✅ Event processed (without executing transaction)\n');
      return;
    }

    console.log('🎮 Recording game played in stats...');

    // Create PlayerStats with only games_played = 1, rest = 0
    const playerStatsCalldata = [
      player,                // address
      '1',                   // games_played
      '0',                   // games_won
      '0',                   // high_card_played
      '0',                   // pair_played
      '0',                   // two_pair_played
      '0',                   // three_of_a_kind_played
      '0',                   // four_of_a_kind_played
      '0',                   // five_of_a_kind_played
      '0',                   // full_house_played
      '0',                   // flush_played
      '0',                   // straight_played
      '0',                   // straight_flush_played
      '0',                   // royal_flush_played
      '0',                   // loot_boxes_purchased
      '0',                   // cards_purchased
      '0',                   // specials_purchased
      '0',                   // specials_sold
      '0',                   // power_ups_purchased
      '0',                   // level_ups_purchased
      '0',                   // modifiers_purchased
      '0',                   // rerolls_purchased
      '0'                    // burn_purchased
    ];

    // Add stats transaction to queue
    txQueue.enqueue({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_stats',
      calldata: playerStatsCalldata,
    });

    console.log('✅ Game played stats transaction queued successfully\n');
  } catch (error) {
    console.error('❌ Error recording game creation:', error);
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
    // Check if XP System is configured
    if (!env.XP_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  XP System not configured (read-only mode)');
      console.log('✅ Event processed (without executing transaction)\n');
      return;
    }

    // Add transaction to queue instead of executing directly
    txQueue.enqueue({
      contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_level_completion_xp',
      calldata: [player, newLevel.toString()],
    });

    console.log('✅ Level completion XP transaction queued successfully\n');

    // When player reaches level 4, record game won in stats
    if (newLevel === 4) { //TODO: cambiar a 4
      console.log('🏆 Player passed level 3 , recording game won in stats...');

      // Create PlayerStats with only games_won = 1, rest = 0
      const playerStatsCalldata = [
        player,                // address
        '0',                   // games_played
        '1',                   // games_won
        '0',                   // high_card_played
        '0',                   // pair_played
        '0',                   // two_pair_played
        '0',                   // three_of_a_kind_played
        '0',                   // four_of_a_kind_played
        '0',                   // five_of_a_kind_played
        '0',                   // full_house_played
        '0',                   // flush_played
        '0',                   // straight_played
        '0',                   // straight_flush_played
        '0',                   // royal_flush_played
        '0',                   // loot_boxes_purchased
        '0',                   // cards_purchased
        '0',                   // specials_purchased
        '0',                   // specials_sold
        '0',                   // power_ups_purchased
        '0',                   // level_ups_purchased
        '0',                   // modifiers_purchased
        '0',                   // rerolls_purchased
        '0'                    // burn_purchased
      ];

      // Add stats transaction to queue
      txQueue.enqueue({
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'add_stats',
        calldata: playerStatsCalldata,
      });

      console.log('✅ Game won stats transaction queued successfully\n');
    }
  } catch (error) {
    console.error('❌ Error adding level completion XP:', error);
  }
}

// Create main worker
async function createWorker() {
  console.log('🔌 Initializing Dojo SDK...\n');

  // Initialize transaction queue
  await txQueue.initialize();
  console.log('');

  // Initialize SDK with example configuration
  const sdk = await init({
    client: {
      toriiUrl: env.TORII_URL,
      relayUrl: env.RELAY_URL, // Must be in multiaddr format
      worldAddress: env.WORLD_ADDRESS || dojoConfig.manifest.world.address,
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

            // Check if RoundScoreEvent exists
            if (coreModels.RoundScoreEvent) {
              const event = coreModels.RoundScoreEvent;

              console.log('\n🎮 RoundScoreEvent found!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Player Score:  ${event.player_score || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Process the event
              if (event.player && event.game_id !== undefined && event.player_score !== undefined) {
                await handleRoundScore(event.player, event.game_id, event.player_score);
              } else {
                console.log('⚠️  Incomplete RoundScoreEvent - will not be processed');
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
      'jokers_of_neon_core-RoundScoreEvent',
      'jokers_of_neon_core-PlayWinGameEvent',
      'jokers_of_neon_core-PlayGameOverEvent',
      'jokers_of_neon_core-LevelPassedEvent'
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
  console.log('   - RoundScoreEvent');
  console.log('   - PlayWinGameEvent');
  console.log('   - PlayGameOverEvent');
  console.log('   - LevelPassedEvent\n');
  console.log('Press Ctrl+C to stop\n');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Stopping listeners...');
    subscription.cancel();
    process.exit(0);
  });
}

// Start the worker
createWorker().catch((error) => {
  console.error('❌ Fatal error starting worker:', error);
  process.exit(1);
});
