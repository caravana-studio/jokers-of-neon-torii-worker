import { w3cwebsocket } from 'websocket';
import { init } from '@dojoengine/sdk/node';
import { HistoricalToriiQueryBuilder } from '@dojoengine/sdk/node';
import { env } from './env.js';
import { dojoConfig } from './dojoConfig.js';
import { executeStarknetTransaction, getGameData, getGameSpecials, buildGameDataCalldata } from './starknetExecutor.js';

// Configuración necesaria para WebSocket en Node.js
// @ts-ignore
global.WebSocket = w3cwebsocket;
// @ts-ignore
global.WorkerGlobalScope = global;

console.log('🎮 Jokers of Neon - Event Listener');
console.log('═'.repeat(60));
console.log(`Torii URL:    ${env.TORII_URL}`);
console.log(`Relay URL:    ${env.RELAY_URL}`);
console.log(`World:        ${env.WORLD_ADDRESS}`);
console.log('═'.repeat(60));
console.log('');

/**
 * Maneja el evento de misión diaria completada
 */
async function handleDailyMissionCompleted(player: string, missionId: string, missionType: string) {
  console.log(`\n🔄 Procesando misión completada para ${player}...`);
  console.log(`   Mission ID: ${missionId}`);
  console.log(`   Mission Type: ${missionType}`);

  try {
    // Verificar si está configurado el ejecutor de Starknet
    if (!env.XP_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  XP System no configurado (modo solo lectura)');
      console.log('✅ Evento procesado (sin ejecutar transacción)\n');
      return;
    }

    // Ejecutar la transacción en XP System: add_daily_mission_xp
    await executeStarknetTransaction({
      contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_daily_mission_xp',
      calldata: [player, missionType],
    });

    console.log('✅ XP de misión diaria agregado exitosamente\n');
  } catch (error) {
    console.error('❌ Error al agregar XP de misión diaria:', error);
  }
}

/**
 * Maneja el evento de puntaje de ronda
 */
async function handleRoundScore(player: string, gameId: number, playerScore: number) {
  console.log(`\n🔄 Procesando puntaje de ronda para ${player}...`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Score: ${playerScore}`);

  try {
    // Verificar si está configurado el ejecutor de Starknet
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  Ejecutor de Starknet no configurado (modo solo lectura)');
      console.log('✅ Evento procesado (sin ejecutar transacción)\n');
      return;
    }

    // Ejecutar la transacción en Starknet
    await executeStarknetTransaction({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'record_round_score',
      calldata: [player, gameId.toString(), playerScore.toString()],
    });

    console.log('✅ Puntaje procesado y transacción ejecutada exitosamente\n');
  } catch (error) {
    console.error('❌ Error al procesar puntaje:', error);
  }
}

/**
 * Maneja el evento de juego ganado
 */
async function handlePlayWinGame(player: string, gameId: number) {
  console.log(`\n🔄 Procesando juego ganado para ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    // Verificar si está configurado el ejecutor de Starknet y Game View
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.GAME_VIEW_CONTRACT_ADDRESS) {
      console.log('ℹ️  Profile System o Game View no configurado (modo solo lectura)');
      console.log('✅ Evento procesado (sin ejecutar transacción)\n');
      return;
    }

    // Obtener datos del juego desde Game View
    const { game, round } = await getGameData(gameId);
    console.log(`📊 Datos del juego obtenidos:`);
    console.log(`   Level: ${game.level}, Score: ${game.player_score}`);
    console.log(`   Round Score: ${round.current_score}/${round.target_score}`);

    // Guardar GameData en Profile System
    console.log('📝 Guardando datos del juego en Profile System...');

    // Obtener specials del juego
    const specials = await getGameSpecials(gameId);

    // Construir calldata para GameData
    const gameDataCalldata = buildGameDataCalldata(game, specials);

    // Ejecutar transacción en Profile System
    await executeStarknetTransaction({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'set_game_data',
      calldata: gameDataCalldata,
    });

    console.log('✅ Datos del juego guardados en Profile System exitosamente\n');
  } catch (error) {
    console.error('❌ Error al registrar juego ganado:', error);
  }
}

/**
 * Maneja el evento de juego terminado
 */
