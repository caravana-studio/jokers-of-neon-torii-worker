import { Account } from "starknet";
import { getAccount, contractAddresses } from "../agentConfig.js";
import { executeAgentCall } from "./execute.js";

/**
 * Claim lives for a season
 *
 * @param seasonId - The season ID to claim lives for
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 *
 * @example
 * ```typescript
 * // Claim lives for season 1
 * const txHash = await claim(1);
 * ```
 */
export async function claim(seasonId: number, account?: Account): Promise<string> {
  const acc = account || getAccount();

  const call = {
    contractAddress: contractAddresses.livesSystem,
    entrypoint: "claim",
    calldata: [seasonId.toString()],
  };

  return executeAgentCall(acc, call);
}
