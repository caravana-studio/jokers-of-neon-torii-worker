import { test, expect } from 'bun:test';
import { EvmNftAdapter } from '../../src/v2/settlement/evm.js';
import { NftSettlementWorker } from '../../src/v2/settlement/worker.js';
import { ProfileMirror } from '../../src/v2/settlement/profileMirror.js';
import { EvmTransferAdapter } from '../../src/v2/commerce/evm.js';
import type { Executor } from '../../src/v2/settlement/types.js';
import type { ProviderSnapshot } from '../../src/v2/commerce/providers.js';
import { keccak256, TransactionReceiptNotFoundError } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { profileCalldata } from '../../src/v2/settlement/profileProtocol.js';
import { tagCeloCalldata } from '../../src/utils/celoAttribution.js';

const key = ('0x' + '0'.repeat(63) + '1') as `0x${string}`;
const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const contract = ('0x' + '1'.repeat(40)) as `0x${string}`;
const hash = '0x' + 'a'.repeat(64);

test('real NFT/Profile idle polling makes no RPC calls after startup and still reads the pause switch', async () => {
  const calls: string[] = [];
  let owner = address, targetReads = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const { id, method, params } = await request.json() as any;
    calls.push(method);
    const result = method === 'eth_chainId' ? '0xa4ec'
      : method === 'eth_call' && params[0].data === '0x8da5cb5b' ? '0x' + owner.slice(2).padStart(64, '0') : null;
    return Response.json({ jsonrpc: '2.0', id, result });
  }});
  try {
    const url = `http://127.0.0.1:${server.port}`;
    const executor: Executor = { executor_id: 'executor', chain_key: 'production:celo', address, signer_ref: 'TEST', status: 'ready',
      adapter_key: 'evm', network_id: '42220', confirmation_policy: { confirmations: 2, finality: 'finalized' }, chain_status: 'enabled' };
    const db = { async rpc(name: string) {
      let data: unknown;
      switch (name) {
        case 'nft_executor': data = executor; break;
        case 'profile_mirror_target': targetReads++; data = { contract_address: contract, chain_key: executor.chain_key, enabled: true }; break;
        case 'claim_processing_job': data = { job_id: 'job', lease_token: 'lease' }; break;
        case 'pending_nft_submissions': case 'pending_profile_submissions': case 'profile_mirror_work': case 'pending_nft_finality': data = []; break;
        case 'next_nft_operation': case 'next_profile_operation': case 'finish_processing_job': case 'assert_processing_contract': data = null; break;
        default: throw Error('Unexpected DB RPC: ' + name);
      }
      return { data, error: null };
    }};
    const adapter = new EvmNftAdapter(url, key, 'mint-cards-v1');
    const profile = new ProfileMirror(db as any, 'executor', url, key, { enabled: true, contractAddress: contract, runtimes: [] });
    const worker = new NftSettlementWorker(db as any, 'executor', adapter, profile);
    await worker.ready();
    expect(calls.filter(m => m === 'eth_call')).toHaveLength(1);
    calls.length = 0; targetReads = 0;
    for (let i = 0; i < 10; i++) expect(await worker.pollOnce()).toEqual({ prepared: 0, confirmed: 0, errors: 0 });
    await worker.reconcileFinality();
    expect(calls).toEqual([]);
    expect(targetReads).toBe(10);
    // A changed expected network must invalidate validation, even with a warm adapter.
    await expect(adapter.ready({ ...executor, network_id: '1' })).rejects.toThrow('SETTLEMENT_EXECUTOR_MISMATCH');
    await expect(profile.ready({ ...executor, network_id: '1' })).rejects.toThrow('PROFILE_CHAIN_MISMATCH');
    owner = contract;
    await expect(profile.ready(executor)).rejects.toThrow('PROFILE_OWNER_MISMATCH');
  } finally { server.stop(true); }
});

function payments() {
  const calls: string[] = [];
  let chain = '0xa4ec', decimals = 6;
  const snapshot: ProviderSnapshot = { provider_key: 'p', adapter_kind: 'evm_erc20_transfer', chain_key: 'production:celo',
    config: { chain_id: '42220', treasury_address: address, start_block: '1', finality: 'finalized' },
    assets: [2, 3, 4].map(n => ({ address: '0x' + String(n).repeat(40), decimals: 6, symbol: 'T' + n, fee_currency: null })),
    cursor: { next_block: '1000', last_block_hash: hash, revision: '1' },
    recent: { cursor: { next_block: '1000', last_block_hash: hash, revision: '1' }, earliest_attempt_at: null } };
  const adapter = new EvmTransferAdapter(async (method, params: any[]) => {
    calls.push(method);
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_getBlockByNumber') return { number: ['latest', 'finalized'].includes(params[0]) ? '0x3f2' : params[0], hash, timestamp: '0x65000000' };
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_call') return '0x' + decimals.toString(16);
    throw Error('Unexpected payment RPC ' + method);
  });
  return { adapter, snapshot, calls, setChain: (v: string) => { chain = v; }, setDecimals: (v: number) => { decimals = v; } };
}

