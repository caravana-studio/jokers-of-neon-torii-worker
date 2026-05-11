// Namespace del proyecto
export const NAMESPACE = 'jokers_of_neon';

export type BigNumberish = string | number | bigint;

export interface GameSpecials {
  game_id: BigNumberish;
  specials: BigNumberish[][];
}

export interface Game {
  id: BigNumberish;
  mod_id: BigNumberish;
  state: unknown;
  owner: string;
  player_name: BigNumberish;
  player_score: BigNumberish;
  level: BigNumberish;
  current_node_id: BigNumberish;
  round: BigNumberish;
  hand_len: BigNumberish;
  plays: BigNumberish;
  discards: BigNumberish;
  current_specials_len: BigNumberish;
  special_slots: BigNumberish;
  cash: BigNumberish;
  available_rerolls: BigNumberish;
  seed: BigNumberish;
  is_tournament: boolean;
}

export interface Round {
  game_id: BigNumberish;
  current_score: BigNumberish;
  target_score: BigNumberish;
  remaining_plays: BigNumberish;
  remaining_discards: BigNumberish;
  rages: BigNumberish[];
}

// PlayerStats struct definition
export interface PlayerStats {
  address: string;
  games_played: string | number;
  games_won: string | number;
  high_card_played: string | number;
  pair_played: string | number;
  two_pair_played: string | number;
  three_of_a_kind_played: string | number;
  four_of_a_kind_played: string | number;
  five_of_a_kind_played: string | number;
  full_house_played: string | number;
  flush_played: string | number;
  straight_played: string | number;
  straight_flush_played: string | number;
  royal_flush_played: string | number;
  loot_boxes_purchased: string | number;
  cards_purchased: string | number;
  specials_purchased: string | number;
  specials_sold: string | number;
  power_ups_purchased: string | number;
  level_ups_purchased: string | number;
  modifiers_purchased: string | number;
  rerolls_purchased: string | number;
  burn_purchased: string | number;
}
