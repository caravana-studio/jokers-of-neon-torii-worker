import { Account } from "starknet";
import {
  FullGameResponse,
  AvailableNodesResponse,
  ShopItemsResponse,
  GameState,
} from "../types/playback.js";
import { getBestHand, getPossibleHands, PossibleHand } from "../utils/handAnalyzer.js";
import { Plays, Suits } from "../utils/checkHand.js";
import { play } from "../contracts/playSystem.js";
import { discard } from "../contracts/actionSystem.js";
import { advanceNode } from "../contracts/mapSystem.js";
import { skipShop } from "../contracts/shopSystem.js";
import {
  getFullGame,
  getAvailableNodes,
  getShopItems,
} from "../api/playbackApi.js";

// Action types for each game state
export type RoundAction = "play" | "discard";
export type MapAction = "advance";
export type StoreAction = "buy" | "skip";

// Decision interfaces
export interface RoundDecision {
  action: RoundAction;
  hand: PossibleHand | null;
}

export interface MapDecision {
  action: MapAction;
  nodeId: number;
}

export interface StoreDecision {
  action: StoreAction;
  itemIndex?: number;
}

// Result interface
export interface AgentResult {
  gameState: GameState;
  stateName: string;
  action: string;
  transactionHash: string;
  details: Record<string, unknown>;
}

/**
 * Decide action for Round/Rage state
 * Strategy: Try to get a flush
 * - If we have a flush (or better flush-based hand), play it
 * - If not, discard cards that are not of the most common suit
 */
export function decideRoundAction(fullGame: FullGameResponse): RoundDecision {
  const possibleHands = getPossibleHands(fullGame);

  // Check for flush-based hands (Royal Flush, Straight Flush, or Flush)
  const flushHand = possibleHands.find(
    (h) => h.play === Plays.FLUSH || h.play === Plays.STRAIGHT_FLUSH || h.play === Plays.ROYAL_FLUSH
  );

  if (flushHand) {
    // console.log(`[Strategy] Found flush hand: ${flushHand.playName}`);
    return {
      action: "play",
      hand: flushHand,
    };
  }

  // No flush - need to discard cards to try to get one
  // Find the most common suit in hand
  const handCards = fullGame.hand_cards;
  const suitCounts: { [suit: number]: number } = {};

  for (const card of handCards) {
    // Skip jokers and wildcards for suit counting
    if (card.suit === 5 || card.suit === 6) continue;
    suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
  }

  // Find the suit with most cards
  let mostCommonSuit = 0;
  let maxCount = 0;
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonSuit = parseInt(suit);
    }
  }

  // console.log(`[Strategy] No flush found. Most common suit: ${mostCommonSuit} (${maxCount} cards)`);

  // If we have no remaining discards, just play the best hand we have
  if (fullGame.round.remaining_discards === 0) {
    // console.log(`[Strategy] No discards remaining, playing best hand`);
    const bestHand = getBestHand(fullGame);
    return {
      action: "play",
      hand: bestHand,
    };
  }

  // Find cards to discard (cards NOT of the most common suit)
  // Discard up to 5 cards that are not of the target suit
  const cardsToDiscard = handCards
    .filter((card) => card.suit !== mostCommonSuit && card.suit !== 5 && card.suit !== 6)
    .slice(0, 5)
    .map((card) => card.idx);

  if (cardsToDiscard.length === 0) {
    // All cards are of the same suit or we can't discard more
    // Just play the best hand we have
    // console.log(`[Strategy] No cards to discard, playing best hand`);
    const bestHand = getBestHand(fullGame);
    return {
      action: "play",
      hand: bestHand,
    };
  }

  // console.log(`[Strategy] Discarding ${cardsToDiscard.length} cards: [${cardsToDiscard.join(", ")}]`);

  return {
    action: "discard",
    hand: {
      play: Plays.NONE,
      playName: "Discard for Flush",
      isNeon: false,
      cardIndices: cardsToDiscard,
    },
  };
}

/**
 * Decide action for Map state
 * For now: advance to the first available node
 */
