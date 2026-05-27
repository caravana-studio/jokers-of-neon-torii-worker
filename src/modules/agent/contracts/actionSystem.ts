import { Account, Call } from "starknet";
import { getAccount, contractAddresses } from "../agentConfig.js";
import { arrayWithLength } from "../types/index.js";
import { executeAgentCall } from "./execute.js";

/**
 * Discard cards from hand
 *
 * @param gameId - The game ID
 * @param playedCardsIndexes - Array of card indexes to discard
 * @param playedModifiersIndexes - Array of modifier indexes to discard
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function discard(
  gameId: bigint,
  playedCardsIndexes: number[],
  playedModifiersIndexes: number[],
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.actionSystem,
    entrypoint: "discard",
    calldata: [
      gameId.toString(),
      ...arrayWithLength(playedCardsIndexes),
      ...arrayWithLength(playedModifiersIndexes),
    ],
  };

  return executeAgentCall(acc, call);
}

/**
 * Change a modifier card
 *
 * @param gameId - The game ID
 * @param modifierIndex - The index of the modifier to change
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function changeModifierCard(
  gameId: bigint,
  modifierIndex: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.actionSystem,
    entrypoint: "change_modifier_card",
    calldata: [gameId.toString(), modifierIndex.toString()],
  };

  return executeAgentCall(acc, call);
}
