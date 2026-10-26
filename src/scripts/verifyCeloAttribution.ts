import { verifyTx } from '@celo/attribution-tags';
import { createPublicClient, http, type Hex } from 'viem';
import { CELO_ATTRIBUTION_CODE } from '../utils/celoAttribution.js';

const hash = process.argv[2];
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  throw new Error('Usage: CELO_RPC_URL=<rpc> bun run verify:celo-attribution <transaction-hash>');
}
if (!process.env.CELO_RPC_URL) throw new Error('CELO_RPC_URL_REQUIRED');
const client = createPublicClient({ transport: http(process.env.CELO_RPC_URL) });
const chainId = await client.getChainId();
if (chainId !== 42220 && chainId !== 11142220) throw new Error('CELO_NETWORK_REQUIRED');
const [attribution, receipt] = await Promise.all([
  verifyTx({ client, hash: hash as Hex }),
  client.getTransactionReceipt({ hash: hash as Hex }),
]);
if (!attribution?.codes.includes(CELO_ATTRIBUTION_CODE)) {
  throw new Error('CELO_ATTRIBUTION_MISSING_OR_RPC_UNAVAILABLE');
}
if (receipt.status !== 'success') throw new Error('CELO_TRANSACTION_NOT_SUCCESSFUL');
console.info('Celo attribution verified', { chainId, hash, ...attribution });
