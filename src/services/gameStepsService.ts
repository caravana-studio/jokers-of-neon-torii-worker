import { supabase } from '../config/supabase.js';
import { env } from '../env.js';
import { formatConfiguredBlockchains, resolveConfiguredBlockchain } from '../config/chains.js';
import type { BlockchainId } from '../transactionQueueTypes.js';

export interface FullGameData {
  blockchain?: unknown;
  [key: string]: unknown;
}

interface FetchFullGameDataOptions {
  logRequest?: boolean;
}

/**
 * Custom error for empty or invalid API responses
 */
export class EmptyGameDataError extends Error {
  constructor(gameId: number) {
    super(`API returned empty or invalid data for game_id=${gameId}`);
    this.name = 'EmptyGameDataError';
  }
}

/**
 * Validates that the game data is not empty or invalid
 */
function isValidGameData(data: any): boolean {
  // Check if data is null, undefined, or empty object
  if (!data) return false;
  if (typeof data !== 'object') return false;
  if (Object.keys(data).length === 0) return false;

  // Check for error response from API
  if (data.error) return false;

  return true;
}

/**
 * Fetches full game data from the external API
 * @throws Error if API request fails
 * @throws EmptyGameDataError if API returns empty or invalid data
 */
export async function fetchFullGameData(gameId: number, options: FetchFullGameDataOptions = {}): Promise<FullGameData> {
  const { logRequest = true } = options;
  const url = `${env.FULL_GAME_API_URL}?game_id=${gameId}`;

  if (logRequest) {
    console.log(`   Fetching game data from API: ${url}`);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as FullGameData;

  // Validate that we got useful data
  if (!isValidGameData(data)) {
    throw new EmptyGameDataError(gameId);
  }

  return data;
}

/**
 * Gets the blockchain for a game from the FULL_GAME_API_URL response.
 * Defaults to Starknet only when the API response is valid but does not include the field yet.
 */
export async function fetchGameBlockchain(
  gameId: number,
  options: FetchFullGameDataOptions = {}
): Promise<BlockchainId> {
  const data = await fetchFullGameData(gameId, options);
  const blockchain = resolveConfiguredBlockchain(data.blockchain);

  if (blockchain) {
    return blockchain;
  }

  throw new Error(
    `FULL_GAME_API_URL did not include a valid blockchain for game_id=${gameId}. Received ${String(data.blockchain)}. Supported values: ${formatConfiguredBlockchains()}`
  );
}

/**
 * Gets the next step number for a game_id
 * Steps are 0-indexed, so first step is 0
 */
async function getNextStep(gameId: number): Promise<number> {
  const { data, error } = await supabase
    .from('game_steps')
    .select('step')
    .eq('game_id', gameId)
    .order('step', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found - this is the first step
      return 0;
    }
    throw error;
  }

  return (data?.step ?? -1) + 1;
}

/**
 * Saves a game step to the database
 * @param gameId - The game ID
 * @param data - The game data from the API
 * @returns The created game step record
 */
export async function saveGameStep(gameId: number, data: FullGameData): Promise<{ id: string; step: number } | null> {
  // Check if Supabase is configured
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.log('ℹ️  Supabase not configured - skipping game step save');
    return null;
  }

  try {
    // Get the next step number for this game
    const step = await getNextStep(gameId);

    console.log(`   Saving game step: game_id=${gameId}, step=${step}`);

    // Insert the game step
    const { data: insertedData, error } = await supabase
      .from('game_steps')
      .insert({
        game_id: gameId,
        step: step,
        data: data,
      })
      .select('id, step')
      .single();

    if (error) {
      throw error;
    }

    console.log(`✅ Game step saved: id=${insertedData.id}, step=${step}`);

    return {
      id: insertedData.id,
      step: insertedData.step,
    };
  } catch (error) {
    console.error('❌ Error saving game step:', error);
    throw error;
  }
}

/**
 * Fetches game data from API and saves it as a game step
 * @param gameId - The game ID
 * @returns The created game step record or null if Supabase is not configured
 */
export async function fetchAndSaveGameStep(gameId: number): Promise<{ id: string; step: number } | null> {
  // Fetch game data from external API
  const gameData = await fetchFullGameData(gameId);

  // Save to database
  return await saveGameStep(gameId, gameData);
}
