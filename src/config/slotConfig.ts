const VERSION_URL = 'https://jokersofneon.com/app/settings/version.json';
const FETCH_TIMEOUT_MS = 6000;
const DEFAULT_ENV = 'dev';
const DEFAULT_CARTRIDGE_SLOT_CHAIN_ID = 'SN_SEPOLIA';

interface VersionResponse {
  version: string;
  maintenance?: boolean;
  slot?: Record<string, string>;
  slotEndpoints?: Record<string, SlotEndpointConfig>;
}

interface SlotEndpointConfig {
  kind?: string;
  slotInstance?: string;
  rpcUrl?: string;
  toriiUrl?: string;
  relayUrl?: string;
  chainId?: string;
}

const configuredEnv = process.env.MANIFEST_SLOT_ENV?.trim().toLowerCase() || DEFAULT_ENV;

let slotInstance: string | undefined = undefined;
let slotRpcUrl: string | undefined = undefined;
let slotToriiUrl: string | undefined = undefined;
let slotRelayUrl: string | undefined = undefined;
let slotChainId: string | undefined = undefined;
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
        const endpointConfig = data.slotEndpoints?.[configuredEnv];
        const resolvedSlot = data.slot?.[configuredEnv]?.trim();

        if (endpointConfig) {
          const endpointRpcUrl = endpointConfig.rpcUrl?.trim();
          const endpointToriiUrl = endpointConfig.toriiUrl?.trim();
          const endpointRelayUrl = endpointConfig.relayUrl?.trim();
          const endpointChainId = endpointConfig.chainId?.trim();

          if (!endpointRpcUrl || !endpointToriiUrl || !endpointRelayUrl) {
            throw new Error(
              `Slot endpoint for env "${configuredEnv}" must include rpcUrl, toriiUrl and relayUrl in version.json`
            );
          }

          if (!endpointChainId) {
            throw new Error(
              `Slot endpoint for env "${configuredEnv}" must include chainId in version.json`
            );
          }

          slotInstance = endpointConfig.slotInstance?.trim() || configuredEnv;
          slotRpcUrl = endpointRpcUrl;
          slotToriiUrl = endpointToriiUrl;
          slotRelayUrl = endpointRelayUrl;
          slotChainId = endpointChainId;

          console.info(
            `[config] slot endpoint env=${configuredEnv} slot=${slotInstance} chainId=${slotChainId} rpc=${slotRpcUrl} torii=${slotToriiUrl} relay=${slotRelayUrl}`
          );
          return;
        }

        if (!resolvedSlot) {
          throw new Error(`Slot instance not found for env "${configuredEnv}" in version.json`);
        }

        slotInstance = resolvedSlot;
        slotRpcUrl = `${getBaseUrl(resolvedSlot)}/katana`;
        slotToriiUrl = `${getBaseUrl(resolvedSlot)}/torii`;
        slotRelayUrl = `/dns4/api.cartridge.gg/tcp/443/x-parity-wss/%2Fx%2F${resolvedSlot}%2Ftorii%2Fwss`;
        slotChainId = DEFAULT_CARTRIDGE_SLOT_CHAIN_ID;

        console.info(
          `[config] slot env=${configuredEnv} slot=${slotInstance} chainId=${slotChainId} rpc=${slotRpcUrl} torii=${slotToriiUrl}`
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

export const getSlotChainId = (): string => {
  if (!slotChainId) {
    throw new Error('[slot-config] Slot chain ID not loaded. Call preloadSlotConfig() first.');
  }
  return slotChainId;
};

export const getSlotInstance = (): string => {
  if (!slotInstance) {
    throw new Error('[slot-config] Slot instance not loaded. Call preloadSlotConfig() first.');
  }
  return slotInstance;
};
