import { Account, Call } from "starknet";
import { getAccount, contractAddresses } from "../agentConfig.js";
import { CardItemType, arrayWithLength } from "../types/index.js";
import { executeAgentCall } from "./execute.js";

/**
 * Burn a card from the deck
 *
 * @param gameId - The game ID
 * @param cardId - The card ID to burn
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function burnCard(
  gameId: bigint,
  cardId: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "burn_card",
    calldata: [gameId.toString(), cardId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Select cards from a loot box
 *
 * @param gameId - The game ID
 * @param cardsIndex - Array of card indexes to select
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function selectCardsFromLootBox(
  gameId: bigint,
  cardsIndex: number[],
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "select_cards_from_loot_box",
    calldata: [gameId.toString(), ...arrayWithLength(cardsIndex)],
  };
  return executeAgentCall(acc, call);
}

/**
 * Reroll the shop items
 *
 * @param gameId - The game ID
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function reroll(
  gameId: bigint,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "reroll",
    calldata: [gameId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Skip the shop and continue to the next round
 *
 * @param gameId - The game ID
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function skipShop(
  gameId: bigint,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "skip_shop",
    calldata: [gameId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Buy a card from the shop
 *
 * @param gameId - The game ID
 * @param itemId - The item ID to buy
 * @param cardItemType - The type of card item
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function buyCard(
  gameId: bigint,
  itemId: number,
  cardItemType: CardItemType,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "buy_card",
    calldata: [gameId.toString(), itemId.toString(), cardItemType.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Buy a special card from the shop
 *
 * @param gameId - The game ID
 * @param itemId - The item ID to buy
 * @param isTemporary - Whether the special card is temporary
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function buySpecialCard(
  gameId: bigint,
  itemId: number,
  isTemporary: boolean,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "buy_special_card",
    calldata: [gameId.toString(), itemId.toString(), isTemporary ? "1" : "0"],
  };
  return executeAgentCall(acc, call);
}

/**
 * Buy a poker hand upgrade from the shop
 *
 * @param gameId - The game ID
 * @param itemId - The item ID to buy
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function buyPokerHand(
  gameId: bigint,
  itemId: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "buy_poker_hand",
    calldata: [gameId.toString(), itemId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Buy a power-up from the shop
 *
 * @param gameId - The game ID
 * @param itemId - The item ID to buy
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function buyPowerUp(
  gameId: bigint,
  itemId: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "buy_power_up",
    calldata: [gameId.toString(), itemId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Buy a loot box from the shop
 *
 * @param gameId - The game ID
 * @param lootBoxItemId - The loot box item ID to buy
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function buyLootBox(
  gameId: bigint,
  lootBoxItemId: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "buy_loot_box",
    calldata: [gameId.toString(), lootBoxItemId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Buy a special card slot
 *
 * @param gameId - The game ID
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function buySpecialSlot(
  gameId: bigint,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "buy_special_slot",
    calldata: [gameId.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Sell a special card
 *
 * @param gameId - The game ID
 * @param specialCardIndex - The index of the special card to sell
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function sellSpecialCard(
  gameId: bigint,
  specialCardIndex: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "sell_special_card",
    calldata: [gameId.toString(), specialCardIndex.toString()],
  };
  return executeAgentCall(acc, call);
}

/**
 * Sell a power-up
 *
 * @param gameId - The game ID
 * @param powerUpIndex - The index of the power-up to sell
 * @param account - Optional account (uses default if not provided)
 * @returns Transaction hash
 */
export async function sellPowerUp(
  gameId: bigint,
  powerUpIndex: number,
  account?: Account
): Promise<string> {
  const acc = account || getAccount();

  const call: Call = {
    contractAddress: contractAddresses.shopSystem,
    entrypoint: "sell_power_up",
    calldata: [gameId.toString(), powerUpIndex.toString()],
  };
  return executeAgentCall(acc, call);
}
