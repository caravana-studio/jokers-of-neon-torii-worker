import { Account, Call, RpcProvider } from 'starknet';
import { env } from './env.js';
import type { Game, Round } from './schema.js';

/**
 * Ejecuta una transacción en Starknet
 */
export async function executeStarknetTransaction(params: {
  contractAddress: string;
  entrypoint: string;
  calldata: any[];
}): Promise<string> {
  console.log(`\n📤 Ejecutando transacción en Starknet...`);
  console.log(`   Contract:   ${params.contractAddress}`);
  console.log(`   Entrypoint: ${params.entrypoint}`);
  console.log(`   Calldata:   ${JSON.stringify(params.calldata)}`);

  // Crear provider de Starknet con configuración para usar 'latest' por defecto
  const provider = new RpcProvider({
    nodeUrl: env.STARKNET_RPC_URL,
    default: true
  });

  // Crear cuenta desde private key
  const account = new Account({
    provider,
    address: env.STARKNET_ADDRESS,
    signer: env.STARKNET_PRIVATE_KEY,
  });

  // Preparar el call
  const call: Call = {
    contractAddress: "0x58c91a5582685762eb424af825709aa5e8d4f5158ffd773edda1e75907b6d1a",
    entrypoint: "add_daily_mission_xp",
    calldata: ["0x00f9b0f80653b11bb810614bb6a9b8f1f9ff61e64ecadb1599a3eeb3fa6492d7", "1"]
  };

  console.log("call: ", call);

  console.log(`[${new Date().toISOString()}] Calldata para ${call.entrypoint}:`, {
    fullCalldata: call.calldata
  });

  console.log(`[${new Date().toISOString()}] Ejecutando ${call.entrypoint} en Starknet...`);

  // Ejecutar transacción usando 'latest' en lugar de 'pending' (Cartridge no soporta pending)
  const starknetNonce = await account.getNonce();
  const { transaction_hash } = await account.execute(call, {
    nonce: starknetNonce,
    skipValidate: true,
  });

  console.log(`✅ Transacción enviada: ${transaction_hash}`);

  // Esperar confirmación
  console.log('⏳ Esperando confirmación...');
  await account.waitForTransaction(transaction_hash);

  console.log(`✅ Transacción confirmada: ${transaction_hash}\n`);

  return transaction_hash;
}

/**
 * Llama a la función de vista get_game_data del contrato GAME_VIEW
 * Retorna el Game y Round del juego especificado
 */
export async function getGameData(gameId: number): Promise<{ game: Game; round: Round }> {
  console.log(`\n📖 Consultando datos del juego ${gameId}...`);

  // Usar SLOT_RPC_URL para el contrato GAME_VIEW que está desplegado en Slot
  const provider = new RpcProvider({
    nodeUrl: env.SLOT_RPC_URL,
    default: true
  });

  try {
    // Llamar directamente al contrato usando provider.callContract
    const result = await provider.callContract({
      contractAddress: env.GAME_VIEW_CONTRACT_ADDRESS,
      entrypoint: 'get_game_data',
      calldata: [gameId.toString()]
    });

    console.log(`✅ Datos obtenidos para el juego ${gameId}`);

    // Parsear el resultado según la estructura del ABI
    // El resultado es un array de strings (felts) que necesitamos mapear a las estructuras
    let idx = 0;

    // Parsear Game struct
    const game: Game = {
      id: result[idx++],
      mod_id: result[idx++],
      state: { activeVariant: result[idx++] } as any, // GameState enum
      owner: result[idx++],
      player_name: result[idx++],
      player_score: result[idx++],
      level: result[idx++],
      current_node_id: result[idx++],
      round: result[idx++],
      hand_len: result[idx++],
      plays: result[idx++],
      discards: result[idx++],
      current_specials_len: result[idx++],
      special_slots: result[idx++],
      cash: result[idx++],
      available_rerolls: result[idx++],
      seed: result[idx++],
      is_tournament: result[idx++] === '0x1'
    };

    // Parsear Round struct
    // Primero viene el array de rages (Span<u32>)
    const ragesLen = parseInt(result[idx++]);
    const rages: string[] = [];
    for (let i = 0; i < ragesLen; i++) {
      rages.push(result[idx++]);
    }

    const round: Round = {
      game_id: result[idx++],
      current_score: result[idx++],
      target_score: result[idx++],
      remaining_plays: result[idx++],
      remaining_discards: result[idx++],
      rages
    };

    console.log(`   Game Level: ${game.level}, Player Score: ${game.player_score}`);
    console.log(`   Round: ${round.current_score}/${round.target_score}`);

    return { game, round };
  } catch (error) {
    console.error(`❌ Error al obtener datos del juego ${gameId}:`, error);
    throw error;
  }
}
