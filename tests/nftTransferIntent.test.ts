import assert from 'node:assert/strict';
import test from 'node:test';
import { CallData, uint256 } from 'starknet';
import { compileStarknetIntent } from '../src/blockchainAdapters/starknetAdapter.js';
import { env } from '../src/env.js';

test('compiles an account-migration NFT transfer intent', () => {
  env.NFT_CONTRACT_ADDRESS = '0x123';
  const transaction = compileStarknetIntent({
    id: 'migration_nft_1',
    blockchain: 'starknet',
    operation: 'nft.transfer',
    targetRef: 'nft_contract',
    payload: { from: '0x1', to: '0x2', tokenId: '340282366920938463463374607431768211457' },
    intentVersion: 1,
    metadata: {},
    retries: 0,
    maxRetries: 3,
    status: 'pending',
  });

  assert.equal(transaction.contractAddress, '0x123');
  assert.equal(transaction.entrypoint, 'transfer_from');
  assert.deepEqual(
    transaction.calldata,
    CallData.compile({
      from: '0x1',
      to: '0x2',
      token_id: uint256.bnToUint256(340282366920938463463374607431768211457n),
    })
  );
});

test('rejects NFT token ids outside u256', () => {
  env.NFT_CONTRACT_ADDRESS = '0x123';
  assert.throws(() => compileStarknetIntent({
    id: 'migration_nft_invalid',
    blockchain: 'starknet',
    operation: 'nft.transfer',
    payload: { from: '0x1', to: '0x2', tokenId: (1n << 256n).toString() },
    intentVersion: 1,
    metadata: {},
    retries: 0,
    maxRetries: 3,
    status: 'pending',
  }), /fit in a u256/);
});
