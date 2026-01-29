import { env } from '../env.js';
import { LeaderboardEntry, LeaderboardGraphQLResponse, GameIdRange, GameIdRangeResponse } from '../types/leaderboard.js';

/**
 * Convert hex string to readable string
 */
function hexToString(hex: string): string {
  if (!hex || !hex.startsWith('0x')) return hex;
  try {
    const hexString = hex.slice(2);
    let result = '';
    for (let i = 0; i < hexString.length; i += 2) {
      result += String.fromCharCode(parseInt(hexString.substr(i, 2), 16));
    }
    return result;
  } catch {
    return hex;
  }
}

/**
 * GraphQL query for fetching leaderboard data within a game ID range
 */
const LEADERBOARD_QUERY = `
  query ($isTournament: Boolean!, $startGameId: Int!, $endGameId: Int!) {
    jokersOfNeonProfile20GameDataModels(
      where: { is_tournament: $isTournament, idGT: $startGameId, idLTE: $endGameId }
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
  private statsApiUrl: string;
  private statsApiKey: string;

  constructor() {
    this.graphqlUrl = env.LEADERBOARD_GRAPHQL_URL;
    this.statsApiUrl = env.GAME_STATS_API_URL;
    this.statsApiKey = env.GAME_STATS_API_KEY;
  }

  /**
   * Fetches the game ID range for a date range from the stats API
   * The day starts at 6am UTC (3am Argentina time)
   */
  async fetchGameIdRange(startDate: string, endDate: string): Promise<GameIdRange | null> {
    if (!this.statsApiUrl || !this.statsApiKey) {
      console.error('❌ Game Stats API not configured (GAME_STATS_API_URL, GAME_STATS_API_KEY)');
      return null;
    }

    const url = `${this.statsApiUrl}/api/stats/game-id-range?start_date=${startDate}&end_date=${endDate}`;
    console.log(`📊 Fetching game ID range from ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.statsApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Stats API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as GameIdRangeResponse;

      if (!result.success || !result.data) {
        console.error('❌ Stats API returned unsuccessful response');
        return null;
      }

      const range: GameIdRange = {
        startGameId: parseInt(result.data.start_game_id),
        endGameId: parseInt(result.data.end_game_id),
      };

      return range;
    } catch (error) {
      console.error('❌ Error fetching game ID range:', error);
      return null;
    }
  }

  /**
   * Fetches leaderboard data from the GraphQL endpoint for a specific game ID range
   * Adds position field based on order (1-indexed)
   */
  async fetchLeaderboard(
    limit: number,
    gameIdRange: GameIdRange,
    isTournament: boolean = false
  ): Promise<LeaderboardEntry[]> {
    console.log(`📊 Fetching leaderboard from ${this.graphqlUrl}`);
    console.log(`   Limit: ${limit}, Tournament: ${isTournament}`);
    console.log(`   Game ID range: ${gameIdRange.startGameId} - ${gameIdRange.endGameId}`);

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
            startGameId: gameIdRange.startGameId,
            endGameId: gameIdRange.endGameId,
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

      if (!result.data?.jokersOfNeonProfile20GameDataModels?.edges) {
        console.warn('⚠️  No leaderboard data found');
        return [];
      }

      // Map edges to LeaderboardEntry and convert player_name from hex
      const rawEntries = result.data.jokersOfNeonProfile20GameDataModels.edges.map(
        (edge) => ({
          ...edge.node,
          player_name: hexToString(edge.node.player_name),
        })
      );

      // Sort by level DESC, round DESC, player_score DESC
      rawEntries.sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        if (b.round !== a.round) return b.round - a.round;
        return b.player_score - a.player_score;
      });

      // Remove duplicates by owner (keep best result per player)
      const seenOwners = new Set<string>();
      const uniqueEntries = rawEntries.filter((entry) => {
        if (seenOwners.has(entry.owner)) return false;
        seenOwners.add(entry.owner);
        return true;
      });

      // Apply limit and add position after sorting
      const entries: LeaderboardEntry[] = uniqueEntries.slice(0, limit).map((entry, index) => ({
        ...entry,
        position: index + 1,
      }));

      console.log(`✅ Fetched ${entries.length} leaderboard entries`);

      return entries;
    } catch (error) {
      console.error('❌ Error fetching leaderboard:', error);
      throw error;
    }
  }

  /**
   * Fetches top N players for a specific date range
   */
  async fetchTopPlayersForDateRange(
    maxPosition: number,
    startDate: string,
    endDate: string
  ): Promise<LeaderboardEntry[]> {
    // Get game ID range for the date range
    const gameIdRange = await this.fetchGameIdRange(startDate, endDate);

    if (!gameIdRange) {
      console.error('❌ Could not fetch game ID range');
      return [];
    }

    return this.fetchLeaderboard(maxPosition, gameIdRange, false);
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