export function decideMapAction(
  availableNodes: AvailableNodesResponse
): MapDecision {
  if (availableNodes.available_nodes.length === 0) {
    throw new Error("No available nodes to advance to");
  }

  // For now, pick the first available node
  const firstNode = availableNodes.available_nodes[0];

  return {
    action: "advance",
    nodeId: firstNode.id,
  };
}

/**
 * Decide action for Store state
 * For now: skip the shop (TODO: add buying logic)
 */
export function decideStoreAction(shopItems: ShopItemsResponse): StoreDecision {
  // For now, always skip the shop
  // TODO: Add logic to buy items
  return {
    action: "skip",
  };
}

/**
 * Execute Round action (play or discard)
 */
async function executeRoundAction(
  fullGame: FullGameResponse,
  decision: RoundDecision,
  account?: Account
): Promise<AgentResult> {
  const gameId = BigInt(fullGame.game.id);

  if (!decision.hand) {
    throw new Error("No valid hand to play or discard");
  }

  let transactionHash: string;

  // Modifiers array must match cards array length with EMPTY_MODIFIER_ID (100) for cards without modifiers
  const EMPTY_MODIFIER_ID = 100;
  const modifiers = decision.hand.cardIndices.map(() => EMPTY_MODIFIER_ID);

  if (decision.action === "play") {
    transactionHash = await play(
      gameId,
      decision.hand.cardIndices,
      modifiers,
      [],
      account
    );
  } else {
    transactionHash = await discard(
      gameId,
      decision.hand.cardIndices,
      modifiers,
      account
    );
  }

  return {
    gameState: fullGame.game.state,
    stateName: fullGame.game.state_name,
    action: decision.action,
    transactionHash,
    details: {
      hand: decision.hand.playName,
      cardIndices: decision.hand.cardIndices,
      isNeon: decision.hand.isNeon,
    },
  };
}

/**
 * Execute Map action (advance to node)
 */
async function executeMapAction(
  fullGame: FullGameResponse,
  decision: MapDecision,
  availableNodes: AvailableNodesResponse,
  account?: Account
): Promise<AgentResult> {
  const gameId = BigInt(fullGame.game.id);

  const selectedNode = availableNodes.available_nodes.find(
    (n) => n.id === decision.nodeId
  );

  // Log detailed information before executing advance_node
  // console.log(`[Agent] ========== ADVANCE NODE DEBUG ==========`);
  // console.log(`[Agent] Game ID: ${fullGame.game.id}`);
  // console.log(`[Agent] Current Node ID: ${fullGame.game.current_node_id}`);
  // console.log(`[Agent] Destination Node ID: ${decision.nodeId}`);
  // console.log(`[Agent] Destination Node Type: ${selectedNode?.node_type_name || 'Unknown'}`);
  // console.log(`[Agent] Available Nodes: ${JSON.stringify(availableNodes.available_nodes.map(n => ({
  //   id: n.id,
  //   type: n.node_type_name,
  //   store: n.store_name
  // })))}`);
  // console.log(`[Agent] Calling advanceNode(gameId=${gameId}, nodeId=${decision.nodeId})`);
  // console.log(`[Agent] ==========================================`);

  try {
    const transactionHash = await advanceNode(gameId, decision.nodeId, account);
    // console.log(`[Agent] advanceNode SUCCESS - TX Hash: ${transactionHash}`);

    return {
      gameState: fullGame.game.state,
      stateName: fullGame.game.state_name,
      action: "advance",
      transactionHash,
      details: {
        currentNodeId: fullGame.game.current_node_id,
        destinationNodeId: decision.nodeId,
        nodeType: selectedNode?.node_type_name,
      },
    };
  } catch (error) {
    // console.error(`[Agent] advanceNode FAILED`);
    // console.error(`[Agent] Error details:`, error);
    throw error;
  }
}

/**
 * Execute Store action (buy or skip)
 */
