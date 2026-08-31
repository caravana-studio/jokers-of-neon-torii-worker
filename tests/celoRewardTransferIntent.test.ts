import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCeloIntent } from '../src/blockchainAdapters/celoAdapter.js';
import { CELO_REWARD_TOKENS } from '../src/config/celoRewardTokens.js';
const RECIPIENT = '0xd9A5E955603c9A68a553aB9BD676F31c547572a6';

function rewardIntent(token: unknown, recipient: unknown, amount: unknown) {
  return {
    id: 'reward_1',
    blockchain: 'celo',
    operation: 'reward.token.transfer' as const,
    targetRef: `${String(token)}_token`,
    payload: { token, recipient, amount },
    intentVersion: 1,
    metadata: {},
    retries: 0,
    maxRetries: 3,
    status: 'pending' as const,
  };
}

test('compiles USDm rewards using 18 decimal token units', () => {
  const transaction = compileCeloIntent(rewardIntent('usdm', RECIPIENT, '25.50'));

  assert.equal(transaction.contractAddress, CELO_REWARD_TOKENS.usdm.address);
  assert.equal(transaction.entrypoint, 'transfer');
  assert.deepEqual(transaction.calldata, [RECIPIENT, 25_500_000_000_000_000_000n]);
});

test('compiles USDT and USDC rewards using 6 decimal token units', () => {
  const usdt = compileCeloIntent(rewardIntent('usdt', RECIPIENT, '25.50'));
  const usdc = compileCeloIntent(rewardIntent('usdc', RECIPIENT, '0.000001'));

  assert.equal(usdt.contractAddress, CELO_REWARD_TOKENS.usdt.address);
  assert.deepEqual(usdt.calldata, [RECIPIENT, 25_500_000n]);
  assert.equal(usdc.contractAddress, CELO_REWARD_TOKENS.usdc.address);
  assert.deepEqual(usdc.calldata, [RECIPIENT, 1n]);
});

test('rejects invalid reward recipients and unsupported tokens', () => {
  assert.throws(
    () => compileCeloIntent(rewardIntent('usdc', 'not-a-wallet', '1')),
    /address/i
  );
  assert.throws(
    () =>
      compileCeloIntent(
        rewardIntent('usdt', '0x0000000000000000000000000000000000000000', '1')
      ),
    /zero address/
  );
  assert.throws(
    () => compileCeloIntent(rewardIntent('dai', RECIPIENT, '1')),
    /Unsupported reward token/
  );
});

test('rejects non-positive or over-precise reward amounts', () => {
  assert.throws(
    () => compileCeloIntent(rewardIntent('usdm', RECIPIENT, '0')),
    /greater than zero/
  );
  assert.throws(
    () => compileCeloIntent(rewardIntent('usdc', RECIPIENT, '1.0000001')),
    /at most 6 decimal places/
  );
  assert.throws(
    () => compileCeloIntent(rewardIntent('usdt', RECIPIENT, 1)),
    /string/
  );
});
