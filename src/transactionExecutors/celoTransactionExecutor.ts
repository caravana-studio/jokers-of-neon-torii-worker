import { env } from '../env.js';
import { getChainConfig } from '../config/chains.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  getAddress,
  hexToString,
  http,
  isAddressEqual,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const celoProfileAbi = [
  {
    type: 'function',
    name: 'setGameData',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'gameData',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint32' },
          { name: 'owner', type: 'address' },
          { name: 'playerScore', type: 'uint32' },
          { name: 'specials', type: 'uint32[]' },
          { name: 'cash', type: 'uint32' },
          { name: 'round', type: 'uint32' },
          { name: 'isTournament', type: 'bool' },
          { name: 'level', type: 'uint32' },
          { name: 'playerName', type: 'string' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setRoundData',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'roundData',
        type: 'tuple',
        components: [
          { name: 'gameId', type: 'uint32' },
          { name: 'roundId', type: 'uint32' },
          { name: 'playerAddress', type: 'address' },
          { name: 'currentScore', type: 'uint32' },
          { name: 'targetScore', type: 'uint32' },
          { name: 'rages', type: 'uint32[]' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'addPlayerStats',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'playerStats',
        type: 'tuple',
        components: [
          { name: 'player', type: 'address' },
          { name: 'gamesPlayed', type: 'uint32' },
          { name: 'gamesWon', type: 'uint32' },
          { name: 'highCardPlayed', type: 'uint32' },
          { name: 'pairPlayed', type: 'uint32' },
          { name: 'twoPairPlayed', type: 'uint32' },
          { name: 'threeOfAKindPlayed', type: 'uint32' },
          { name: 'fourOfAKindPlayed', type: 'uint32' },
          { name: 'fiveOfAKindPlayed', type: 'uint32' },
          { name: 'fullHousePlayed', type: 'uint32' },
          { name: 'flushPlayed', type: 'uint32' },
          { name: 'straightPlayed', type: 'uint32' },
          { name: 'straightFlushPlayed', type: 'uint32' },
          { name: 'royalFlushPlayed', type: 'uint32' },
          { name: 'lootBoxesPurchased', type: 'uint32' },
          { name: 'cardsPurchased', type: 'uint32' },
          { name: 'specialsPurchased', type: 'uint32' },
          { name: 'specialsSold', type: 'uint32' },
          { name: 'powerUpsPurchased', type: 'uint32' },
          { name: 'levelUpsPurchased', type: 'uint32' },
          { name: 'modifiersPurchased', type: 'uint32' },
          { name: 'rerollsPurchased', type: 'uint32' },
          { name: 'burnPurchased', type: 'uint32' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'syncProgression',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'player', type: 'address' },
      { name: 'tier', type: 'uint8' },
      { name: 'totalRuns', type: 'uint32' },
      { name: 'maxLevel', type: 'uint32' },
      { name: 'maxRound', type: 'uint32' },
    ],
    outputs: [],
  },
] as const;

const erc20TransferAbi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const celoConfig = getChainConfig('celo');
const maybeCeloEvmConfig = celoConfig.evm;

if (!maybeCeloEvmConfig) {
  throw new Error('Celo EVM chain configuration is missing');
}

const celoEvmConfig = maybeCeloEvmConfig;

const celoChain = defineChain({
  id: celoEvmConfig.chainId,
  name: celoEvmConfig.name,
  nativeCurrency: {
    name: celoEvmConfig.nativeSymbol,
    symbol: celoEvmConfig.nativeSymbol,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [env.CELO_RPC_URL] },
    public: { http: [env.CELO_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: celoEvmConfig.blockExplorerUrl,
    },
  },
  testnet: celoEvmConfig.testnet,
});

let validatedCeloRpcUrl: string | null = null;

type ParsedGameData = {
  id: number;
  owner: `0x${string}`;
  playerScore: number;
  specials: number[];
  cash: number;
  round: number;
  isTournament: boolean;
  level: number;
  playerName: string;
};

type ParsedRoundData = {
  gameId: number;
  roundId: number;
  playerAddress: `0x${string}`;
  currentScore: number;
  targetScore: number;
  rages: number[];
};

type ParsedProgression = {
  player: `0x${string}`;
  tier: number;
  totalRuns: number;
  maxLevel: number;
  maxRound: number;
};

type ParsedPlayerStats = {
  player: `0x${string}`;
  gamesPlayed: number;
  gamesWon: number;
  highCardPlayed: number;
  pairPlayed: number;
  twoPairPlayed: number;
  threeOfAKindPlayed: number;
  fourOfAKindPlayed: number;
  fiveOfAKindPlayed: number;
  fullHousePlayed: number;
  flushPlayed: number;
  straightPlayed: number;
  straightFlushPlayed: number;
  royalFlushPlayed: number;
  lootBoxesPurchased: number;
  cardsPurchased: number;
  specialsPurchased: number;
  specialsSold: number;
  powerUpsPurchased: number;
  levelUpsPurchased: number;
  modifiersPurchased: number;
  rerollsPurchased: number;
  burnPurchased: number;
};

function getMissingCeloConfig(): string[] {
  const required: Array<keyof typeof env> = ['CELO_RPC_URL', 'CELO_PRIVATE_KEY'];
  return required.filter(key => !env[key]);
}

function normalizePrivateKey(privateKey: string): `0x${string}` {
  return (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

function getCeloAccount() {
  const account = privateKeyToAccount(normalizePrivateKey(env.CELO_PRIVATE_KEY));

  if (env.CELO_ADDRESS && !isAddressEqual(getAddress(env.CELO_ADDRESS), account.address)) {
    throw new Error(`Configured CELO_ADDRESS (${env.CELO_ADDRESS}) does not match the provided private key (${account.address})`);
  }

  return account;
}

async function assertCeloRpcMatchesConfiguredChain(
  publicClient: ReturnType<typeof createPublicClient>
): Promise<void> {
  if (validatedCeloRpcUrl === env.CELO_RPC_URL) {
    return;
  }

  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== celoEvmConfig.chainId) {
    throw new Error(
      `CELO_RPC_URL is connected to chain ${actualChainId}, but this worker expects ${celoEvmConfig.name} (${celoEvmConfig.chainId})`
    );
  }

  validatedCeloRpcUrl = env.CELO_RPC_URL;
}

function toAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${label} to be a hex address string`);
  }

  return getAddress(value);
}

function toUint32(value: unknown, label: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'bigint'
      ? Number(value)
      : Number(String(value));

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new Error(`Invalid uint32 for ${label}: ${String(value)}`);
  }

  return parsed;
}

function toUint8(value: unknown, label: string): number {
  const parsed = toUint32(value, label);

  if (parsed > 0xff) {
    throw new Error(`Invalid uint8 for ${label}: ${String(value)}`);
  }

  return parsed;
}

function toUint256(value: unknown, label: string): bigint {
  let parsed: bigint;

  try {
    parsed = typeof value === 'bigint' ? value : BigInt(String(value));
  } catch {
    throw new Error(`Invalid uint256 for ${label}: ${String(value)}`);
  }

  if (parsed < 0n || parsed > (1n << 256n) - 1n) {
    throw new Error(`Invalid uint256 for ${label}: ${String(value)}`);
  }

  return parsed;
}

function toBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).toLowerCase();
  if (normalized === '1' || normalized === '0x1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === '0x0' || normalized === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean flag for ${label}: ${String(value)}`);
}

function decodePlayerName(value: unknown): string {
  const normalized = typeof value === 'number' || typeof value === 'bigint'
    ? toHex(BigInt(value))
    : String(value);

  if (!normalized.startsWith('0x')) {
    return normalized;
  }

  const evenHex = normalized.length % 2 === 0
    ? normalized
    : `0x0${normalized.slice(2)}`;

  try {
    return hexToString(evenHex as `0x${string}`).replace(/\u0000/g, '');
  } catch {
    return normalized;
  }
}

function parseGameDataCalldata(calldata: unknown[]): ParsedGameData {
  let index = 0;

  const id = toUint32(calldata[index++], 'gameData.id');
  const owner = toAddress(calldata[index++], 'gameData.owner');
  const playerScore = toUint32(calldata[index++], 'gameData.playerScore');
  const specialsLength = toUint32(calldata[index++], 'gameData.specials.length');
  const specials = Array.from({ length: specialsLength }, (_, offset) =>
    toUint32(calldata[index + offset], `gameData.specials[${offset}]`)
  );
  index += specialsLength;

  const cash = toUint32(calldata[index++], 'gameData.cash');
  const round = toUint32(calldata[index++], 'gameData.round');
  const isTournament = toBoolean(calldata[index++], 'gameData.isTournament');
  const level = toUint32(calldata[index++], 'gameData.level');
  const playerName = decodePlayerName(calldata[index++]);

  if (index !== calldata.length) {
    throw new Error(`Invalid setGameData calldata length: expected ${index}, received ${calldata.length}`);
  }

  return {
    id,
    owner,
    playerScore,
    specials,
    cash,
    round,
    isTournament,
    level,
    playerName,
  };
}

function parseRoundDataCalldata(calldata: unknown[]): ParsedRoundData {
  let index = 0;

  const gameId = toUint32(calldata[index++], 'roundData.gameId');
  const roundId = toUint32(calldata[index++], 'roundData.roundId');
  const playerAddress = toAddress(calldata[index++], 'roundData.playerAddress');
  const currentScore = toUint32(calldata[index++], 'roundData.currentScore');
  const targetScore = toUint32(calldata[index++], 'roundData.targetScore');
  const ragesLength = toUint32(calldata[index++], 'roundData.rages.length');
  const rages = Array.from({ length: ragesLength }, (_, offset) =>
    toUint32(calldata[index + offset], `roundData.rages[${offset}]`)
  );
  index += ragesLength;

  if (index !== calldata.length) {
    throw new Error(`Invalid setRoundData calldata length: expected ${index}, received ${calldata.length}`);
  }

  return {
    gameId,
    roundId,
    playerAddress,
    currentScore,
    targetScore,
    rages,
  };
}

function parseProgressionCalldata(calldata: unknown[]): ParsedProgression {
  if (calldata.length !== 5) {
    throw new Error(`Invalid syncProgression calldata length: expected 5, received ${calldata.length}`);
  }

  return {
    player: toAddress(calldata[0], 'progression.player'),
    tier: toUint8(calldata[1], 'progression.tier'),
    totalRuns: toUint32(calldata[2], 'progression.totalRuns'),
    maxLevel: toUint32(calldata[3], 'progression.maxLevel'),
    maxRound: toUint32(calldata[4], 'progression.maxRound'),
  };
}

function parsePlayerStatsCalldata(calldata: unknown[]): ParsedPlayerStats {
  if (calldata.length !== 23) {
    throw new Error(`Invalid addPlayerStats calldata length: expected 23, received ${calldata.length}`);
  }

  return {
    player: toAddress(calldata[0], 'playerStats.player'),
    gamesPlayed: toUint32(calldata[1], 'playerStats.gamesPlayed'),
    gamesWon: toUint32(calldata[2], 'playerStats.gamesWon'),
    highCardPlayed: toUint32(calldata[3], 'playerStats.highCardPlayed'),
    pairPlayed: toUint32(calldata[4], 'playerStats.pairPlayed'),
    twoPairPlayed: toUint32(calldata[5], 'playerStats.twoPairPlayed'),
    threeOfAKindPlayed: toUint32(calldata[6], 'playerStats.threeOfAKindPlayed'),
    fourOfAKindPlayed: toUint32(calldata[7], 'playerStats.fourOfAKindPlayed'),
    fiveOfAKindPlayed: toUint32(calldata[8], 'playerStats.fiveOfAKindPlayed'),
    fullHousePlayed: toUint32(calldata[9], 'playerStats.fullHousePlayed'),
    flushPlayed: toUint32(calldata[10], 'playerStats.flushPlayed'),
    straightPlayed: toUint32(calldata[11], 'playerStats.straightPlayed'),
    straightFlushPlayed: toUint32(calldata[12], 'playerStats.straightFlushPlayed'),
    royalFlushPlayed: toUint32(calldata[13], 'playerStats.royalFlushPlayed'),
    lootBoxesPurchased: toUint32(calldata[14], 'playerStats.lootBoxesPurchased'),
    cardsPurchased: toUint32(calldata[15], 'playerStats.cardsPurchased'),
    specialsPurchased: toUint32(calldata[16], 'playerStats.specialsPurchased'),
    specialsSold: toUint32(calldata[17], 'playerStats.specialsSold'),
    powerUpsPurchased: toUint32(calldata[18], 'playerStats.powerUpsPurchased'),
    levelUpsPurchased: toUint32(calldata[19], 'playerStats.levelUpsPurchased'),
    modifiersPurchased: toUint32(calldata[20], 'playerStats.modifiersPurchased'),
    rerollsPurchased: toUint32(calldata[21], 'playerStats.rerollsPurchased'),
    burnPurchased: toUint32(calldata[22], 'playerStats.burnPurchased'),
  };
}

function compactValue(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export async function executeCeloQueueTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  try {
    const missing = getMissingCeloConfig();

    if (missing.length > 0) {
      throw new Error(`Missing Celo write configuration: ${missing.join(', ')}`);
    }

    console.log(
      `[executor] send chain=celo op=${transaction.entrypoint} contract=${compactValue(transaction.contractAddress)}`
    );

    const account = getCeloAccount();
    const publicClient = createPublicClient({
      chain: celoChain,
      transport: http(env.CELO_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: celoChain,
      transport: http(env.CELO_RPC_URL),
    });

    await assertCeloRpcMatchesConfiguredChain(publicClient);

    const contractAddress = toAddress(transaction.contractAddress, 'transaction.contractAddress');
    let data: `0x${string}`;

    switch (transaction.entrypoint) {
      case 'setGameData': {
        const gameData = parseGameDataCalldata(transaction.calldata);
        data = encodeFunctionData({
          abi: celoProfileAbi,
          functionName: 'setGameData',
          args: [gameData],
        });
        break;
      }
      case 'setRoundData': {
        const roundData = parseRoundDataCalldata(transaction.calldata);
        data = encodeFunctionData({
          abi: celoProfileAbi,
          functionName: 'setRoundData',
          args: [roundData],
        });
        break;
      }
      case 'syncProgression': {
        const progression = parseProgressionCalldata(transaction.calldata);
        data = encodeFunctionData({
          abi: celoProfileAbi,
          functionName: 'syncProgression',
          args: [
            progression.player,
            progression.tier,
            progression.totalRuns,
            progression.maxLevel,
            progression.maxRound,
          ],
        });
        break;
      }
      case 'addPlayerStats': {
        const playerStats = parsePlayerStatsCalldata(transaction.calldata);
        data = encodeFunctionData({
          abi: celoProfileAbi,
          functionName: 'addPlayerStats',
          args: [playerStats],
        });
        break;
      }
      case 'transfer': {
        if (transaction.calldata.length !== 2) {
          throw new Error(`Invalid ERC-20 transfer calldata length: expected 2, received ${transaction.calldata.length}`);
        }
        data = encodeFunctionData({
          abi: erc20TransferAbi,
          functionName: 'transfer',
          args: [
            toAddress(transaction.calldata[0], 'transfer.recipient'),
            toUint256(transaction.calldata[1], 'transfer.amount'),
          ],
        });
        break;
      }
      default:
        throw new Error(`Unsupported Celo entrypoint: ${transaction.entrypoint}`);
    }

    if (transaction.entrypoint === 'transfer') {
      const simulation = await publicClient.call({
        account: account.address,
        to: contractAddress,
        data,
      });
      if (!simulation.data) {
        throw new Error('ERC-20 transfer simulation returned no data');
      }

      const accepted = decodeFunctionResult({
        abi: erc20TransferAbi,
        functionName: 'transfer',
        data: simulation.data,
      });
      if (!accepted) {
        throw new Error('ERC-20 transfer simulation returned false');
      }
    }

    const hash = await walletClient.sendTransaction({
      account,
      to: contractAddress,
      data,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`Celo transaction reverted: ${hash}`);
    }

    console.log(`[executor] confirmed chain=celo hash=${compactValue(hash)}`);

    return {
      success: true,
      transactionHash: hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
