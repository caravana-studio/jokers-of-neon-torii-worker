import { env } from '../env.js';
import { LeaderboardEntry, LeaderboardGraphQLResponse } from '../types/leaderboard.js';

/**
 * GraphQL query for fetching leaderboard data
 * TODO: Currently uses startCountingAtGameId for all periods.
 * Future enhancement: implement period-based filtering (daily/weekly)
 * by calculating appropriate ID ranges based on timestamps.
 */
const LEADERBOARD_QUERY = `
  query ($isTournament: Boolean!, $startCountingAtGameId: Int!, $limit: Int!) {
    JokersOfNeonProfile20GameDataModels(
      where: { is_tournament: $isTournament, idGT: $startCountingAtGameId }
      first: $limit
      order: { field: "LEVEL", direction: "DESC" }
    ) {
      edges {
        node {
          player_score
          level
          player_name
          id
          round
          is_tournament
          owner
        }
      }
    }
  }
`;

export class LeaderboardService {
  private graphqlUrl: string;
  private startCountingAtGameId: number;

  constructor() {
    this.graphqlUrl = env.LEADERBOARD_GRAPHQL_URL;
    this.startCountingAtGameId = env.START_COUNTING_AT_GAME_ID;
  }

  /**
   * Fetches leaderboard data from the GraphQL endpoint
   * Adds position field based on order (1-indexed)
   */
  async fetchLeaderboard(limit: number, isTournament: boolean = false): Promise<LeaderboardEntry[]> {
    console.log(`📊 Fetching leaderboard from ${this.graphqlUrl}`);
    console.log(`   Limit: ${limit}, Tournament: ${isTournament}, StartId: ${this.startCountingAtGameId}`);

    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: LEADERBOARD_QUERY,
          variables: {
            isTournament,
            startCountingAtGameId: this.startCountingAtGameId,
            limit,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { data?: LeaderboardGraphQLResponse; errors?: any[] };

      if (result.errors && result.errors.length > 0) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }

      if (!result.data?.JokersOfNeonProfile20GameDataModels?.edges) {
        console.warn('⚠️  No leaderboard data found');
        return [];
      }

      // Map edges to LeaderboardEntry and add position
      const entries: LeaderboardEntry[] = result.data.JokersOfNeonProfile20GameDataModels.edges.map(
        (edge, index) => ({
          ...edge.node,
          position: index + 1, // 1-indexed position
        })
      );

      console.log(`✅ Fetched ${entries.length} leaderboard entries`);

      return entries;
    } catch (error) {
      console.error('❌ Error fetching leaderboard:', error);
      throw error;
    }
  }

  /**
   * Fetches top N players for a specific ranking period
   */
  async fetchTopPlayers(maxPosition: number): Promise<LeaderboardEntry[]> {
    return this.fetchLeaderboard(maxPosition, false);
  }
}

// Singleton instance
let leaderboardServiceInstance: LeaderboardService | null = null;

/**
 * Get or create the singleton leaderboard service instance
 */
export function getLeaderboardService(): LeaderboardService {
  if (!leaderboardServiceInstance) {
    leaderboardServiceInstance = new LeaderboardService();
  }
  return leaderboardServiceInstance;
}
