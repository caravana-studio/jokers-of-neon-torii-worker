import type { BlockchainId } from '../transactionQueueTypes.js';

export interface ChainConfig {
  blockchain: BlockchainId;
  displayName: string;
  slotChainId: number;
  kind: 'starknet' | 'evm';
  evm?: {
    chainId: number;
    name: string;
    nativeSymbol: string;
    blockExplorerUrl: string;
    testnet: boolean;
  };
}

const chainConfigs = {
  starknet: {
    blockchain: 'starknet',
    displayName: 'Starknet',
    slotChainId: 1,
    kind: 'starknet',
  },
  celo: {
    blockchain: 'celo',
    displayName: 'Celo',
    slotChainId: 2,
    kind: 'evm',
    evm: {
      chainId: 42220,
      name: 'Celo',
      nativeSymbol: 'CELO',
      blockExplorerUrl: 'https://celo.blockscout.com',
      testnet: false,
    },
  },
} as const satisfies Record<string, ChainConfig>;

export type ConfiguredBlockchain = keyof typeof chainConfigs;

export function getChainConfig(blockchain: ConfiguredBlockchain): ChainConfig {
  return chainConfigs[blockchain];
}

export function isConfiguredBlockchain(value: unknown): value is ConfiguredBlockchain {
  return typeof value === 'string' && value in chainConfigs;
}

export function getConfiguredBlockchainIds(): ConfiguredBlockchain[] {
  return Object.keys(chainConfigs) as ConfiguredBlockchain[];
}

export function formatConfiguredBlockchains(): string {
  return getConfiguredBlockchainIds().join(', ');
}

export function resolveConfiguredBlockchain(value: unknown): ConfiguredBlockchain | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (isConfiguredBlockchain(normalized)) {
      return normalized;
    }

    const parsedNumber = Number(normalized);
    if (Number.isInteger(parsedNumber)) {
      return resolveConfiguredBlockchain(parsedNumber);
    }
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return getConfiguredBlockchainIds().find(id => chainConfigs[id].slotChainId === value) ?? null;
  }

  return null;
}
