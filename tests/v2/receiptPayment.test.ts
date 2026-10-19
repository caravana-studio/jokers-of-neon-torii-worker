import { test, expect } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, toHex } from 'viem';
import { EvmTransferAdapter } from '../../src/v2/commerce/evm.js';
import type { ProviderSnapshot, Submission } from '../../src/v2/commerce/providers.js';

const hash = (n: number) => toHex(n, { size: 32 });
const wallet = '0x' + '11'.repeat(20), treasury = '0x' + '22'.repeat(20), token = '0x' + '33'.repeat(20);
const snapshot: ProviderSnapshot = {
  provider_key: 'test', adapter_kind: 'evm_erc20_transfer', chain_key: 'staging:celo',
  config: { chain_id: '11142220', treasury_address: treasury, start_block: '1', finality: 'finalized' },
  assets: [{ symbol: 'USDC', address: token, decimals: 6, fee_currency: null }],
  cursor: { next_block: '5', last_block_hash: null, revision: '0' },
};
const submission: Submission = {
  submission_id: 'test', tx_hash: hash(100), wallet,
  order: { order_id: 'test', delivery_confirmation: 'receipt', created_at: '', expires_at: '',
    quote: { token_address: token, treasury_address: treasury } },
};
function fixture() {
  let final = 4, missing = false, chain = 11142220, canonical = hash(5), finalRpcDown = false;
  const timestamp = toHex(Math.floor(Date.now() / 1000) - 1);
  const receipt = { status: '0x1', transactionHash: hash(100), blockNumber: '0x5', blockHash: hash(5), logs: [{
    address: token, transactionHash: hash(100), blockNumber: '0x5', blockHash: hash(5), logIndex: '0x0', removed: false,
    topics: encodeEventTopics({ abi: [parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)')],
      eventName: 'Transfer', args: { from: wallet as `0x${string}`, to: treasury as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [5000000n]),
  }] };
  const adapter = new EvmTransferAdapter(async (method, args: any[]) => {
    if (method === 'eth_chainId') return toHex(chain);
    if (method === 'eth_call') return '0x6';
    if (method === 'eth_getTransactionReceipt') return missing ? null : receipt;
    if (method === 'eth_getBlockByNumber') {
      if (args[0] === 'finalized' && finalRpcDown) throw Error('PAYMENT_RPC_UNAVAILABLE');
      const n = args[0] === 'latest' ? 5 : args[0] === 'finalized' ? final : Number(BigInt(args[0]));
      return { number: toHex(n), hash: n === 5 ? canonical : hash(n), timestamp };
    }
    if (method === 'eth_getLogs') return [];
    throw Error('UNEXPECTED_RPC');
  });
  return { adapter, receipt, setFinal: (n: number) => { final = n; }, setMissing: (v: boolean) => { missing = v; },
    setChain: (n: number) => { chain = n; }, reorg: () => { canonical = hash(999); }, failFinalRpc: () => { finalRpcDown = true; } };
}
test('successful canonical receipt is verified without consulting finalized; legacy policy still waits', async () => {
  const f = fixture();
  expect((await f.adapter.verify(snapshot, { ...submission, order: { ...submission.order, delivery_confirmation: 'finalized' } })).code).toBe('PAYMENT_NOT_FINAL');
  f.failFinalRpc();
  const verified = await f.adapter.verify(snapshot, submission);
  expect(verified.status).toBe('verified'); expect(verified.events[0].amount_atomic).toBe('5000000');
});
test('hash alone, failed execution, wrong token/parties, wrong network and noncanonical receipts never verify', async () => {
  const f = fixture();
  f.setMissing(true); expect((await f.adapter.verify(snapshot, submission)).code).toBe('PAYMENT_NOT_MINED'); f.setMissing(false);
  f.receipt.status = '0x0'; expect((await f.adapter.verify(snapshot, submission)).code).toBe('PAYMENT_NOT_SUCCEEDED'); f.receipt.status = '0x1';
  for (const alter of [
    () => { f.receipt.logs[0].address = treasury; },
    () => { f.receipt.logs[0].topics[1] = hash(77); },
    () => { f.receipt.logs[0].topics[2] = hash(77); },
  ]) {
    const original = structuredClone(f.receipt.logs[0]); alter();
    expect((await f.adapter.verify(snapshot, submission)).status).toBe('review'); f.receipt.logs[0] = original;
  }
  f.setChain(42220); await expect(f.adapter.verify(snapshot, submission)).rejects.toThrow('PAYMENT_CHAIN_MISMATCH'); f.setChain(11142220);
  f.reorg(); expect((await f.adapter.verify(snapshot, submission)).code).toBe('PAYMENT_REORG_PENDING');
});
test('reconciliation detects changed evidence, waits through missing receipts, and closes on finality', async () => {
  const f = fixture(), event = (await f.adapter.verify(snapshot, submission)).events[0];
  expect((await f.adapter.reconcile(snapshot, event)).status).toBe('pending');
  f.setMissing(true); expect((await f.adapter.reconcile(snapshot, event)).status).toBe('pending'); f.setMissing(false);
  f.setFinal(5); expect((await f.adapter.reconcile(snapshot, event)).status).toBe('finalized');
  f.receipt.logs[0].data = encodeAbiParameters([{ type: 'uint256' }], [1n]);
  expect((await f.adapter.reconcile(snapshot, event)).status).toBe('review');
});