async function handleGameOver(player: string, gameId: number) {
  console.log(`\n🔄 Procesando juego terminado para ${player}...`);
  console.log(`   Game ID: ${gameId}`);

  try {
    // Verificar si está configurado el ejecutor de Starknet y Game View
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY || !env.GAME_VIEW_CONTRACT_ADDRESS) {
      console.log('ℹ️  Profile System o Game View no configurado (modo solo lectura)');
      console.log('✅ Evento procesado (sin ejecutar transacción)\n');
      return;
    }

    // Obtener datos del juego desde Game View
    const { game } = await getGameData(gameId);
    console.log(`📊 Datos del juego obtenidos:`);
    console.log(`   Level: ${game.level}, Score: ${game.player_score}`);

    // Guardar GameData en Profile System
    console.log('📝 Guardando datos del juego en Profile System...');

    // Obtener specials del juego
    const specials = await getGameSpecials(gameId);

    // Construir calldata para GameData
    const gameDataCalldata = buildGameDataCalldata(game, specials);

    // Ejecutar transacción en Profile System
    await executeStarknetTransaction({
      contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'set_game_data',
      calldata: gameDataCalldata,
    });

    console.log('✅ Datos del juego guardados en Profile System exitosamente\n');
  } catch (error) {
    console.error('❌ Error al registrar juego terminado:', error);
  }
}

/**
 * Maneja el evento de nivel pasado
 */
async function handleLevelPassed(player: string, gameId: number, previousLevel: number, newLevel: number) {
  console.log(`\n🔄 Procesando nivel pasado para ${player}...`);
  console.log(`   Game ID: ${gameId}`);
  console.log(`   Previous Level: ${previousLevel}`);
  console.log(`   New Level: ${newLevel}`);

  try {
    // Verificar si está configurado el ejecutor de Starknet
    if (!env.XP_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  XP System no configurado (modo solo lectura)');
      console.log('✅ Evento procesado (sin ejecutar transacción)\n');
      return;
    }

    // Ejecutar la transacción en XP System: add_level_completion_xp
    await executeStarknetTransaction({
      contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
      entrypoint: 'add_level_completion_xp',
      calldata: [player, newLevel.toString()],
    });

    console.log('✅ XP de nivel completado agregado exitosamente\n');
  } catch (error) {
    console.error('❌ Error al agregar XP de nivel completado:', error);
  }
}

