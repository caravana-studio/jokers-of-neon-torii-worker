/**
 * CardItemType enum matching Cairo contract
 * Represents the type of card item in the shop
 */
export enum CardItemType {
  Common = 0,
  Modifier = 1,
  None = 2,
}

/**
 * Constants used across the client
 */
export const EMPTY_MODIFIER_ID = 100;
export const EMPTY_CARD_INDEX = 100;

/**
 * Helper function to serialize an array with its length prepended
 * This matches the Cairo array serialization format
 */
export function arrayWithLength(arr: number[]): string[] {
  return [arr.length.toString(), ...arr.map((n) => n.toString())];
}

// Re-export playback types
export * from "./playback.js";
