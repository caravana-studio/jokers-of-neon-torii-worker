const VERSION_URL = 'https://jokersofneon.com/app/settings/version.json';
const FETCH_TIMEOUT_MS = 6000;
const DEFAULT_ENV = 'dev';

interface VersionResponse {
  version: string;
  maintenance?: boolean;
  slot?: Record<string, string>;
}

const configuredEnv = process.env.MANIFEST_SLOT_ENV?.trim().toLowerCase() || DEFAULT_ENV;

let slotInstance: string | undefined = undefined;
let slotRpcUrl: string | undefined = undefined;
let slotToriiUrl: string | undefined = undefined;
let slotRelayUrl: string | undefined = undefined;
let preloadPromise: Promise<void> | null = null;

const getBaseUrl = (slot: string) => `https://api.cartridge.gg/x/${slot}`;

export const preloadSlotConfig = async (): Promise<void> => {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(VERSION_URL, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as VersionResponse;
        const resolvedSlot = data.slot?.[configuredEnv]?.trim();

        if (!resolvedSlot) {
          throw new Error(`Slot instance not found for env "${configuredEnv}" in version.json`);
        }

        slotInstance = resolvedSlot;
        slotRpcUrl = `${getBaseUrl(resolvedSlot)}/katana`;
        slotToriiUrl = `${getBaseUrl(resolvedSlot)}/torii`;
        slotRelayUrl = `/dns4/api.cartridge.gg/tcp/443/x-parity-wss/%2Fx%2F${resolvedSlot}%2Ftorii%2Fwss`;

        console.info(
          `[config] slot env=${configuredEnv} slot=${slotInstance} rpc=${slotRpcUrl} torii=${slotToriiUrl}`
        );
      } catch (error) {
        clearTimeout(timeoutId);
        throw new Error(`[slot-config] Failed to load slot config: ${error}`);
      }
    })();
  }

  await preloadPromise;
};

export const getSlotRpcUrl = (): string => {
  if (!slotRpcUrl) {
    throw new Error('[slot-config] Slot RPC URL not loaded. Call preloadSlotConfig() first.');
  }
  return slotRpcUrl;
};

export const getSlotToriiUrl = (): string => {
  if (!slotToriiUrl) {
    throw new Error('[slot-config] Slot Torii URL not loaded. Call preloadSlotConfig() first.');
  }
  return slotToriiUrl;
};

export const getSlotRelayUrl = (): string => {
  if (!slotRelayUrl) {
    throw new Error('[slot-config] Slot Relay URL not loaded. Call preloadSlotConfig() first.');
  }
  return slotRelayUrl;
};

export const getSlotInstance = (): string => {
  if (!slotInstance) {
    throw new Error('[slot-config] Slot instance not loaded. Call preloadSlotConfig() first.');
  }
  return slotInstance;
};