// Crear el worker principal
async function createWorker() {
  console.log('🔌 Inicializando SDK de Dojo...\n');

  // Inicializar SDK con la configuración del ejemplo
  const sdk = await init({
    client: {
      toriiUrl: env.TORII_URL,
      relayUrl: env.RELAY_URL, // Debe estar en formato multiaddr
      worldAddress: env.WORLD_ADDRESS || dojoConfig.manifest.world.address,
    },
    domain: {
      name: 'jokers-of-neon-worker',
      version: '1.0',
      chainId: 'SN_SEPOLIA',
      revision: '1',
    },
  });

  console.log('✅ SDK inicializado correctamente\n');
  console.log('🚀 Configurando listeners de eventos...\n');

  // Callback cuando se detecta un evento
  const onEventUpdated = async (response: any) => {
    try {
      // El response tiene una propiedad 'data' con un array de entidades
      if (!response || !response.data || response.data.length === 0) return;


      // Procesar cada entidad en response.data
      for (const item of response.data) {
        try {
          const { entityId, models } = item;

          // Buscar eventos en los modelos
          if (models && models.jokers_of_neon_core) {
            const coreModels = models.jokers_of_neon_core;

            // Verificar si existe DailyMissionCompletedEvent
            if (coreModels.DailyMissionCompletedEvent) {
              const event = coreModels.DailyMissionCompletedEvent;

              console.log('\n📊 DailyMissionCompletedEvent encontrado!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Mission ID:    ${event.id || 'N/A'}`);
              console.log(`   Mission Type:  ${event.mission_type || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Procesar el evento
              if (event.player && event.id !== undefined && event.mission_type !== undefined) {
                await handleDailyMissionCompleted(
                  event.player,
                  event.id.toString(),
                  event.mission_type.toString()
                );
              } else {
                console.log('⚠️  DailyMissionCompletedEvent incompleto - no se procesará');
              }
            }

            // Verificar si existe RoundScoreEvent
            // if (coreModels.RoundScoreEvent) {
            //   const event = coreModels.RoundScoreEvent;

            //   console.log('\n🎮 RoundScoreEvent encontrado!');
            //   console.log(`   Entity ID:     ${entityId}`);
            //   console.log(`   Player:        ${event.player || 'N/A'}`);
            //   console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
            //   console.log(`   Player Score:  ${event.player_score || 'N/A'}`);
            //   console.log(`   Timestamp:     ${new Date().toISOString()}`);
            //   console.log('─'.repeat(60));

            //   // Procesar el evento
            //   if (event.player && event.game_id !== undefined && event.player_score !== undefined) {
            //     await handleRoundScore(event.player, event.game_id, event.player_score);
            //   } else {
            //     console.log('⚠️  RoundScoreEvent incompleto - no se procesará');
            //   }
            // }

            // Verificar si existe PlayWinGameEvent
            if (coreModels.PlayWinGameEvent) {
              const event = coreModels.PlayWinGameEvent;

              console.log('\n🏆 PlayWinGameEvent encontrado!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Procesar el evento
              if (event.player && event.game_id !== undefined) {
                await handlePlayWinGame(event.player, event.game_id);
              } else {
                console.log('⚠️  PlayWinGameEvent incompleto - no se procesará');
              }
            }

            // Verificar si existe PlayGameOverEvent
            if (coreModels.PlayGameOverEvent) {
              const event = coreModels.PlayGameOverEvent;

              console.log('\n🏁 PlayGameOverEvent encontrado!');
              console.log(`   Entity ID:     ${entityId}`);
              console.log(`   Player:        ${event.player || 'N/A'}`);
              console.log(`   Game ID:       ${event.game_id || 'N/A'}`);
              console.log(`   Timestamp:     ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Procesar el evento
              if (event.player && event.game_id !== undefined) {
                await handleGameOver(event.player, event.game_id);
              } else {
                console.log('⚠️  PlayGameOverEvent incompleto - no se procesará');
              }
            }

            // Verificar si existe LevelPassedEvent
            if (coreModels.LevelPassedEvent) {
              const event = coreModels.LevelPassedEvent;

              console.log('\n⬆️  LevelPassedEvent encontrado!');
              console.log(`   Entity ID:       ${entityId}`);
              console.log(`   Player:          ${event.player || 'N/A'}`);
              console.log(`   Game ID:         ${event.game_id || 'N/A'}`);
              console.log(`   Previous Level:  ${event.previous_level || 'N/A'}`);
              console.log(`   New Level:       ${event.new_level || 'N/A'}`);
              console.log(`   Timestamp:       ${new Date().toISOString()}`);
              console.log('─'.repeat(60));

              // Procesar el evento
              if (event.player && event.game_id !== undefined && event.previous_level !== undefined && event.new_level !== undefined) {
                await handleLevelPassed(
                  event.player,
                  Number(event.game_id),
                  Number(event.previous_level),
                  Number(event.new_level)
                );
              } else {
                console.log('⚠️  LevelPassedEvent incompleto - no se procesará');
              }
            }

            // Si no es ninguno de los eventos que nos interesan, se ignora silenciosamente
          }
        } catch (error) {
          console.error('❌ Error al procesar item:', error);
          console.error(error);
        }
      }
    } catch (error) {
      console.error('❌ Error en callback:', error);
    }
  };

  // Crear query para eventos
  const query = new HistoricalToriiQueryBuilder()
    .withEntityModels([
      'jokers_of_neon_core-DailyMissionCompletedEvent',
      'jokers_of_neon_core-RoundScoreEvent',
      'jokers_of_neon_core-PlayWinGameEvent',
      'jokers_of_neon_core-PlayGameOverEvent',
      'jokers_of_neon_core-LevelPassedEvent'
    ])
    .withDirection('Backward')
    .withLimit(10);

  try {
    // Obtener eventos históricos iniciales
    const historicalEvents = await sdk.getEventMessages({ query });
    const items = historicalEvents.getItems();
    console.log(`📊 Eventos históricos iniciales: ${items.length}\n`);

    // Mostrar eventos históricos si existen
    if (items.length > 0) {
      console.log('📜 Eventos históricos encontrados:');
      items.forEach((event: any, index: number) => {
        console.log(`   ${index + 1}. Player: ${event.player || 'N/A'}, Mission: ${event.id || 'N/A'}`);
      });
      console.log('');
    }
  } catch (error) {
    console.warn('⚠️  Error al obtener eventos históricos:', error);
  }

  // Suscribirse a eventos en tiempo real
  console.log('📡 Suscribiéndose a eventos en tiempo real...\n');

  const [, subscription] = await sdk.subscribeEventQuery({
    query,
    callback: onEventUpdated,
  });

  console.log('✅ Listener configurado exitosamente\n');
  console.log('👂 Escuchando eventos:');
  console.log('   - DailyMissionCompletedEvent');
  console.log('   - RoundScoreEvent');
  console.log('   - PlayWinGameEvent');
  console.log('   - PlayGameOverEvent');
  console.log('   - LevelPassedEvent\n');
  console.log('Presiona Ctrl+C para detener\n');

  // Mantener el proceso vivo
  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Deteniendo listeners...');
    subscription.cancel();
    process.exit(0);
  });
}

// Iniciar el worker
createWorker().catch((error) => {
  console.error('❌ Error fatal al iniciar el worker:', error);
  process.exit(1);
});
