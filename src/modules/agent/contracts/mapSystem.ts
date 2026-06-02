import { Account, Call } from "starknet";
import { getAccount, contractAddresses } from "../agentConfig.js";
import { executeAgentCall } from "./execute.js";

/**
 * Advance to a node on the map
 *
 * @param gameId - The game ID
 * @param nodeId - The node ID to advance to
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function advanceNode(
  gameId: bigint,
  nodeId: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.mapSystem,
    entrypoint: "advance_node",
    calldata: [gameId.toString(), nodeId.toString()],
  };

  // console.log(`[mapSystem] ========== ADVANCE_NODE CONTRACT CALL ==========`);
  // console.log(`[mapSystem] Contract Address: ${contractAddresses.mapSystem}`);
  // console.log(`[mapSystem] Entrypoint: advance_node`);
  // console.log(`[mapSystem] Calldata: [gameId=${gameId.toString()}, nodeId=${nodeId.toString()}]`);
  // console.log(`[mapSystem] Calldata (hex): [gameId=0x${gameId.toString(16)}, nodeId=0x${nodeId.toString(16)}]`);
  // console.log(`[mapSystem] Account Address: ${acc.address}`);
  // console.log(`[mapSystem] ======================================================`);

  const transactionHash = await executeAgentCall(acc, call);

  // console.log(`[mapSystem] Transaction submitted: ${transactionHash}`);

  return transactionHash;
}
