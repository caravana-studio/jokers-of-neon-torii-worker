import { expect, it } from 'bun:test';
import { fromDataSuffix, toDataSuffix, verifyTx } from '@celo/attribution-tags';
import {
  concat, decodeFunctionData, encodeFunctionData, keccak256, parseTransaction,
  recoverTransactionAddress, toHex, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CELO_ATTRIBUTION_CODE, tagCeloCalldata } from '../../src/utils/celoAttribution.js';
import { EvmNftAdapter, cardsAbi, evmCard } from '../../src/v2/settlement/evm.js';
import { solidityCardsAbi, solidityMintData } from '../../src/v2/settlement/solidityCards.js';
import { operationId, type Executor, type NftOperation, type NftSubmission } from '../../src/v2/settlement/types.js';

// Public fixture key. All RPC methods exercised below are replaced; no network calls are made.
const key = ('0x' + '01'.repeat(32)) as Hex;
const account = privateKeyToAccount(key);
const id = '10000000-0000-0000-0000-000000000001';
const operation: NftOperation = {
  operation_id: id, chain_key: 'test:celo', deployment_id: id, collection_id: id,
  contract_address: '0x' + '12'.repeat(20), abi_hash: 'ab'.repeat(32),
  beneficiary: account.address.toLowerCase(), payload_hash: 'ab'.repeat(32), status: 'pending',
  payload: { protocol: 'mint-card-v1', card: { item_id: 1, item_type: 1, card_id: 10101,
    rarity: 1, skin_id: 0, skin_rarity: 0, quality: 7, marketable: false } },
};

it('preserves ERC-20 calldata and emits the assigned code only on Celo networks', () => {
  const abi = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] }] as const;
  const data = encodeFunctionData({ abi, functionName: 'transfer', args: [account.address, 25n] });
  for (const chain of [42220, '11142220']) {
    const tagged = tagCeloCalldata(data, chain);
    expect(tagged.startsWith(data)).toBe(true);
    expect(decodeFunctionData({ abi, data: tagged }).args).toEqual([account.address, 25n]);
    expect(fromDataSuffix(tagged)).toEqual({ codes: ['celo_zni2b7n2'], schemaId: 0 });
  }
  expect(tagCeloCalldata(data, 1)).toBe(data);
  expect(tagCeloCalldata(data, 31337)).toBe(data);
});

for (const protocol of ['mint-reward-v1', 'mint-cards-v1'] as const) {
  it(`tags ${protocol} before preparation and replays old and new signed submissions safely`, async () => {
    const adapter = new EvmNftAdapter('http://127.0.0.1:1', key, protocol);
    const client = (adapter as any).client;
    const wallet = (adapter as any).wallet;
    client.getChainId = async () => 42220;
    wallet.signTransaction = async (request: any) => account.signTransaction(request);
    const executor: Executor = {
      executor_id: id, chain_key: operation.chain_key, adapter_key: 'evm', network_id: '42220',
      address: account.address, signer_ref: 'fixture', status: 'ready', chain_status: 'enabled',
      confirmation_policy: { confirmations: 1, finality: 'local' },
    };
    await adapter.ready(executor);
    const original = protocol === 'mint-cards-v1' ? solidityMintData(operation)
      : encodeFunctionData({ abi: cardsAbi, functionName: 'mintReward',
        args: [toHex(operationId(id), { size: 32 }), operation.beneficiary as Hex, [evmCard(operation)]] });
    wallet.prepareTransactionRequest = async (request: any) => {
      // Gas estimation must receive the suffix, not just the later signing step.
      expect(request.data).toBe(tagCeloCalldata(original, 42220));
      return { ...request, chainId: 42220, nonce: 7, gas: 250000n,
        maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, value: 0n };
    };
    const signed = await adapter.prepare(operation);
    const raw = signed.signed_payload.raw as Hex;
    const tx = parseTransaction(raw);
    expect(tx.data).toBe(tagCeloCalldata(original, 42220));
    expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(account.address);
    const decoded = decodeFunctionData({
      abi: protocol === 'mint-cards-v1' ? solidityCardsAbi : cardsAbi, data: tx.data!,
    });
    expect(decoded.functionName).toBe(protocol === 'mint-cards-v1' ? 'mintCards' : 'mintReward');
    expect(decoded.args).toEqual(decodeFunctionData({
      abi: protocol === 'mint-cards-v1' ? solidityCardsAbi : cardsAbi, data: original,
    }).args);
    const sent: Hex[] = [];
    client.sendRawTransaction = async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      sent.push(serializedTransaction);
      return keccak256(serializedTransaction);
    };
    const submission: NftSubmission = { ...signed, submission_id: id, executor_id: id, operation,
      status: 'prepared', confirmed_block: null };
    await adapter.broadcast(submission);
    expect(sent).toEqual([raw]);
    // Exercise the SDK verifier against the input of the signed transaction (offline RPC fixture).
    expect(await verifyTx({ client: { getTransaction: async () => ({ input: tx.data! }) },
      hash: signed.tx_hash as Hex })).toEqual({ codes: [CELO_ATTRIBUTION_CODE], schemaId: 0 });

    const signData = async (data: Hex) => account.signTransaction({
      chainId: 42220, nonce: 7, to: operation.contract_address as Hex, gas: 250000n,
      maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, value: 0n, data,
    });
    const legacy = await signData(original);
    await adapter.broadcast({ ...submission, tx_hash: keccak256(legacy),
      signed_payload: { ...signed.signed_payload, raw: legacy } });
    expect(sent).toEqual([raw, legacy]);

    for (const data of [concat([original, toDataSuffix('celo_wrong123')]), concat([tx.data!, '0x00'])]) {
      const invalid = await signData(data);
      await expect(adapter.broadcast({ ...submission, tx_hash: keccak256(invalid),
        signed_payload: { ...signed.signed_payload, raw: invalid } })).rejects.toThrow('SIGNED_PAYLOAD_MISMATCH');
    }
    await expect(adapter.broadcast({ ...submission, operation: { ...operation,
      beneficiary: '0x' + '34'.repeat(20) } })).rejects.toThrow('SIGNED_PAYLOAD_MISMATCH');
    expect(sent).toHaveLength(2);
  });
}
