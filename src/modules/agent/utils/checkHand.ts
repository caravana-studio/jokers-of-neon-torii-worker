// Enums
export enum Cards {
  TWO = 2,
  THREE = 3,
  FOUR = 4,
  FIVE = 5,
  SIX = 6,
  SEVEN = 7,
  EIGHT = 8,
  NINE = 9,
  TEN = 10,
  JACK = 11,
  QUEEN = 12,
  KING = 13,
  ACE = 14,
  JOKER = 15,
  WILDCARD = 16,
}

export enum Suits {
  CLUBS = 1,
  DIAMONDS = 2,
  HEARTS = 3,
  SPADES = 4,
  JOKER = 5,
  WILDCARD = 6,
}

export enum Plays {
  NONE = 0,
  ROYAL_FLUSH = 1,
  STRAIGHT_FLUSH = 2,
  FIVE_OF_A_KIND = 3,
  FOUR_OF_A_KIND = 4,
  FULL_HOUSE = 5,
  STRAIGHT = 6,
  FLUSH = 7,
  THREE_OF_A_KIND = 8,
  TWO_PAIR = 9,
  PAIR = 10,
  HIGH_CARD = 11,
}

export enum ModifiersId {
  POINTS_MODIFIER_1 = 600,
  POINTS_MODIFIER_2 = 601,
  POINTS_MODIFIER_3 = 602,
  POINTS_MODIFIER_4 = 603,
  MULTI_MODIFIER_1 = 604,
  MULTI_MODIFIER_2 = 605,
  MULTI_MODIFIER_3 = 606,
  MULTI_MODIFIER_4 = 607,
  SUIT_CLUB_MODIFIER = 608,
  SUIT_DIAMONDS_MODIFIER = 609,
  SUIT_HEARTS_MODIFIER = 610,
  SUIT_SPADES_MODIFIER = 611,
  NEON_MODIFIER = 612,
  WILDCARD_MODIFIER = 613,
}

// Constants
export const specialCardIds = {
  ALL_TO_HEARTS: 10014,
  EASY_FLUSH: 10009,
  EASY_STRAIGHT: 10008,
  SPECIAL_CARDS_BLOCKS_SUIT_CHANGE: 10014,
};

// Card interface for checkHand
export interface CheckHandCard {
  id?: string;
  value?: Cards;
  card?: Cards;
  suit?: Suits;
  idx: number;
  card_id?: number;
  isNeon?: boolean;
}

// Card suit data map
interface CardMultiSuitData {
  card?: Cards;
  suit?: Suits;
}

type CardMultiSuitDataMap = {
  [key: number]: CardMultiSuitData;
};

