import { expect, it } from 'bun:test';
import { fromDataSuffix } from '@celo/attribution-tags';
import { keccak256, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from '../src/env.js';
import { executeCeloQueueTransaction } from '../src/transactionExecutors/celoTransactionExecutor.js';
import type { QueuedTransaction } from '../src/transactionQueueTypes.js';

it('sends attributed Profile and ERC-20 queue transactions through the Celo executor', async () => {
  // Local JSON-RPC fixture exercises the real viem preparation/sign/send path.
  const key = ('0x' + '01'.repeat(32)) as Hex;
  const account = privateKeyToAccount(key);
  const blockHash = ('0x' + 'ab'.repeat(32)) as Hex;
  const inputs: Hex[] = [];
  const simulations: Hex[] = [];
  const estimates: Hex[] = [];
  const unexpected: string[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const rpc = await request.json() as { id: number; method: string; params: any[] };
    let result: unknown;
    switch (rpc.method) {
      // Optional viem optimization; exercise its normal prepare/sign fallback.
      case 'eth_fillTransaction': return Response.json({ jsonrpc: '2.0', id: rpc.id,
        error: { code: -32601, message: 'Unsupported fixture RPC method' } });
      case 'eth_chainId': result = '0xa4ec'; break;
      case 'eth_getTransactionCount': result = '0x0'; break;
      case 'eth_blockNumber': result = '0x1'; break;
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas': result = '0x1'; break;
      case 'eth_getBlockByNumber': result = {
        number: '0x1', hash: blockHash, parentHash: blockHash, timestamp: '0x1',
        baseFeePerGas: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [],
      }; break;
      case 'eth_estimateGas': estimates.push(rpc.params[0].data); result = '0x493e0'; break;
      case 'eth_call': simulations.push(rpc.params[0].data); result = '0x' + '0'.repeat(63) + '1'; break;
      case 'eth_sendRawTransaction': {
        const raw = rpc.params[0] as Hex;
        inputs.push(parseTransaction(raw).data!);
        result = keccak256(raw);
        break;
      }
      case 'eth_getTransactionReceipt': result = {
        transactionHash: rpc.params[0], transactionIndex: '0x0', blockHash, blockNumber: '0x1',
        from: account.address, to: account.address, cumulativeGasUsed: '0x5208', gasUsed: '0x5208',
        effectiveGasPrice: '0x1', contractAddress: null, logs: [],
        logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2',
      }; break;
      default: unexpected.push(rpc.method); return Response.json({ jsonrpc: '2.0', id: rpc.id,
        error: { code: -32601, message: 'Unsupported fixture RPC method' } });
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  } });
  const previous = { CELO_RPC_URL: env.CELO_RPC_URL, CELO_PRIVATE_KEY: env.CELO_PRIVATE_KEY,
    CELO_ADDRESS: env.CELO_ADDRESS, CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS: env.CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS };
  Object.assign(env, { CELO_RPC_URL: server.url.toString(), CELO_PRIVATE_KEY: key,
    CELO_ADDRESS: account.address, CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS: account.address });
  try {
    for (const [entrypoint, calldata] of [
      ['syncProgression', [account.address, 1, 2, 3, 4]],
      ['transfer', [account.address, 25n]],
    ] as const) {
      const result = await executeCeloQueueTransaction({ id: 'fixture', blockchain: 'celo',
        contractAddress: account.address, entrypoint, calldata: [...calldata], retries: 0,
        maxRetries: 3, status: 'pending' } as QueuedTransaction);
      expect(result.success).toBe(true);
    }
    expect(unexpected).toEqual([]);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(fromDataSuffix(input)).toEqual({ codes: ['celo_zni2b7n2'], schemaId: 0 });
      expect(estimates).toContain(input);
    }
    expect(simulations).toEqual([inputs[1]]);
  } finally {
    Object.assign(env, previous);
    server.stop(true);
  }
});
