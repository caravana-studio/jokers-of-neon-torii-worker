import { Account, Call, RpcProvider } from 'starknet';
import { env } from './env.js';
import type { Game, Round, GameSpecials, PlayerStats } from './schema.js';
import { getSlotRpcUrl } from './config/slotConfig.js';
import { getSlotGameViewsAddress } from './config/manifest.js';
import { withStarknetWriteLock } from './runtime/StarknetWriteCoordinator.js';

function compactValue(value: unknown): string {
  const text = String(value);
  return text.startsWith('0x') && text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

function logStarknetLine(scope: string, fields: Record<string, unknown>): void {
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${compactValue(value)}`)
    .join(' ');
  console.log(`[${scope}] ${details}`);
}

/**
 * RoundData structure for set_round_data
 */
export interface RoundData {
  game_id: number | string;
  round_id: number | string;
  player_address: string;
  current_score: number | string;
  target_score: number | string;
  rages: string[];
}

/**
 * Ejecuta una transacción en Starknet
 */
export async function executeStarknetTransaction(params: {
  contractAddress: string;
  entrypoint: string;
  calldata: any[];
}): Promise<string> {
  logStarknetLine('starknet', {
    action: 'send',
    entrypoint: params.entrypoint,
    contract: params.contractAddress,
    calldataLen: params.calldata.length,
  });

  // Crear provider de Starknet con configuración para usar 'latest' por defecto
  const provider = new RpcProvider({
    nodeUrl: env.BACKGROUND_STARKNET_RPC_URL,
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

  // Ejecutar transacción usando 'latest' en lugar de 'pending' (Cartridge no soporta pending)
  const transactionHash = await withStarknetWriteLock(env.STARKNET_ADDRESS, async () => {
    const starknetNonce = await account.getNonce();
    const { transaction_hash } = await account.execute(call, {
      nonce: starknetNonce,
      skipValidate: true,
    });
    return transaction_hash;
  });

  // Esperar confirmación
  await account.waitForTransaction(transactionHash);

  logStarknetLine('starknet', { action: 'confirmed', hash: transactionHash });

  return transactionHash;
}

/**
 * Llama a la función de vista get_game_data del contrato GAME_VIEW
 * Retorna el Game y Round del juego especificado
 */
export async function getGameData(gameId: number): Promise<{ game: Game; round: Round }> {
  logStarknetLine('slot-view', { action: 'get_game_data', game: gameId });

  // Usar Slot RPC para el contrato GAME_VIEW que está desplegado en Slot
  const provider = new RpcProvider({
    nodeUrl: getSlotRpcUrl(),
    default: true
  });

  try {
    const result = await provider.callContract(
      {
        contractAddress: getSlotGameViewsAddress(),
        entrypoint: 'get_game_data',
        calldata: [gameId.toString()]
      },
      'latest'
    );

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
    // Orden: game_id, current_score, target_score, remaining_plays, remaining_discards, rages (Span<u32>)
    const round_game_id = result[idx++];
    const round_current_score = result[idx++];
    const round_target_score = result[idx++];
    const round_remaining_plays = result[idx++];
    const round_remaining_discards = result[idx++];

    // Ahora viene el array de rages (Span<u32>)
    const ragesLen = parseInt(result[idx++]);
    const rages: string[] = [];
    for (let i = 0; i < ragesLen; i++) {
      rages.push(result[idx++]);
    }

    const round: Round = {
      game_id: round_game_id,
      current_score: round_current_score,
      target_score: round_target_score,
      remaining_plays: round_remaining_plays,
      remaining_discards: round_remaining_discards,
      rages
    };

    logStarknetLine('slot-view', {
      action: 'game_data',
      game: gameId,
      level: game.level,
      score: game.player_score,
      round: `${round.current_score}/${round.target_score}`,
    });

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
  logStarknetLine('slot-view', { action: 'get_special_cards', game: gameId });

  // Usar Slot RPC para el contrato GAME_VIEW que está desplegado en Slot
  const provider = new RpcProvider({
    nodeUrl: getSlotRpcUrl(),
    default: true
  });

  try {
    const result = await provider.callContract(
      {
        contractAddress: getSlotGameViewsAddress(),
        entrypoint: 'get_special_cards',
        calldata: [gameId.toString()]
      },
      'latest'
    );

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

    logStarknetLine('slot-view', { action: 'special_cards', game: gameId, count: specials.length, effectCards: `[${specials.join(',')}]` });

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
 * - level: u32
 * - player_name: felt252
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
    game.is_tournament ? '1' : '0',         // is_tournament: bool
    game.level.toString(),                  // level: u32
    game.player_name.toString()             // player_name: felt252
  ];

  return calldata;
}

/**
 * Llama a la función de vista get_player_stats del contrato GAME_VIEW
 * Retorna las PlayerStats del juego especificado
 */
export async function getPlayerStats(gameId: number): Promise<PlayerStats> {
  logStarknetLine('slot-view', { action: 'get_player_stats', game: gameId });

  // Usar Slot RPC para el contrato GAME_VIEW que está desplegado en Slot
  const provider = new RpcProvider({
    nodeUrl: getSlotRpcUrl(),
    default: true
  });

  try {
    const result = await provider.callContract(
      {
        contractAddress: getSlotGameViewsAddress(),
        entrypoint: 'get_player_stats',
        calldata: [gameId.toString()]
      },
      'latest'
    );

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

    logStarknetLine('slot-view', {
      action: 'player_stats',
      game: gameId,
      player: playerStats.address,
      played: playerStats.games_played,
      won: playerStats.games_won,
    });

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

/**
 * Construye el RoundData a partir de Game, Round y player address
 * RoundData tiene estos campos:
 * - game_id: u32
 * - round_id: u32
 * - player_address: ContractAddress
 * - current_score: u32
 * - target_score: u32
 * - rages: Span<u32>
 */
export function buildRoundDataCalldata(game: Game, round: Round, playerAddress: string): any[] {
  // Construir calldata para RoundData
  const calldata = [
    game.id.toString(),                     // game_id: u32
    game.round.toString(),                  // round_id: u32 (from game.round)
    playerAddress,                          // player_address: ContractAddress
    round.current_score.toString(),         // current_score: u32
    round.target_score.toString(),          // target_score: u32
    round.rages.length.toString(),          // rages.len (Span length)
    ...round.rages.map(r => r.toString())   // rages data
  ];

  return calldata;
}
