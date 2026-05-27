import type {
  GameDataResponse,
  FullGameResponse,
  AvailableNodesResponse,
  ShopItemsResponse,
} from "../types/playback.js";

/**
 * Get the Playback API base URL from environment
 */
import { env } from '../../../env.js';

function getPlaybackApiUrl(): string {
  const url = env.PLAYBACK_API_URL;
  if (!url) {
    throw new Error("PLAYBACK_API_URL environment variable is not set");
  }
  // Remove trailing slash if present
  return url.replace(/\/$/, "");
}

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(endpoint: string): Promise<T> {
  const baseUrl = getPlaybackApiUrl();
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Get basic game data
 * GET /api/game?game_id=<id>
 */
export async function getGame(gameId: number): Promise<GameDataResponse> {
  return fetchApi<GameDataResponse>(`/api/game?game_id=${gameId}`);
}

/**
 * Get full game data including cards, power-ups, trackers, and stats
 * GET /api/full-game?game_id=<id>
 */
export async function getFullGame(gameId: number): Promise<FullGameResponse> {
  return fetchApi<FullGameResponse>(`/api/full-game?game_id=${gameId}`);
}

/**
 * Get available nodes for map navigation
 * GET /api/available-nodes?game_id=<id>
 */
export async function getAvailableNodes(
  gameId: number
): Promise<AvailableNodesResponse> {
  return fetchApi<AvailableNodesResponse>(
    `/api/available-nodes?game_id=${gameId}`
  );
}

/**
 * Get shop items for the current game
 * GET /api/shop-items?game_id=<id>
 */
export async function getShopItems(
  gameId: number
): Promise<ShopItemsResponse> {
  return fetchApi<ShopItemsResponse>(`/api/shop-items?game_id=${gameId}`);
}
