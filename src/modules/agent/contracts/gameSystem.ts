import { CallData, CairoOption, CairoOptionVariant, shortString, Account } from "starknet";
import { getAccount, contractAddresses, getProvider } from "../agentConfig.js";
import { executeAgentCall } from "./execute.js";

export interface NewGameResult {
  transactionHash: string;
  gameId: number;
}

// CreateGameEvent model selector (from Dojo events)
const CREATE_GAME_EVENT_KEY = "0x471153aaeb9b649e2e3a7709bcbe22e2f1c574e092379a6c5938fefe4f1f305";

/**
 * Start a new game
 *
 * @param player - The player's contract address
 * @param playerName - The player's name (will be encoded to felt252)
 * @param seed - Optional seed for randomness (null for None)
 * @param specials - Nested array of special card IDs
 * @param isTournament - Whether this is a tournament game
 * @returns Object with transaction hash and game ID from CreateGameEvent
 *
 * @example
 * ```typescript
 * // Start a new regular game
 * const { transactionHash, gameId } = await newGame(
 *   "0x1234...",
 *   "PlayerOne",
 *   null, // no seed
 *   [[1, 2], [3, 4]], // specials
 *   false
 * );
 * console.log(`Game created with ID: ${gameId}`);
 *
 * // Start a tournament game with seed
 * const result = await newGame(
 *   "0x1234...",
 *   "PlayerOne",
 *   BigInt(12345), // seed
 *   [[1, 2, 3]],
 *   true
 * );
 * ```
 */
export async function newGame(
  player: string,
  playerName: string,
  seed: bigint | null,
  specials: number[][],
  isTournament: boolean,
  account?: Account
): Promise<NewGameResult> {
  const acc = account || getAccount();
  const provider = getProvider();

  // Convert player_name to felt252 using shortString
  const playerNameFelt = BigInt(shortString.encodeShortString(playerName));

  // Prepare seed option using CairoOption
  const seedOption = seed !== null
    ? new CairoOption(CairoOptionVariant.Some, seed)
    : new CairoOption(CairoOptionVariant.None);

  // Use CallData.compile for proper serialization
  const calldata = CallData.compile([
    player,           // player: ContractAddress
    playerNameFelt,   // player_name: felt252
    seedOption,       // seed: Option<u128>
    specials,         // specials: Span<Span<u32>>
    isTournament      // is_tournament: bool
  ]);

  const call = {
    contractAddress: contractAddresses.gameSystem,
    entrypoint: "new_game",
    calldata,
  };

  const transactionHash = await executeAgentCall(acc, call);

  // Wait for transaction receipt to get events
  const receipt = await provider.waitForTransaction(transactionHash);

  // Find CreateGameEvent in the events
  let gameId = 0;
  if ("events" in receipt && receipt.events) {
    for (const event of receipt.events) {
      // In Dojo events: keys[0] is common selector, keys[1] is model/event selector
      const eventSelector = event.keys?.[1]?.toLowerCase();

      if (eventSelector === CREATE_GAME_EVENT_KEY.toLowerCase()) {
        // game_id is at data[1] in CreateGameEvent
        if (event.data && event.data.length > 1) {
          gameId = parseInt(event.data[1], 16);
          break;
        }
      }
    }
  }

  return {
    transactionHash,
    gameId,
  };
}