const CARDS_SUIT_DATA: CardMultiSuitDataMap = {
  0: { card: Cards.TWO, suit: Suits.CLUBS },
  1: { card: Cards.THREE, suit: Suits.CLUBS },
  2: { card: Cards.FOUR, suit: Suits.CLUBS },
  3: { card: Cards.FIVE, suit: Suits.CLUBS },
  4: { card: Cards.SIX, suit: Suits.CLUBS },
  5: { card: Cards.SEVEN, suit: Suits.CLUBS },
  6: { card: Cards.EIGHT, suit: Suits.CLUBS },
  7: { card: Cards.NINE, suit: Suits.CLUBS },
  8: { card: Cards.TEN, suit: Suits.CLUBS },
  9: { card: Cards.JACK, suit: Suits.CLUBS },
  10: { card: Cards.QUEEN, suit: Suits.CLUBS },
  11: { card: Cards.KING, suit: Suits.CLUBS },
  12: { card: Cards.ACE, suit: Suits.CLUBS },
  13: { card: Cards.TWO, suit: Suits.DIAMONDS },
  14: { card: Cards.THREE, suit: Suits.DIAMONDS },
  15: { card: Cards.FOUR, suit: Suits.DIAMONDS },
  16: { card: Cards.FIVE, suit: Suits.DIAMONDS },
  17: { card: Cards.SIX, suit: Suits.DIAMONDS },
  18: { card: Cards.SEVEN, suit: Suits.DIAMONDS },
  19: { card: Cards.EIGHT, suit: Suits.DIAMONDS },
  20: { card: Cards.NINE, suit: Suits.DIAMONDS },
  21: { card: Cards.TEN, suit: Suits.DIAMONDS },
  22: { card: Cards.JACK, suit: Suits.DIAMONDS },
  23: { card: Cards.QUEEN, suit: Suits.DIAMONDS },
  24: { card: Cards.KING, suit: Suits.DIAMONDS },
  25: { card: Cards.ACE, suit: Suits.DIAMONDS },
  26: { card: Cards.TWO, suit: Suits.HEARTS },
  27: { card: Cards.THREE, suit: Suits.HEARTS },
  28: { card: Cards.FOUR, suit: Suits.HEARTS },
  29: { card: Cards.FIVE, suit: Suits.HEARTS },
  30: { card: Cards.SIX, suit: Suits.HEARTS },
  31: { card: Cards.SEVEN, suit: Suits.HEARTS },
  32: { card: Cards.EIGHT, suit: Suits.HEARTS },
  33: { card: Cards.NINE, suit: Suits.HEARTS },
  34: { card: Cards.TEN, suit: Suits.HEARTS },
  35: { card: Cards.JACK, suit: Suits.HEARTS },
  36: { card: Cards.QUEEN, suit: Suits.HEARTS },
  37: { card: Cards.KING, suit: Suits.HEARTS },
  38: { card: Cards.ACE, suit: Suits.HEARTS },
  39: { card: Cards.TWO, suit: Suits.SPADES },
  40: { card: Cards.THREE, suit: Suits.SPADES },
  41: { card: Cards.FOUR, suit: Suits.SPADES },
  42: { card: Cards.FIVE, suit: Suits.SPADES },
  43: { card: Cards.SIX, suit: Suits.SPADES },
  44: { card: Cards.SEVEN, suit: Suits.SPADES },
  45: { card: Cards.EIGHT, suit: Suits.SPADES },
  46: { card: Cards.NINE, suit: Suits.SPADES },
  47: { card: Cards.TEN, suit: Suits.SPADES },
  48: { card: Cards.JACK, suit: Suits.SPADES },
  49: { card: Cards.QUEEN, suit: Suits.SPADES },
  50: { card: Cards.KING, suit: Suits.SPADES },
  51: { card: Cards.ACE, suit: Suits.SPADES },
  52: { card: Cards.JOKER, suit: Suits.JOKER },
  53: { card: Cards.WILDCARD, suit: Suits.WILDCARD },
  // Neon cards (200-253)
  200: { card: Cards.TWO, suit: Suits.CLUBS },
  201: { card: Cards.THREE, suit: Suits.CLUBS },
  202: { card: Cards.FOUR, suit: Suits.CLUBS },
  203: { card: Cards.FIVE, suit: Suits.CLUBS },
  204: { card: Cards.SIX, suit: Suits.CLUBS },
  205: { card: Cards.SEVEN, suit: Suits.CLUBS },
  206: { card: Cards.EIGHT, suit: Suits.CLUBS },
  207: { card: Cards.NINE, suit: Suits.CLUBS },
  208: { card: Cards.TEN, suit: Suits.CLUBS },
  209: { card: Cards.JACK, suit: Suits.CLUBS },
  210: { card: Cards.QUEEN, suit: Suits.CLUBS },
  211: { card: Cards.KING, suit: Suits.CLUBS },
  212: { card: Cards.ACE, suit: Suits.CLUBS },
  213: { card: Cards.TWO, suit: Suits.DIAMONDS },
  214: { card: Cards.THREE, suit: Suits.DIAMONDS },
  215: { card: Cards.FOUR, suit: Suits.DIAMONDS },
  216: { card: Cards.FIVE, suit: Suits.DIAMONDS },
  217: { card: Cards.SIX, suit: Suits.DIAMONDS },
  218: { card: Cards.SEVEN, suit: Suits.DIAMONDS },
  219: { card: Cards.EIGHT, suit: Suits.DIAMONDS },
  220: { card: Cards.NINE, suit: Suits.DIAMONDS },
  221: { card: Cards.TEN, suit: Suits.DIAMONDS },
  222: { card: Cards.JACK, suit: Suits.DIAMONDS },
  223: { card: Cards.QUEEN, suit: Suits.DIAMONDS },
  224: { card: Cards.KING, suit: Suits.DIAMONDS },
  225: { card: Cards.ACE, suit: Suits.DIAMONDS },
  226: { card: Cards.TWO, suit: Suits.HEARTS },
  227: { card: Cards.THREE, suit: Suits.HEARTS },
  228: { card: Cards.FOUR, suit: Suits.HEARTS },
  229: { card: Cards.FIVE, suit: Suits.HEARTS },
  230: { card: Cards.SIX, suit: Suits.HEARTS },
  231: { card: Cards.SEVEN, suit: Suits.HEARTS },
  232: { card: Cards.EIGHT, suit: Suits.HEARTS },
  233: { card: Cards.NINE, suit: Suits.HEARTS },
  234: { card: Cards.TEN, suit: Suits.HEARTS },
  235: { card: Cards.JACK, suit: Suits.HEARTS },
  236: { card: Cards.QUEEN, suit: Suits.HEARTS },
  237: { card: Cards.KING, suit: Suits.HEARTS },
  238: { card: Cards.ACE, suit: Suits.HEARTS },
  239: { card: Cards.TWO, suit: Suits.SPADES },
  240: { card: Cards.THREE, suit: Suits.SPADES },
  241: { card: Cards.FOUR, suit: Suits.SPADES },
  242: { card: Cards.FIVE, suit: Suits.SPADES },
  243: { card: Cards.SIX, suit: Suits.SPADES },
  244: { card: Cards.SEVEN, suit: Suits.SPADES },
  245: { card: Cards.EIGHT, suit: Suits.SPADES },
  246: { card: Cards.NINE, suit: Suits.SPADES },
  247: { card: Cards.TEN, suit: Suits.SPADES },
  248: { card: Cards.JACK, suit: Suits.SPADES },
  249: { card: Cards.QUEEN, suit: Suits.SPADES },
  250: { card: Cards.KING, suit: Suits.SPADES },
  251: { card: Cards.ACE, suit: Suits.SPADES },
  252: { card: Cards.JOKER, suit: Suits.JOKER },
  253: { card: Cards.WILDCARD, suit: Suits.WILDCARD },
};

