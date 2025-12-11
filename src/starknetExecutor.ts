import { Account, Call, RpcProvider } from 'starknet';
import { env } from './env.js';
import type { Game, Round, GameSpecials } from './schema.js';

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
    contractAddress: params.contractAddress,
    entrypoint: params.entrypoint,
    calldata: params.calldata
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
    const result = await provider.callContract(
      {
        contractAddress: env.GAME_VIEW_CONTRACT_ADDRESS,
        entrypoint: 'get_game_data',
        calldata: [gameId.toString()]
      },
      'latest'
    );

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

/**
 * Obtiene los GameSpecials de un juego desde el Game View
 * Retorna un array de effect_card_id (u32[]) extraídos de CurrentSpecialCards
 */
export async function getGameSpecials(gameId: number): Promise<number[]> {
  console.log(`\n📖 Consultando specials del juego ${gameId}...`);

  // Usar SLOT_RPC_URL para el contrato GAME_VIEW que está desplegado en Slot
  const provider = new RpcProvider({
    nodeUrl: env.SLOT_RPC_URL,
    default: true
  });

  try {
    const result = await provider.callContract(
      {
        contractAddress: env.GAME_VIEW_CONTRACT_ADDRESS,
        entrypoint: 'get_special_cards',
        calldata: [gameId.toString()]
      },
      'latest'
    );

    console.log(`✅ Special cards obtenidos para el juego ${gameId}`);

    // El resultado es un Span<CurrentSpecialCards>
    // Primero viene la longitud del span
    const specialsLen = parseInt(result[0]);
    const specials: number[] = [];

    // CurrentSpecialCards tiene 6 campos: game_id, idx, effect_card_id, is_temporary, remaining, selling_price
    let idx = 1; // Empezamos después de la longitud

    for (let i = 0; i < specialsLen; i++) {
      // Parsear CurrentSpecialCards (6 campos)
      // game_id, idx, effect_card_id, is_temporary, remaining, selling_price
      idx++; // Saltar game_id
      idx++; // Saltar card_idx
      const effect_card_id = result[idx++]; // Este es el que necesitamos
      idx++; // Saltar is_temporary
      idx++; // Saltar remaining
      idx++; // Saltar selling_price

      // Solo guardamos el effect_card_id
      specials.push(parseInt(effect_card_id));
    }

    console.log(`   Specials count: ${specials.length}`);
    console.log(`   Effect card IDs: [${specials.join(', ')}]`);

    return specials;
  } catch (error) {
    console.error(`❌ Error al obtener specials del juego ${gameId}:`, error);
    return [];
  }
}

/**
 * Construye el GameData a partir de Game y specials
 * GameData tiene estos campos:
 * - id: u32
 * - owner: ContractAddress
 * - player_score: u32
 * - specials: Span<u32>
 * - cash: u32
 * - round: u32
 * - is_tournament: bool
 */
export function buildGameDataCalldata(game: Game, specials: number[]): any[] {
  // Construir calldata para GameData
  const calldata = [
    game.id.toString(),                    // id: u32
    game.owner,                             // owner: ContractAddress
    game.player_score.toString(),           // player_score: u32
    specials.length.toString(),             // specials.len (Span length)
    ...specials.map(s => s.toString()),     // specials data
    game.cash.toString(),                   // cash: u32
    game.round.toString(),                  // round: u32
    game.is_tournament ? '1' : '0'          // is_tournament: bool
  ];

  return calldata;
}
