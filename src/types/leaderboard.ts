export interface LeaderboardEntry {
  id: number;
  player_name: string;
  player_score: number;
  level: number;
  round: number;
  owner: string; // player address
  is_tournament: boolean;
  position?: number; // Added after fetching based on order
}

export type PeriodType = 'daily' | 'weekly';

export interface LeaderboardGraphQLResponse {
  JokersOfNeonProfile20GameDataModels: {
    edges: Array<{
      node: {
        id: number;
        player_name: string;
        player_score: number;
        level: number;
        round: number;
        owner: string;
        is_tournament: boolean;
      };
    }>;
  };
}
