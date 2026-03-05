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
  jokersOfNeonProfile20GameDataModels: {
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
      cursor: string;
    }>;
    pageInfo?: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

export interface GameIdRangeResponse {
  success: boolean;
  data: {
    start_game_id: string;
    end_game_id: string;
    date_range: {
      start: string;
      end: string;
    };
  };
}

export interface GameIdRange {
  startGameId: number;
  endGameId: number;
}
