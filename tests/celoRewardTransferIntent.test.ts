import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCeloIntent } from '../src/blockchainAdapters/celoAdapter.js';
import { env } from '../src/env.js';

const REWARD_TOKEN = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const RECIPIENT = '0xd9A5E955603c9A68a553aB9BD676F31c547572a6';

function rewardIntent(recipient: unknown, amount: unknown) {
  return {
    id: 'reward_1',
    blockchain: 'celo',
    operation: 'reward.usdm.transfer' as const,
    targetRef: 'usdm_token',
    payload: { recipient, amount },
    intentVersion: 1,
    metadata: {},
    retries: 0,
    maxRetries: 3,
    status: 'pending' as const,
  };
}

test('compiles a USDm reward using 18 decimal token units', () => {
  env.CELO_REWARD_TOKEN_CONTRACT_ADDRESS = REWARD_TOKEN;
  const transaction = compileCeloIntent(rewardIntent(RECIPIENT, '25.50'));

  assert.equal(transaction.contractAddress, REWARD_TOKEN);
  assert.equal(transaction.entrypoint, 'transfer');
  assert.deepEqual(transaction.calldata, [RECIPIENT, 25_500_000_000_000_000_000n]);
});

test('rejects invalid reward recipients', () => {
  assert.throws(() => compileCeloIntent(rewardIntent('not-a-wallet', '1')), /address/i);
  assert.throws(
    () => compileCeloIntent(rewardIntent('0x0000000000000000000000000000000000000000', '1')),
    /zero address/
  );
});

test('rejects non-positive or over-precise reward amounts', () => {
  assert.throws(() => compileCeloIntent(rewardIntent(RECIPIENT, '0')), /greater than zero/);
  assert.throws(
    () => compileCeloIntent(rewardIntent(RECIPIENT, '1.0000000000000000001')),
    /at most 18 decimal places/
  );
  assert.throws(() => compileCeloIntent(rewardIntent(RECIPIENT, 1)), /string/);
});