async function executeStoreAction(
  fullGame: FullGameResponse,
  decision: StoreDecision,
  account?: Account
): Promise<AgentResult> {
  const gameId = BigInt(fullGame.game.id);

  let transactionHash: string;

  if (decision.action === "skip") {
    transactionHash = await skipShop(gameId, account);
  } else {
    // TODO: Implement buy logic
    throw new Error("Buy action not implemented yet");
  }

  return {
    gameState: fullGame.game.state,
    stateName: fullGame.game.state_name,
    action: decision.action,
    transactionHash,
    details: {},
  };
}

/**
 * Run one step of the agent
 * Fetches game state, decides action, and executes it
 */
export async function runAgentStep(
  gameId: number,
  account?: Account
): Promise<AgentResult> {
  // Fetch current game state
  // console.log(`\n[Agent] Fetching game ${gameId}...`);
  const fullGame = await getFullGame(gameId);
  const state = fullGame.game.state;

  // console.log(`[Agent] Game State: ${fullGame.game.state_name}`);
  // console.log(`[Agent] Player: ${fullGame.game.player_name} | Level: ${fullGame.game.level} | Cash: ${fullGame.game.cash}`);

  switch (state) {
    case GameState.Round:
    case GameState.Rage: {
      // console.log(`[Agent] Round Info: Score ${fullGame.round.current_score}/${fullGame.round.target_score} | Plays: ${fullGame.round.remaining_plays} | Discards: ${fullGame.round.remaining_discards}`);
      // console.log(`[Agent] Hand size: ${fullGame.hand_cards.length} cards`);
      // console.log(`[Agent] Hand cards:`, fullGame.hand_cards.map((c) => `[idx:${c.idx}] ${c.value_name} of ${c.suit_name}`).join(", "));

      const decision = decideRoundAction(fullGame);
      // console.log(`[Agent] Decision: ${decision.action.toUpperCase()} -> ${decision.hand?.playName} (indices: [${decision.hand?.cardIndices.join(", ")}])${decision.hand?.isNeon ? " [NEON]" : ""}`);

      return executeRoundAction(fullGame, decision, account);
    }

    case GameState.Map: {
      const availableNodes = await getAvailableNodes(gameId);
      // const nodesInfo = availableNodes.available_nodes.map(n => {
      //   if (n.store_name) {
      //     return `${n.id}:${n.node_type_name}(${n.store_name})`;
      //   }
      //   return `${n.id}:${n.node_type_name}`;
      // }).join(", ");
      // console.log(`[Agent] Available nodes: ${nodesInfo}`);

      const decision = decideMapAction(availableNodes);
      // const selectedNode = availableNodes.available_nodes.find(n => n.id === decision.nodeId);
      // console.log(`[Agent] Decision: ADVANCE -> Node ${decision.nodeId} (${selectedNode?.node_type_name})`);

      return executeMapAction(fullGame, decision, availableNodes, account);
    }

    case GameState.Store: {
      const shopItems = await getShopItems(gameId);
      // console.log(`[Agent] Shop: ${shopItems.card_items.length} cards, ${shopItems.special_card_items.length} specials, ${shopItems.power_up_items.length} power-ups`);

      const decision = decideStoreAction(shopItems);
      // console.log(`[Agent] Decision: ${decision.action.toUpperCase()}`);

      return executeStoreAction(fullGame, decision, account);
    }

    case GameState.GameOver: {
      // console.log(`[Agent] GAME OVER - Final Score: ${fullGame.game.player_score}`);

      return {
        gameState: state,
        stateName: fullGame.game.state_name,
        action: "none",
        transactionHash: "",
        details: {
          finalScore: fullGame.game.player_score,
          message: "Game Over",
        },
      };
    }

    default: {
      throw new Error(`Unhandled game state: ${fullGame.game.state_name}`);
    }
  }
}

/**
 * Run the agent continuously until game over or max steps reached
 */
export async function runAgent(
  gameId: number,
  maxSteps: number = 100,
  account?: Account,
  onStep?: (result: AgentResult, step: number) => void
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const result = await runAgentStep(gameId, account);
    results.push(result);

    if (onStep) {
      onStep(result, step);
    }

    if (result.gameState === GameState.GameOver) {
      break;
    }

    // Delay between transactions
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return results;
}
