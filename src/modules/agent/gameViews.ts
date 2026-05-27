import { RpcProvider } from 'starknet';
import { getSlotGameViewsAddress } from '../../config/manifest.js';
import { getSlotRpcUrl } from '../../config/slotConfig.js';

let cachedCurrentSeasonId: number | null = null;

export const preloadGameViewsData = async (): Promise<void> => {
  const slotProvider = new RpcProvider({ nodeUrl: getSlotRpcUrl() });
  const gameViewsAddress = getSlotGameViewsAddress();

  const seasonResult = await slotProvider.callContract({
    contractAddress: gameViewsAddress,
    entrypoint: 'get_current_season_id',
    calldata: [],
  });

  cachedCurrentSeasonId = Number(BigInt(seasonResult[0]));
  console.info('[CONFIG-LOG] Game views data loaded', { currentSeasonId: cachedCurrentSeasonId });
};

export const getCurrentSeasonIdValue = (): number => {
  if (cachedCurrentSeasonId === null) {
    throw new Error('[gameViews] Data not loaded. Call preloadGameViewsData() first.');
  }
  return cachedCurrentSeasonId;
};
