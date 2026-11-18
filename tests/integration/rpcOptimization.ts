/** Local-only Anvil integration. Requires forge/anvil and source checkouts in
 * NFT_CONTRACTS_DIR (mintCards Solidity project) and PROFILE_CONTRACTS_DIR.
 * No production credentials, database or RPC endpoints are read.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, http, toHex, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { EvmTransferAdapter, paymentRpc } from '../../src/v2/commerce/evm.js';
import { EvmNftAdapter } from '../../src/v2/settlement/evm.js';
import { ProfileMirror } from '../../src/v2/settlement/profileMirror.js';
import type { ProviderSnapshot, Submission } from '../../src/v2/commerce/providers.js';
import type { Executor, NftOperation, NftSubmission } from '../../src/v2/settlement/types.js';

const nftRoot = process.env.NFT_CONTRACTS_DIR, profileRoot = process.env.PROFILE_CONTRACTS_DIR;
assert(nftRoot && profileRoot, 'NFT_CONTRACTS_DIR and PROFILE_CONTRACTS_DIR are required');
const temporary = mkdtempSync(resolve(tmpdir(), 'jon-rpc-integration-'));
const socket = createServer();
await new Promise<void>(r => socket.listen(0, '127.0.0.1', r));
const port = (socket.address() as any).port;
await new Promise<void>(r => socket.close(() => r()));
const url = `http://127.0.0.1:${port}`;
const anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '42220', '--hardfork', 'cancun', '--silent'], { stdio: 'ignore' });
const account = mnemonicToAccount('test test test test test test test test test test test junk');
const recipient = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 1 });
const key = ('0x' + Buffer.from(account.getHdKey().privateKey!).toString('hex')) as Hex;
const client = createPublicClient({ transport: http(url, { retryCount: 0 }) });
const wallet = createWalletClient({ account, transport: http(url, { retryCount: 0 }) });
const artifact = (root: string, name: string) => JSON.parse(readFileSync(resolve(root, 'out', `${name}.sol`, `${name}.json`), 'utf8'));
const mined = async (hash: Hex) => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; };
const deploy = async (a: any, args: any[] = []) => (await mined(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null }))).contractAddress!;
const write = async (address: Hex, a: any, functionName: string, args: any[]) => mined(await wallet.writeContract({ address, abi: a.abi, functionName, args, chain: null }));
try {
  for (let i = 0; ; i++) {
    try { assert.equal(await client.getChainId(), 42220); break; }
    catch { if (i >= 50 || anvil.exitCode !== null) throw Error('ANVIL_UNAVAILABLE'); await Bun.sleep(100); }
  }
  for (const root of [nftRoot, profileRoot]) execFileSync('forge', ['build'], { cwd: root, stdio: 'pipe' });
  execFileSync('forge', ['build', '--root', temporary, '--contracts', resolve(import.meta.dirname, '../fixtures'), '--out', resolve(temporary, 'out'), '--use', '0.8.24', '--evm-version', 'cancun'], { stdio: 'pipe' });
  const tokenArtifact = artifact(temporary, 'PaymentToken');
  const tokens = [];
  for (const [symbol, decimals] of [['USDC', 6], ['USDT', 6], ['USDm', 18]] as const)
    tokens.push({ symbol, decimals, address: (await deploy(tokenArtifact, [decimals])).toLowerCase(), fee_currency: null });
  await client.request({ method: 'anvil_mine' as any, params: [toHex(64)] as any });
  const snapshot: ProviderSnapshot = { provider_key: 'local', chain_key: 'local:celo', adapter_kind: 'evm_erc20_transfer',
    config: { chain_id: '42220', treasury_address: recipient.address.toLowerCase(), start_block: '1', finality: 'finalized' },
    assets: tokens, cursor: { next_block: String(await client.getBlockNumber({ cacheTime: 0 })), last_block_hash: null, revision: '0' } };
  const rpcCalls: string[] = [];
  const rpc = paymentRpc(url);
  const payments = new EvmTransferAdapter(async (m, p) => { rpcCalls.push(m); return rpc(m, p); });
  await payments.scan(snapshot);
  rpcCalls.length = 0;
  for (let i = 0; i < 10; i++) await payments.scan(snapshot);
  assert(!rpcCalls.includes('eth_chainId') && !rpcCalls.includes('eth_call'));
  const evidence = [];
  for (const token of tokens) {
    const amount = 5n * 10n ** BigInt(token.decimals);
    const receipt = await write(token.address as Hex, tokenArtifact, 'transfer', [recipient.address, amount]);
    const submission: Submission = { submission_id: randomUUID(), tx_hash: receipt.transactionHash, wallet: account.address,
      order: { order_id: randomUUID(), delivery_confirmation: 'receipt', created_at: '', expires_at: '', quote: { token_address: token.address, treasury_address: recipient.address.toLowerCase() } } };
    const verified = await payments.verify(snapshot, submission);
    assert.equal(verified.status, 'verified'); assert.equal(verified.events.length, 1); assert.equal(verified.events[0].amount_atomic, amount.toString());
    assert.equal(await client.readContract({ address: token.address as Hex, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [recipient.address] }), amount);
    evidence.push(verified.events[0]);
  }
  // Anvil finality advances after additional blocks; scan and reconciliation use real receipts.
  await client.request({ method: 'anvil_mine' as any, params: [toHex(64)] as any });
  for (const e of evidence) assert.equal((await payments.reconcile(snapshot, e)).status, 'finalized');
  assert.equal((await payments.scan(snapshot))?.events.length, 3);
  console.log('PASS: USDC/USDT (6 decimals), USDm (18), treasury balances, receipt verification, recovery scan and finality.');

  const permissionsArtifact = artifact(nftRoot, 'Permissions'), systemArtifact = artifact(nftRoot, 'PermissionSystem');
  const rendererArtifact = artifact(nftRoot, 'CardMetadataRenderer'), cardsArtifact = artifact(nftRoot, 'JokersOfNeonCards');
  const permissions = await deploy(permissionsArtifact, [account.address]), system = await deploy(systemArtifact, [account.address]);
  await write(system, systemArtifact, 'initialize', [permissions]);
  const renderer = await deploy(rendererArtifact, [system, 'https://example.invalid/']);
  const cards = await deploy(cardsArtifact, ['Jokers of Neon', 'JON', account.address, system, renderer]);
  await write(permissions, permissionsArtifact, 'setPermission', [cards, account.address, true]);
  const executor: Executor = { executor_id: randomUUID(), chain_key: 'local:celo', adapter_key: 'evm', network_id: '42220',
    address: account.address.toLowerCase(), signer_ref: 'LOCAL_ONLY', status: 'ready', chain_status: 'enabled', confirmation_policy: { confirmations: 1, finality: 'local' } };
  const nft = new EvmNftAdapter(url, key, 'mint-cards-v1');
  await nft.ready(executor);
  for (let i = 0; i < 2; i++) {
    const operation: NftOperation = { operation_id: randomUUID(), collection_id: randomUUID(), deployment_id: randomUUID(), chain_key: executor.chain_key,
      contract_address: cards.toLowerCase(), beneficiary: recipient.address.toLowerCase(), abi_hash: 'ab'.repeat(32), payload_hash: 'ab'.repeat(32), status: 'pending', acceptance: 'receipt',
      payload: { protocol: 'mint-card-v1', card: { item_id: 1, item_type: 1, card_id: 10101 + i, rarity: 1, skin_id: 0, skin_rarity: 0, quality: 7, marketable: true } } };
    await nft.ready(executor);
    const signed = await nft.prepare(operation);
    const submission: NftSubmission = { ...signed, submission_id: randomUUID(), executor_id: executor.executor_id, status: 'prepared', operation, confirmed_block: null };
    await nft.broadcast(submission);
    await mined(submission.tx_hash as Hex);
    const result = await nft.observe(submission);
    assert.equal(result.kind, 'confirmed');
    if (result.kind !== 'confirmed') throw Error('MINT_NOT_CONFIRMED');
    assert.equal((await client.readContract({ address: cards, abi: cardsArtifact.abi, functionName: 'ownerOf', args: [BigInt(result.evidence.token_id)] }) as string).toLowerCase(), recipient.address.toLowerCase());
    assert(await nft.finalized({ ...submission, confirmed_block: { number: result.evidence.block_number, hash: result.evidence.block_hash } }));
  }
  assert.equal(await client.readContract({ address: cards, abi: cardsArtifact.abi, functionName: 'balanceOf', args: [recipient.address] }), 2n);
  console.log('PASS: two signed mintCards transactions, persisted payload validation, Celo attribution, mint events, NFT ownership and finality.');

  const profileArtifact = artifact(profileRoot, 'JokersOfNeonProfile'), profileAddress = await deploy(profileArtifact);
  let enabled = true, losePrepareResponse = false;
  let next: any = null;
  const submissions: any[] = [];
  const notes: string[] = [];
  const db = { rpc: async (name: string, args: any) => {
    let data: any;
    if (name === 'profile_mirror_target') data = { contract_address: profileAddress, chain_key: executor.chain_key, enabled };
    else if (name === 'profile_mirror_work') data = [];
    else if (name === 'pending_profile_submissions') data = submissions.filter(s => args.p_finality ? s.status === 'confirmed' && !s.finalized : ['prepared', 'submitted'].includes(s.status));
    else if (name === 'next_profile_operation') data = next;
    else if (name === 'prepare_profile_submission') {
      data = { submission_id: randomUUID(), executor_id: executor.executor_id, nonce: args.p_nonce, tx_hash: args.p_tx_hash,
        signed_payload: args.p_signed_payload, status: 'prepared', operation: next, block_hash: null, block_number: null, finalized: false };
      submissions.push(data); next = null;
      if (losePrepareResponse) { losePrepareResponse = false; return { data: null, error: { message: 'LOST_PREPARE_RESPONSE' } }; }
    } else if (name === 'note_profile_submission') {
      const s = submissions.find(s => s.submission_id === args.p_submission_id)!;
      notes.push(args.p_state);
      if (args.p_state === 'finalized') s.finalized = true;
      else s.status = args.p_state;
      if (args.p_evidence) Object.assign(s, { block_hash: args.p_evidence.block_hash, block_number: args.p_evidence.block_number });
      data = null;
    } else throw Error('UNEXPECTED_DB_RPC:' + name);
    return { data, error: null };
  }};
  const config = { enabled: true, contractAddress: profileAddress, runtimes: [] };
  let mirror = new ProfileMirror(db as any, executor.executor_id, url, key, config);
  await mirror.ready(executor);
  const lease = { job_id: 'local', lease_token: 'local' } as any;
  const operation = () => ({ operation_id: randomUUID(), chain_key: executor.chain_key, contract_address: profileAddress, beneficiary: recipient.address,
    payload_hash: 'cd'.repeat(32), payload: { protocol: 'profile-v1', method: 'addPlayerStats', args: [recipient.address, 1, 0, ...Array(20).fill(0)] } });
  next = operation(); losePrepareResponse = true;
  await assert.rejects(mirror.pollLeased(lease, executor), /LOST_PREPARE_RESPONSE/);
  const persisted = submissions[0], nonce = await client.getTransactionCount({ address: account.address });
  enabled = false;
  await mirror.pollLeased(lease, executor);
  assert.equal(await client.getTransactionCount({ address: account.address }), nonce);
  enabled = true;
  const paused = new ProfileMirror(db as any, executor.executor_id, url, key, { ...config, enabled: false });
  await paused.pollLeased(lease, executor);
  assert.equal(await client.getTransactionCount({ address: account.address }), nonce);
  mirror = new ProfileMirror(db as any, executor.executor_id, url, key, config);
  await mirror.ready(executor);
  await mirror.pollLeased(lease, executor);
  await mined(persisted.tx_hash);
  await mirror.pollLeased(lease, executor);
  await mirror.reconcileFinality();
  assert(persisted.finalized); assert(notes.includes('submitted') && notes.includes('confirmed'));
  for (let i = 0; i < 5; i++) await mirror.pollLeased(lease, executor);
  assert.equal((await client.readContract({ address: profileAddress, abi: profileArtifact.abi, functionName: 'getPlayerStats', args: [recipient.address] }) as any).gamesPlayed, 1);
  next = operation();
  await write(profileAddress, profileArtifact, 'transferOwnership', [recipient.address]);
  await assert.rejects(mirror.pollLeased(lease, executor), /PROFILE_OWNER_MISMATCH/);
  assert.equal(submissions.length, 1);
  console.log('PASS: Profile lost prepare response, both pause switches, restart/rebroadcast of exact bytes, no duplicate stats, finality and changed owner blocking preparation.');
} finally {
  anvil.kill('SIGTERM');
  rmSync(temporary, { recursive: true, force: true });
}
