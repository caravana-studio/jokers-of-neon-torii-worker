const MANIFEST_API_BASE_URL = 'https://jokersofneon.com/manifest';

interface ManifestContract {
  address: string;
  tag: string;
  systems: string[];
}

interface ManifestWorld {
  address: string;
  name: string;
  seed: string;
  class_hash: string;
}

interface Manifest {
  world: ManifestWorld;
  contracts: ManifestContract[];
}

const configuredEnv = process.env.MANIFEST_SLOT_ENV?.trim().toLowerCase() || 'dev';

let resolvedSlotManifest: Manifest | null = null;
let preloadSlotManifestPromise: Promise<void> | null = null;

export const preloadSlotManifest = async (): Promise<void> => {
  if (!preloadSlotManifestPromise) {
    preloadSlotManifestPromise = (async () => {
      const manifestUrl = `${MANIFEST_API_BASE_URL}/manifest_${configuredEnv}.json`;

      const response = await fetch(manifestUrl);

      if (!response.ok) {
        throw new Error(`[manifest] Failed to fetch "${manifestUrl}": HTTP ${response.status}`);
      }

      resolvedSlotManifest = (await response.json()) as Manifest;
      console.info('[CONFIG-LOG] Slot manifest loaded', {
        env: configuredEnv,
        url: manifestUrl,
        worldAddress: resolvedSlotManifest.world.address,
      });
    })();
  }

  await preloadSlotManifestPromise;
};

const getSlotManifest = (): Manifest => {
  if (!resolvedSlotManifest) {
    throw new Error('[manifest] Slot manifest not loaded. Call preloadSlotManifest() first.');
  }
  return resolvedSlotManifest;
};

function getContractAddress(manifest: Manifest, systemTag: string): string {
  const contract = manifest.contracts.find(c => c.tag.includes(systemTag));
  if (!contract) {
    throw new Error(`Contract with tag "${systemTag}" not found in manifest`);
  }
  return contract.address;
}

export function getWorldAddress(): string {
  return getSlotManifest().world.address;
}

export function getSlotGameViewsAddress(): string {
  return getContractAddress(getSlotManifest(), 'game_views');
}

export function getSlotDailyMissionsSystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'daily_missions_system');
}

export function getSlotGameSystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'game_system');
}

export function getSlotPlaySystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'play_system');
}

export function getSlotShopSystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'shop_system');
}

export function getSlotActionSystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'action_system');
}

export function getSlotMapSystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'map_system');
}

export function getSlotLivesSystemAddress(): string {
  return getContractAddress(getSlotManifest(), 'lives_system');
}
