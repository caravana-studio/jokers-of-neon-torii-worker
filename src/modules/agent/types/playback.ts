// GameState enum values
export enum GameState {
  None = 0,
  Round = 1,
  Rage = 2,
  Reward = 3,
  Challenge = 4,
  Map = 5,
  Store = 6,
  Lootbox = 7,
  GameOver = 8,
}

// Suit enum
export enum Suit {
  None = 0,
  Clubs = 1,
  Diamonds = 2,
  Hearts = 3,
  Spades = 4,
  Joker = 5,
  Wild = 6,
}

// Value enum
export enum Value {
  None = 0,
  Two = 1,
  Three = 2,
  Four = 3,
  Five = 4,
  Six = 5,
  Seven = 6,
  Eight = 7,
  Nine = 8,
  Ten = 9,
  Jack = 10,
  Queen = 11,
  King = 12,
  Ace = 13,
  Joker = 14,
  NeonJoker = 15,
  Wild = 16,
}

// PokerHand enum
export enum PokerHand {
  None = 0,
  RoyalFlush = 1,
  StraightFlush = 2,
  FiveOfAKind = 3,
  FourOfAKind = 4,
  FullHouse = 5,
  Straight = 6,
  Flush = 7,
  ThreeOfAKind = 8,
  TwoPair = 9,
  OnePair = 10,
  HighCard = 11,
}

// NodeType enum
export enum NodeType {
  None = 0,
  Round = 1,
  Rage = 2,
  Reward = 3,
  Store = 4,
}

// CardItemType enum
export enum CardItemType {
  None = 0,
  Common = 1,
  Modifier = 2,
}

// Card interface
export interface Card {
  id: number;
  suit: Suit;
  suit_name: string;
  value: Value;
  value_name: string;
  points: number;
  multi: number;
  is_neon: boolean;
  idx: number; // Position in hand for contract calls
}

// Game interface
export interface Game {
  id: number;
  mod_id: string;
  state: GameState;
  state_name: string;
  owner: string;
  player_name: string;
  player_score: number;
  level: number;
  current_node_id: number;
  round: number;
  hand_len: number;
  plays: number;
  discards: number;
  current_specials_len: number;
  special_slots: number;
  cash: number;
  available_rerolls: number;
  seed: string;
  is_tournament: boolean;
}

// Round interface
export interface Round {
  game_id: number;
  current_score: number;
  target_score: number;
  remaining_plays: number;
  remaining_discards: number;
  rages: number[];
}

// CurrentSpecialCard interface
export interface CurrentSpecialCard {
  game_id: number;
  idx: number;
  effect_card_id: number;
  is_temporary: boolean;
  remaining: number;
  selling_price: number;
}

// GameTracker interface
export interface GameTracker {
  game_id: number;
  highest_hand: number;
  most_played_hand: PokerHand;
  most_played_hand_name: string;
  most_played_hand_count: number;
  highest_cash: number;
  cards_played_count: number;
  cards_discarded_count: number;
  rage_wins: number;
}

// PlayerStats interface
export interface PlayerStats {
  address: string;
  games_played: number;
  games_won: number;
  high_card_played: number;
  pair_played: number;
  two_pair_played: number;
  three_of_a_kind_played: number;
  four_of_a_kind_played: number;
  five_of_a_kind_played: number;
  full_house_played: number;
  flush_played: number;
  straight_played: number;
  straight_flush_played: number;
  royal_flush_played: number;
  loot_boxes_purchased: number;
  cards_purchased: number;
  specials_purchased: number;
  specials_sold: number;
  power_ups_purchased: number;
  level_ups_purchased: number;
  modifiers_purchased: number;
  rerolls_purchased: number;
  burn_purchased: number;
}

// PlayerLevelPokerHand interface
export interface PlayerLevelPokerHand {
  game_id: number;
  poker_hand: PokerHand;
  poker_hand_name: string;
  level: number;
  multi: number;
  points: number;
}

// PokerHandTracker interface
export interface PokerHandTracker {
  game_id: number;
  royal_flush: number;
  straight_flush: number;
  five_of_a_kind: number;
  four_of_a_kind: number;
  full_house: number;
  straight: number;
  flush: number;
  three_of_a_kind: number;
  two_pair: number;
  one_pair: number;
  high_card: number;
}

// Node interface
export interface Node {
  game_id: number;
  id: number;
  node_type: NodeType;
  node_type_name: string;
  data: string;
  parsed_data?: RageNodeData;
  store_name?: string;
}

export interface RageNodeData {
  power: number;
  round: number;
}

// Shop item interfaces
export interface CardItem {
  game_id: number;
  idx: number;
  item_type: CardItemType;
  item_type_name: string;
  card_id: number;
  cost: number;
  discount_cost: number;
  purchased: boolean;
}

export interface SpecialCardItem {
  game_id: number;
  idx: number;
  card_id: number;
  cost: number;
  discount_cost: number;
  temporary_cost: number;
  temporary_discount_cost: number;
  purchased: boolean;
}

export interface PokerHandItem {
  game_id: number;
  idx: number;
  poker_hand: PokerHand;
  poker_hand_name: string;
  level: number;
  multi: number;
  points: number;
  cost: number;
  discount_cost: number;
  purchased: boolean;
}

export interface BlisterPackItem {
  game_id: number;
  idx: number;
  blister_pack_id: number;
  cost: number;
  discount_cost: number;
  purchased: boolean;
}

export interface PowerUpItem {
  game_id: number;
  idx: number;
  power_up_id: number;
  cost: number;
  discount_cost: number;
  purchased: boolean;
}

export interface SlotSpecialCardsItem {
  game_id: number;
  cost: number;
  discount_cost: number;
}

export interface BurnItem {
  game_id: number;
  cost: number;
  discount_cost: number;
  purchased: boolean;
}

// API Response interfaces

// GET /api/game response
export interface GameDataResponse {
  game: Game;
  round: Round;
}

// GET /api/full-game response
export interface FullGameResponse {
  game: Game;
  round: Round;
  special_cards: CurrentSpecialCard[];
  hand_cards: Card[];
  deck: {
    in_deck: Card[];
    out_of_deck: Card[];
  };
  power_ups: number[];
  game_tracker: GameTracker;
  player_stats: PlayerStats;
  player_poker_hands: PlayerLevelPokerHand[];
  poker_hands_tracker: PokerHandTracker;
}

// GET /api/available-nodes response
export interface AvailableNodesResponse {
  game_id: number;
  current_node_id: number;
  available_nodes: Node[];
}

// GET /api/shop-items response
export interface ShopItemsResponse {
  game_id: number;
  card_items: CardItem[];
  special_card_items: SpecialCardItem[];
  poker_hand_items: PokerHandItem[];
  blister_pack_items: BlisterPackItem[];
  power_up_items: PowerUpItem[];
  slot_special_cards_item: SlotSpecialCardsItem;
  burn_item: BurnItem;
  rerolls: number;
}
