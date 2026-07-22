import assert from 'node:assert/strict';
import test from 'node:test';
import { compileStarknetIntent } from '../src/blockchainAdapters/starknetAdapter.js';
import { env } from '../src/env.js';

test('compiles an account-migration XP reset intent', () => {
  env.XP_SYSTEM_CONTRACT_ADDRESS = '0x123';
  const transaction = compileStarknetIntent({
    id: 'migration_xp_reset_1',
    blockchain: 'starknet',
    operation: 'xp.reset',
    targetRef: 'xp_system',
    payload: { address: '0xabc', seasonId: 3 },
    intentVersion: 1,
    metadata: {},
    retries: 0,
    maxRetries: 3,
    status: 'pending',
  });

  assert.equal(transaction.contractAddress, '0x123');
  assert.equal(transaction.entrypoint, 'reset_xp');
  assert.deepEqual(transaction.calldata, ['0xabc', '3']);
});
