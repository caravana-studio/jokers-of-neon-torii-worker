import {
  Card as ApiCard,
  CurrentSpecialCard,
  FullGameResponse,
} from "../types/playback.js";
import {
  checkHand,
  CheckHandCard,
  Plays,
  Suits,
  Cards,
} from "./checkHand.js";

// Map API Card to CheckHandCard
function mapToCheckHandCard(card: ApiCard): CheckHandCard {
  const suitMap: { [key: number]: Suits } = {
    1: Suits.CLUBS,
    2: Suits.DIAMONDS,
    3: Suits.HEARTS,
    4: Suits.SPADES,
    5: Suits.JOKER,
    6: Suits.WILDCARD,
  };

  const valueMap: { [key: number]: Cards } = {
    1: Cards.TWO,
    2: Cards.THREE,
    3: Cards.FOUR,
    4: Cards.FIVE,
    5: Cards.SIX,
    6: Cards.SEVEN,
    7: Cards.EIGHT,
    8: Cards.NINE,
    9: Cards.TEN,
    10: Cards.JACK,
    11: Cards.QUEEN,
    12: Cards.KING,
    13: Cards.ACE,
    14: Cards.JOKER,
    15: Cards.JOKER,
    16: Cards.WILDCARD,
  };

  return {
    idx: card.idx, // Use the card's actual idx from API
    card_id: card.id,
    suit: suitMap[card.suit] || Suits.CLUBS,
    value: valueMap[card.value] || Cards.TWO,
    card: valueMap[card.value] || Cards.TWO,
    isNeon: card.is_neon,
  };
}

// Map special cards to CheckHandCard format
function mapSpecialCards(specialCards: CurrentSpecialCard[]): CheckHandCard[] {
  return specialCards.map((sc, idx) => ({
    idx,
    card_id: sc.effect_card_id,
  }));
}

// Generate all combinations of size k from array
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];

  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, k);

  return [...withFirst, ...withoutFirst];
}

// Play names mapping
const PLAY_NAMES: { [key: number]: string } = {
  [Plays.NONE]: "None",
  [Plays.ROYAL_FLUSH]: "Royal Flush",
  [Plays.STRAIGHT_FLUSH]: "Straight Flush",
  [Plays.FIVE_OF_A_KIND]: "Five of a Kind",
  [Plays.FOUR_OF_A_KIND]: "Four of a Kind",
  [Plays.FULL_HOUSE]: "Full House",
  [Plays.STRAIGHT]: "Straight",
  [Plays.FLUSH]: "Flush",
  [Plays.THREE_OF_A_KIND]: "Three of a Kind",
  [Plays.TWO_PAIR]: "Two Pair",
  [Plays.PAIR]: "Pair",
  [Plays.HIGH_CARD]: "High Card",
};

// Get play name from Plays enum
function getPlayName(play: Plays): string {
  return PLAY_NAMES[play] || "Unknown";
}

// Result of possible hand analysis
export interface PossibleHand {
  play: Plays;
  playName: string;
  isNeon: boolean;
  cardIndices: number[];
}

/**
 * Get all possible hands from a full game response
 * Returns an array of possible hands sorted by strength (best first)
 */
export function getPossibleHands(fullGame: FullGameResponse): PossibleHand[] {
  const handCards = fullGame.hand_cards.map((card) =>
    mapToCheckHandCard(card)
  );
  const specialCards = mapSpecialCards(fullGame.special_cards);

  const results: PossibleHand[] = [];

  // Generate combinations of 1 to 5 cards
  for (let size = 1; size <= Math.min(5, handCards.length); size++) {
    const combos = combinations(handCards, size);

    for (const combo of combos) {
      const cardIndices = combo.map((c) => c.idx);
      const result = checkHand(handCards, cardIndices, specialCards, {});

      if (result.play !== Plays.NONE) {
        results.push({
          play: result.play,
          playName: getPlayName(result.play),
          isNeon: result.isNeon,
          cardIndices,
        });
      }
    }
  }

  // Sort by play strength (lower enum = better hand)
  results.sort((a, b) => a.play - b.play);

  return results;
}

/**
 * Get unique possible hands (one per play type, best of each)
 */
export function getUniquePossibleHands(
  fullGame: FullGameResponse
): PossibleHand[] {
  const allHands = getPossibleHands(fullGame);
  const seenPlays = new Set<Plays>();

  return allHands.filter((h) => {
    if (seenPlays.has(h.play)) return false;
    seenPlays.add(h.play);
    return true;
  });
}

/**
 * Get best hand from a full game response
 */
export function getBestHand(fullGame: FullGameResponse): PossibleHand | null {
  const hands = getPossibleHands(fullGame);
  return hands.length > 0 ? hands[0] : null;
}