// Internal evaluate hand function
const evaluateHand = (
  hand: CheckHandCard[],
  preSelectedCards: number[],
  specialCards: CheckHandCard[],
  preSelectedModifiers: { [key: number]: number[] }
): Plays => {
  const specialAllCardsToHearts = specialCards.some(
    (s) => s.card_id === specialCardIds.ALL_TO_HEARTS
  );
  const easyFlush = specialCards.some(
    (s) => s.card_id === specialCardIds.EASY_FLUSH
  );
  const easyStraight = specialCards.some(
    (s) => s.card_id === specialCardIds.EASY_STRAIGHT
  );

  const getNewSuit = (modifierCardId?: number) => {
    switch (modifierCardId) {
      case ModifiersId.SUIT_CLUB_MODIFIER:
        return Suits.CLUBS;
      case ModifiersId.SUIT_DIAMONDS_MODIFIER:
        return Suits.DIAMONDS;
      case ModifiersId.SUIT_HEARTS_MODIFIER:
        return Suits.HEARTS;
      case ModifiersId.SUIT_SPADES_MODIFIER:
        return Suits.SPADES;
      case ModifiersId.WILDCARD_MODIFIER:
        return Suits.WILDCARD;
      default:
        return null;
    }
  };

  const modifyCardData = (card: CheckHandCard, modifiers: number[]) => {
    if (!card || card.card_id === undefined || card.card_id < 0) return card;

    const cardId = Number(card.card_id);
    const cardSuitData = CARDS_SUIT_DATA[cardId];

    const suit = cardSuitData?.suit;
    const rank = CARDS_SUIT_DATA[cardId]?.card;

    let modifiedCardData = {
      ...card,
      card: card.value ?? rank,
      suit: card.suit ?? suit,
      type: "",
    };

    modifiers.forEach((modifierIdx) => {
      const modifierCard = hand.find((mc) => mc.idx === modifierIdx);
      if (modifierCard && modifiedCardData.suit != Suits.JOKER) {
        const newSuit = getNewSuit(modifierCard.card_id);
        if (newSuit) {
          modifiedCardData.suit = newSuit;
        }

        if (modifierCard.card_id === ModifiersId.WILDCARD_MODIFIER)
          modifiedCardData.card = Cards.WILDCARD;
      }
    });

    if (specialAllCardsToHearts) {
      if (
        modifiedCardData.suit != Suits.JOKER &&
        modifiedCardData.suit != Suits.WILDCARD
      ) {
        modifiedCardData.suit = Suits.HEARTS;
      }
    }

    return modifiedCardData;
  };

  let jokers = 0;
  const cardsData = preSelectedCards.reduce<any[]>((acc, card_index) => {
    const card = hand.find((c) => c.idx === card_index);
    if (card) {
      const modifiers = preSelectedModifiers[card_index] ?? [];
      const modifiedCardData = modifyCardData(card, modifiers);
      acc.push(modifiedCardData);
    }
    return acc;
  }, []);

  const valuesCount = new Map<number, number>();
  const suitsCount = new Map<Suits, number>();
  const counts: number[] = [];
  const cardsSorted = [...cardsData].sort(
    (a, b) => (a.card || 0) - (b.card || 0)
  );

  for (const card of cardsSorted) {
    if (card.suit != Suits.JOKER && card.suit != Suits.WILDCARD) {
      const valueCount = valuesCount.get(card.card || 0) || 0;
      const suitCount = suitsCount.get(card.suit as Suits) || 0;

      if (valueCount === 0) {
        counts.push(card.card || 0);
      }

      valuesCount.set(card.card || 0, valueCount + 1);
      suitsCount.set(card.suit as Suits, suitCount + 1);
    } else {
      jokers += 1;
    }
  }

  const lenFlush = easyFlush ? 4 : 5;
  const lenStraight = easyStraight ? 4 : 5;

  if (cardsData.length === jokers) {
    switch (jokers) {
      case 5:
        return Plays.ROYAL_FLUSH;
      case 4:
        return Plays.FOUR_OF_A_KIND;
      case 3:
        return Plays.THREE_OF_A_KIND;
      case 2:
        return Plays.PAIR;
      default:
        return Plays.HIGH_CARD;
    }
  }

  const isFlush = [Suits.CLUBS, Suits.DIAMONDS, Suits.HEARTS, Suits.SPADES].some(
    (suit) => {
      return (suitsCount.get(suit) || 0) + jokers >= lenFlush;
    }
  );

  let tempJokers = jokers;
  const isStraight = () => {
    if (cardsSorted.length < lenStraight) return false;
    if (cardsSorted.length === lenStraight && jokers === 4) return true;

    const straightValuesMap = new Map<number, boolean>();
    let consecutive = 1;
    let idx = 0;
    let used_ace = 0;
    let bigGap = false;

    while (idx < cardsSorted.length - 1) {
      const actualValue = cardsSorted[idx].card || 0;
      const nextValue = cardsSorted[idx + 1].card || 0;

      if (nextValue === Cards.JOKER || nextValue === Cards.WILDCARD) {
        consecutive++;
        straightValuesMap.set(actualValue, true);
      } else if (actualValue + 1 === nextValue) {
        used_ace += nextValue === Cards.ACE ? 1 : 0;
        consecutive++;
        straightValuesMap.set(actualValue, true);
        straightValuesMap.set(nextValue, true);
      } else {
        if (actualValue === nextValue) {
          idx++;
          continue;
        }

        const gap = nextValue - actualValue - 1;
        if (gap <= tempJokers) {
          used_ace += nextValue === Cards.ACE ? 1 : 0;
          consecutive++;
          tempJokers -= gap;
          straightValuesMap.set(actualValue, true);
          straightValuesMap.set(nextValue, true);
        } else {
          bigGap = true;
        }
      }
      idx++;
    }

    if ((valuesCount.get(Cards.ACE) ?? 0) - used_ace > 0) {
      let first_value = cardsSorted[0].card || 0;
      let gap = first_value - 1 - 1;

      if (gap <= tempJokers) {
        consecutive++;
        tempJokers -= gap;
        straightValuesMap.set(Cards.ACE, true);
        straightValuesMap.set(first_value, true);
      }
    }

    if (bigGap && used_ace > 0) {
      return false;
    }

    return consecutive >= lenStraight;
  };
  const isPlayStraight = isStraight();

  if (isFlush && isPlayStraight) {
    let royalCards = [Cards.TEN, Cards.JACK, Cards.QUEEN, Cards.KING, Cards.ACE];

    let foundValues = 0;
    for (let idx = 0; idx < cardsSorted.length; idx++) {
      const card = cardsSorted[idx];
      if (card.card != undefined && royalCards.includes(card.card)) {
        foundValues += 1;
      }
    }

    if (foundValues + jokers === 5) return Plays.ROYAL_FLUSH;
    else return Plays.STRAIGHT_FLUSH;
  }

  const isFiveOfAKind = counts.some(
    (cardValue) => (valuesCount.get(cardValue) || 0) + jokers === 5
  );
  if (isFiveOfAKind) {
    return Plays.FIVE_OF_A_KIND;
  }

  const isFourOfAKind = counts.some(
    (cardValue) => (valuesCount.get(cardValue) || 0) + jokers === 4
  );
  if (isFourOfAKind) {
    return Plays.FOUR_OF_A_KIND;
  }

  const isFullHouse = (() => {
    let pairsCount = 0;
    let isThreeOfAKind = false;
    counts.forEach((cardValue) => {
      const count = valuesCount.get(cardValue) || 0;
      if (count === 2) pairsCount += 1;
      if (count === 3) isThreeOfAKind = true;
    });
    return (
      (pairsCount === 1 && isThreeOfAKind) || (pairsCount === 2 && jokers === 1)
    );
  })();

  if (isFullHouse) {
    return Plays.FULL_HOUSE;
  }

  if (isPlayStraight) {
    return Plays.STRAIGHT;
  }

  if (isFlush) {
    return Plays.FLUSH;
  }

  const isThreeOfAKind = counts.some((cardValue) => {
    const countWithJokers = (valuesCount.get(cardValue) || 0) + jokers;
    return countWithJokers === 3;
  });

  if (isThreeOfAKind) {
    return Plays.THREE_OF_A_KIND;
  }

  const isTwoPair = (() => {
    let pairsCount = 0;
    counts.forEach((cardValue) => {
      const count = valuesCount.get(cardValue) || 0;
      if (count === 2) {
        pairsCount += 1;
      }
    });
    return pairsCount === 2;
  })();

  if (isTwoPair) {
    return Plays.TWO_PAIR;
  }

  const isOnePair = counts.some(
    (cardValue) => (valuesCount.get(cardValue) || 0) + jokers == 2
  );
  if (isOnePair) {
    return Plays.PAIR;
  }

  return Plays.HIGH_CARD;
};

