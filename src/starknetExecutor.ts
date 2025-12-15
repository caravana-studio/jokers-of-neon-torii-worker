import { Account, Call, RpcProvider } from 'starknet';
import { env } from './env.js';
import type { Game, Round, GameSpecials, PlayerStats } from './schema.js';

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

/**
 * Llama a la función de vista get_player_stats del contrato GAME_VIEW
 * Retorna las PlayerStats del juego especificado
 */
export async function getPlayerStats(gameId: number): Promise<PlayerStats> {
  console.log(`\n📖 Consultando estadísticas del jugador para el juego ${gameId}...`);

  // Usar SLOT_RPC_URL para el contrato GAME_VIEW que está desplegado en Slot
  const provider = new RpcProvider({
    nodeUrl: env.SLOT_RPC_URL,
    default: true
  });

  try {
    const result = await provider.callContract(
      {
        contractAddress: env.GAME_VIEW_CONTRACT_ADDRESS,
        entrypoint: 'get_player_stats',
        calldata: [gameId.toString()]
      },
      'latest'
    );

    console.log(`✅ Estadísticas obtenidas para el juego ${gameId}`);

    // Parsear el resultado según la estructura de PlayerStats
    let idx = 0;

    const playerStats: PlayerStats = {
      address: result[idx++],
      games_played: result[idx++],
      games_won: result[idx++],
      high_card_played: result[idx++],
      pair_played: result[idx++],
      two_pair_played: result[idx++],
      three_of_a_kind_played: result[idx++],
      four_of_a_kind_played: result[idx++],
      five_of_a_kind_played: result[idx++],
      full_house_played: result[idx++],
      flush_played: result[idx++],
      straight_played: result[idx++],
      straight_flush_played: result[idx++],
      royal_flush_played: result[idx++],
      loot_boxes_purchased: result[idx++],
      cards_purchased: result[idx++],
      specials_purchased: result[idx++],
      specials_sold: result[idx++],
      power_ups_purchased: result[idx++],
      level_ups_purchased: result[idx++],
      modifiers_purchased: result[idx++],
      rerolls_purchased: result[idx++],
      burn_purchased: result[idx++]
    };

    console.log(`   Player: ${playerStats.address}`);
    console.log(`   Games Played: ${playerStats.games_played}, Games Won: ${playerStats.games_won}`);

    return playerStats;
  } catch (error) {
    console.error(`❌ Error al obtener estadísticas del jugador para el juego ${gameId}:`, error);
    throw error;
  }
}

/**
 * Construye el calldata para add_stats a partir de PlayerStats
 * PlayerStats tiene estos campos:
 * - address: ContractAddress
 * - games_played: u32
 * - games_won: u32
 * - high_card_played: u32
 * - pair_played: u32
 * - two_pair_played: u32
 * - three_of_a_kind_played: u32
 * - four_of_a_kind_played: u32
 * - five_of_a_kind_played: u32
 * - full_house_played: u32
 * - flush_played: u32
 * - straight_played: u32
 * - straight_flush_played: u32
 * - royal_flush_played: u32
 * - loot_boxes_purchased: u32
 * - cards_purchased: u32
 * - specials_purchased: u32
 * - specials_sold: u32
 * - power_ups_purchased: u32
 * - level_ups_purchased: u32
 * - modifiers_purchased: u32
 * - rerolls_purchased: u32
 * - burn_purchased: u32
 */
export function buildPlayerStatsCalldata(playerAddress: string, playerStats: PlayerStats): any[] {
  // Construir calldata para PlayerStats
  const calldata = [
    playerAddress,
    playerStats.games_played.toString(),
    playerStats.games_won.toString(),
    playerStats.high_card_played.toString(),
    playerStats.pair_played.toString(),
    playerStats.two_pair_played.toString(),
    playerStats.three_of_a_kind_played.toString(),
    playerStats.four_of_a_kind_played.toString(),
    playerStats.five_of_a_kind_played.toString(),
    playerStats.full_house_played.toString(),
    playerStats.flush_played.toString(),
    playerStats.straight_played.toString(),
    playerStats.straight_flush_played.toString(),
    playerStats.royal_flush_played.toString(),
    playerStats.loot_boxes_purchased.toString(),
    playerStats.cards_purchased.toString(),
    playerStats.specials_purchased.toString(),
    playerStats.specials_sold.toString(),
    playerStats.power_ups_purchased.toString(),
    playerStats.level_ups_purchased.toString(),
    playerStats.modifiers_purchased.toString(),
    playerStats.rerolls_purchased.toString(),
    playerStats.burn_purchased.toString()
  ];

  return calldata;
}
