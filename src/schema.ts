// Re-export los schemas generados
export * from '../typescript/models.gen.js';
export * from '../typescript/contracts.gen.js';

// Namespace del proyecto
export const NAMESPACE = 'jokers_of_neon';

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
