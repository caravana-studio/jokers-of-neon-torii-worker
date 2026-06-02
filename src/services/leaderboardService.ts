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

function compactUrl(url: string): string {
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}

/**
 * GraphQL query for fetching leaderboard data within a game ID range
 * Uses pagination with cursor to fetch all results
 */
const LEADERBOARD_QUERY = `
  query ($isTournament: Boolean!, $startGameId: Int!, $endGameId: Int!, $after: String) {
    jokersOfNeonProfile20GameDataModels(
      where: { is_tournament: $isTournament, idGT: $startGameId, idLTE: $endGameId }
      first: 100
      order: { field: "LEVEL", direction: "DESC" }
      after: $after
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
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
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
    console.log(`[leaderboard] fetch_range start=${startDate} end=${endDate} url=${compactUrl(url)}`);

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
    const expectedMaxGames = gameIdRange.endGameId - gameIdRange.startGameId;
    const maxEntries = expectedMaxGames * 2; // Safety cap: 2x expected games
    console.log(
      `[leaderboard] fetch limit=${limit} tournament=${isTournament} range=${gameIdRange.startGameId}-${gameIdRange.endGameId} expectedMax=${expectedMaxGames} url=${compactUrl(this.graphqlUrl)}`
    );

    try {
      // Paginate through results
      const allRawEntries: Array<Omit<LeaderboardEntry, 'position'>> = [];
      let afterCursor: string | null = null;
      let page = 0;

      while (true) {
        page++;

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
              after: afterCursor,
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

        const models = result.data?.jokersOfNeonProfile20GameDataModels;
        if (!models?.edges || models.edges.length === 0) {
          if (page === 1) {
            console.warn('⚠️  No leaderboard data found');
          }
          break;
        }

        const pageEntries = models.edges.map((edge) => ({
          ...edge.node,
          player_name: hexToString(edge.node.player_name),
        }));
        allRawEntries.push(...pageEntries);

        console.log(`[leaderboard] page=${page} fetched=${pageEntries.length} total=${allRawEntries.length}`);

        // Safety cap to prevent runaway pagination
        if (allRawEntries.length >= maxEntries) {
          console.warn(`⚠️  Reached safety cap (${maxEntries} entries). Expected ~${expectedMaxGames} games. Stopping pagination.`);
          break;
        }

        // Check if there are more pages
        if (!models.pageInfo?.hasNextPage) {
          break;
        }
        afterCursor = models.pageInfo.endCursor;
      }

      if (allRawEntries.length === 0) {
        return [];
      }

      // Sort by level DESC, round DESC, player_score DESC
      allRawEntries.sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        if (b.round !== a.round) return b.round - a.round;
        return b.player_score - a.player_score;
      });

      // Remove duplicates by owner (keep best result per player)
      const seenOwners = new Set<string>();
      const uniqueEntries = allRawEntries.filter((entry) => {
        if (seenOwners.has(entry.owner)) return false;
        seenOwners.add(entry.owner);
        return true;
      });

      // Apply limit and add position after sorting
      const entries: LeaderboardEntry[] = uniqueEntries.slice(0, limit).map((entry, index) => ({
        ...entry,
        position: index + 1,
      }));

      console.log(`[leaderboard] done entries=${entries.length} raw=${allRawEntries.length}`);

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
