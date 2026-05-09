import { env } from '../env.js';
import type { QueuedTransaction, TransactionResult } from '../transactionQueueTypes.js';
import {
  createPublicClient,
  createWalletClient,
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

const celoSepolia = defineChain({
  id: 11142220,
  name: 'Celo Sepolia',
  nativeCurrency: {
    name: 'CELO',
    symbol: 'CELO',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [env.CELO_RPC_URL] },
    public: { http: [env.CELO_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://celo-sepolia.blockscout.com',
    },
  },
  testnet: true,
});

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

export async function executeCeloQueueTransaction(transaction: QueuedTransaction): Promise<TransactionResult> {
  try {
    const missing = getMissingCeloConfig();

    if (missing.length > 0) {
      throw new Error(`Missing Celo write configuration: ${missing.join(', ')}`);
    }

    console.log(`\n📤 Executing Celo transaction...`);
    console.log(`   Contract:   ${transaction.contractAddress}`);
    console.log(`   Entrypoint: ${transaction.entrypoint}`);
    console.log(`   Calldata:   ${JSON.stringify(transaction.calldata)}`);

    const account = getCeloAccount();
    const publicClient = createPublicClient({
      chain: celoSepolia,
      transport: http(env.CELO_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: celoSepolia,
      transport: http(env.CELO_RPC_URL),
    });

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
      default:
        throw new Error(`Unsupported Celo entrypoint: ${transaction.entrypoint}`);
    }

    const hash = await walletClient.sendTransaction({
      account,
      to: contractAddress,
      data,
    });

    console.log(`✅ Transaction sent: ${hash}`);
    console.log('⏳ Waiting for confirmation...');

    await publicClient.waitForTransactionReceipt({ hash });

    console.log(`✅ Transaction confirmed: ${hash}\n`);

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