test('empty payment scans cache successful configuration checks, including concurrent callers', async () => {
  const f = payments();
  await Promise.all([f.adapter.scan(f.snapshot), f.adapter.scan(f.snapshot)]);
  expect(f.calls.filter(m => m === 'eth_chainId')).toHaveLength(1);
  expect(f.calls.filter(m => m === 'eth_call')).toHaveLength(3);
  f.calls.length = 0;
  for (let i = 0; i < 10; i++) await f.adapter.scan(f.snapshot);
  expect(f.calls.filter(m => m === 'eth_chainId' || m === 'eth_call')).toEqual([]);
  expect(f.calls.filter(m => m === 'eth_getLogs')).toHaveLength(10);
  f.calls.length = 0;
  expect(await f.adapter.scanRecent(f.snapshot)).toBeNull();
  expect(f.calls).toEqual([]);
});

test('payment configuration changes invalidate caches and failed validations can be retried', async () => {
  const f = payments();
  f.setChain('0x1');
  await expect(f.adapter.scan(f.snapshot)).rejects.toThrow('PAYMENT_CHAIN_MISMATCH');
  f.setChain('0xa4ec'); f.setDecimals(18);
  await expect(f.adapter.scan(f.snapshot)).rejects.toThrow('PAYMENT_TOKEN_DECIMALS_MISMATCH');
  f.setDecimals(6);
  await f.adapter.scan(f.snapshot);
  await expect(f.adapter.scan({ ...f.snapshot, config: { ...f.snapshot.config, chain_id: '1' } })).rejects.toThrow('PAYMENT_CHAIN_MISMATCH');
  const changed = { ...f.snapshot, assets: f.snapshot.assets.map(a => ({ ...a, decimals: 18 })) };
  await expect(f.adapter.scan(changed)).rejects.toThrow('PAYMENT_TOKEN_DECIMALS_MISMATCH');
  f.setDecimals(18);
  await f.adapter.scan(changed);
});

test('Profile rechecks ownership and the pause switch before rebroadcasting persisted bytes', async () => {
  const executor: Executor = { executor_id: 'executor', chain_key: 'local:celo', address, signer_ref: 'TEST', status: 'ready',
    adapter_key: 'evm', network_id: '42220', confirmation_policy: { confirmations: 1, finality: 'local' }, chain_status: 'enabled' };
  const payload = { protocol: 'profile-v1', method: 'syncProgression', args: [address, 1, 1, 1, 1] } as const;
  const operation = { operation_id: 'operation', chain_key: executor.chain_key, contract_address: contract, beneficiary: address, payload };
  const raw = await privateKeyToAccount(key).signTransaction({ chainId: 42220, nonce: 0, to: contract, gas: 200000n,
    maxFeePerGas: 100n, maxPriorityFeePerGas: 1n, data: tagCeloCalldata(profileCalldata(payload as any, address), '42220') });
  const submission = { submission_id: 'submission', executor_id: executor.executor_id, nonce: '0', status: 'prepared',
    tx_hash: keccak256(raw), signed_payload: { raw }, operation, block_hash: null, block_number: null, finalized: false };
  let enabled = true, owner = address, pauseDuringOwnerCheck = false, sends = 0;
  const notes: string[] = [];
  const db = { async rpc(name: string, args: any) {
    const data = name === 'profile_mirror_target' ? { enabled, contract_address: contract, chain_key: executor.chain_key }
      : name === 'pending_profile_submissions' ? [submission] : name === 'profile_mirror_work' ? [] : null;
    if (name === 'note_profile_submission') notes.push(args.p_state);
    return { data, error: null };
  }};
  const mirror = new ProfileMirror(db as any, executor.executor_id, 'http://127.0.0.1:1', key, { enabled: true, contractAddress: contract, runtimes: [] });
  const client = (mirror as any).client;
  client.getChainId = async () => 42220;
  client.readContract = async () => { if (pauseDuringOwnerCheck) enabled = false; return owner; };
  client.getTransactionReceipt = async () => { throw new TransactionReceiptNotFoundError({ hash: submission.tx_hash }); };
  client.getTransactionCount = async () => 0;
  client.sendRawTransaction = async ({ serializedTransaction }: any) => { expect(serializedTransaction).toBe(raw); sends++; return submission.tx_hash; };
  await mirror.ready(executor);
  const lease = { job_id: 'job', lease_token: 'lease' } as any;
  owner = contract;
  expect((await mirror.pollLeased(lease, executor, false)).errors).toBe(1);
  expect(sends).toBe(0); expect(notes).toEqual([]);
  owner = address; pauseDuringOwnerCheck = true;
  await mirror.pollLeased(lease, executor, false);
  expect(sends).toBe(0); expect(notes).toEqual([]);
  enabled = true; pauseDuringOwnerCheck = false;
  await mirror.pollLeased(lease, executor, false);
  expect(sends).toBe(1); expect(notes).toEqual(['submitted']);
});
