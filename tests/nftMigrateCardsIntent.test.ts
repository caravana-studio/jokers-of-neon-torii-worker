import assert from 'node:assert/strict';
import test from 'node:test';
import { compileStarknetIntent } from '../src/blockchainAdapters/starknetAdapter.js';
import { env } from '../src/env.js';

function migrationIntent(tokenIds: unknown) {
  return {
    id: 'migration_nft_chunk_1',
    blockchain: 'starknet',
    operation: 'nft.migrate_cards' as const,
    targetRef: 'nft_contract',
    payload: { from: '0x1', to: '0x2', tokenIds },
    intentVersion: 2,
    metadata: {},
    retries: 0,
    maxRetries: 3,
    status: 'pending' as const,
  };
}

test('compiles an account-migration NFT card chunk intent', () => {
  env.NFT_CONTRACT_ADDRESS = '0x123';
  const firstTokenId = 340282366920938463463374607431768211457n;
  const transaction = compileStarknetIntent(
    migrationIntent([firstTokenId.toString(), '0x2'])
  );

  assert.equal(transaction.contractAddress, '0x123');
  assert.equal(transaction.entrypoint, 'migrate_cards');
  assert.deepEqual(transaction.calldata, ['1', '2', '2', '1', '1', '2', '0']);
});

test('rejects empty NFT card chunks', () => {
  env.NFT_CONTRACT_ADDRESS = '0x123';
  assert.throws(
    () => compileStarknetIntent(migrationIntent([])),
    /non-empty array/
  );
});

test('rejects duplicate NFT token ids', () => {
  env.NFT_CONTRACT_ADDRESS = '0x123';
  assert.throws(
    () => compileStarknetIntent(migrationIntent(['2', '0x2'])),
    /unique token ids/
  );
});

test('rejects NFT token ids outside u256', () => {
  env.NFT_CONTRACT_ADDRESS = '0x123';
  assert.throws(
    () => compileStarknetIntent(migrationIntent([(1n << 256n).toString()])),
    /fit in a u256/
  );
});
