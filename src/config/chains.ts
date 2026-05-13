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

const devChainConfigs = {
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
      chainId: 11142220,
      name: 'Celo Sepolia',
      nativeSymbol: 'CELO',
      blockExplorerUrl: 'https://celo-sepolia.blockscout.com',
      testnet: true,
    },
  },
} as const satisfies Record<string, ChainConfig>;

const prodChainConfigs = {
  ...devChainConfigs,
  celo: {
    ...devChainConfigs.celo,
    evm: {
      chainId: 42220,
      name: 'Celo',
      nativeSymbol: 'CELO',
      blockExplorerUrl: 'https://celo.blockscout.com',
      testnet: false,
    },
  },
} as const satisfies Record<string, ChainConfig>;

const chainConfigsBySlotEnv = {
  dev: devChainConfigs,
  local: devChainConfigs,
  test: devChainConfigs,
  staging: devChainConfigs,
  mainnet: prodChainConfigs,
  prod: prodChainConfigs,
  prods2: prodChainConfigs,
  production: prodChainConfigs,
} as const;

export type ConfiguredBlockchain = keyof typeof devChainConfigs;

function getConfiguredSlotEnv(): string {
  return process.env.MANIFEST_SLOT_ENV?.trim().toLowerCase() || 'dev';
}

function getChainConfigs(): Record<ConfiguredBlockchain, ChainConfig> {
  const env = getConfiguredSlotEnv();
  return (chainConfigsBySlotEnv[env as keyof typeof chainConfigsBySlotEnv] ?? devChainConfigs) as Record<ConfiguredBlockchain, ChainConfig>;
}

export function getChainConfig(blockchain: ConfiguredBlockchain): ChainConfig {
  return getChainConfigs()[blockchain];
}

export function isConfiguredBlockchain(value: unknown): value is ConfiguredBlockchain {
  return typeof value === 'string' && value in getChainConfigs();
}

export function getConfiguredBlockchainIds(): ConfiguredBlockchain[] {
  return Object.keys(getChainConfigs()) as ConfiguredBlockchain[];
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
    const chainConfigs = getChainConfigs();
    return getConfiguredBlockchainIds().find(id => chainConfigs[id].slotChainId === value) ?? null;
  }

  return null;
}
