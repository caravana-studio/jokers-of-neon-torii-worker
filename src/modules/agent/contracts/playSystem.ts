import { Account, Call } from "starknet";
import { getAccount, contractAddresses } from "../agentConfig.js";
import { arrayWithLength } from "../types/index.js";
import { executeAgentCall } from "./execute.js";

/**
 * Play cards in the current round
 *
 * @param gameId - The game ID
 * @param playedCardsIndexes - Array of card indexes to play
 * @param playedModifiersIndexes - Array of modifier indexes to apply
 * @param playedPowerUpsIndexes - Array of power-up indexes to use
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function play(
  gameId: bigint,
  playedCardsIndexes: number[],
  playedModifiersIndexes: number[],
  playedPowerUpsIndexes: number[],
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.playSystem,
    entrypoint: "play",
    calldata: [
      gameId.toString(),
      ...arrayWithLength(playedCardsIndexes),
      ...arrayWithLength(playedModifiersIndexes),
      ...arrayWithLength(playedPowerUpsIndexes),
    ],
  };

  return executeAgentCall(acc, call);
}