// Result interface
export interface HandResult {
  play: Plays;
  isNeon: boolean;
}

/**
 * Check the poker hand result for the given cards
 * @param hand - All cards in hand
 * @param preSelectedCards - Indices of selected cards to play
 * @param specialCards - Special cards that affect the hand evaluation
 * @param preSelectedModifiers - Modifiers applied to each card (key: card idx, value: modifier indices)
 * @returns HandResult with the play type and whether it's a neon play
 */
export const checkHand = (
  hand: CheckHandCard[],
  preSelectedCards: number[],
  specialCards: CheckHandCard[],
  preSelectedModifiers: { [key: number]: number[] }
): HandResult => {
  const play = evaluateHand(
    hand,
    preSelectedCards,
    specialCards,
    preSelectedModifiers
  );

  // Check if all preselected cards are neon
  const selectedCards = preSelectedCards
    .map((cardIdx) => hand.find((c) => c.idx === cardIdx))
    .filter((card): card is CheckHandCard => card !== undefined);

  // A play is neon if all selected cards (excluding jokers/wildcards) are neon cards
  const isNeon =
    selectedCards.length > 0 &&
    selectedCards.every((card) => {
      // Jokers and wildcards don't affect neon status
      if (card.suit === Suits.JOKER || card.suit === Suits.WILDCARD) {
        return true;
      }

      // Check if card has neon modifier applied
      const modifiers = preSelectedModifiers[card.idx] ?? [];
      const hasNeonModifier = modifiers.some((modifierIdx) => {
        const modifierCard = hand.find((c) => c.idx === modifierIdx);
        return modifierCard?.card_id === ModifiersId.NEON_MODIFIER;
      });

      return card.isNeon === true || hasNeonModifier;
    });

  return {
    play,
    isNeon,
  };
};
