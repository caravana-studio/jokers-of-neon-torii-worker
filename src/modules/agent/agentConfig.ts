import { Account, RpcProvider } from 'starknet';
import { env } from '../../env.js';
import { getSlotRpcUrl } from '../../config/slotConfig.js';
import {
  getSlotGameSystemAddress,
  getSlotPlaySystemAddress,
  getSlotShopSystemAddress,
  getSlotActionSystemAddress,
  getSlotMapSystemAddress,
  getSlotLivesSystemAddress,
} from '../../config/manifest.js';

export interface BurnerAccount {
  address: string;
  privateKey: string;
}

export function getProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: getSlotRpcUrl() });
}

export function getBurnerAccounts(): BurnerAccount[] {
  if (!env.BURNER_ACCOUNTS) {
    return [];
  }
  try {
    return JSON.parse(env.BURNER_ACCOUNTS) as BurnerAccount[];
  } catch (error) {
    console.error('[agent] Invalid BURNER_ACCOUNTS JSON:', error);
    return [];
  }
}

export function createAccountFromBurner(burner: BurnerAccount, provider?: RpcProvider): Account {
  const rpcProvider = provider ?? getProvider();
  return new Account({
    provider: rpcProvider,
    address: burner.address,
    signer: burner.privateKey,
  });
}

export const contractAddresses = {
  get gameSystem(): string {
    return getSlotGameSystemAddress();
  },
  get playSystem(): string {
    return getSlotPlaySystemAddress();
  },
  get shopSystem(): string {
    return getSlotShopSystemAddress();
  },
  get actionSystem(): string {
    return getSlotActionSystemAddress();
  },
  get mapSystem(): string {
    return getSlotMapSystemAddress();
  },
  get livesSystem(): string {
    return getSlotLivesSystemAddress();
  },
};

/** @deprecated Pass burner Account from GameAgentModule */
export function getAccount(_provider?: RpcProvider): Account {
  throw new Error('[agent] getAccount() unavailable — pass burner Account explicitly');
}
