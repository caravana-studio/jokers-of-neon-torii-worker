import assert from 'node:assert/strict';
import test from 'node:test';
import { stark } from 'starknet';
import {
  isRetryableTransportError,
  STARKNET_BATCH_RESOURCE_BOUNDS_OVERHEAD,
  STARKNET_NFT_MIGRATION_RESOURCE_BOUNDS_OVERHEAD,
  shouldRetryNftMigrationWithReducedL2Overhead,
} from '../src/transactionExecutors/starknetBatchTransactionExecutor.js';

const STARKNET_MAX_L2_GAS_AMOUNT = 1_210_000_000n;

test('does not treat calldata containing 503 as a transient HTTP error', () => {
  const error = new Error(
    'RPC: starknet_estimateFee sender=0x07541c4c9fba3fd706cccaf2fef6ab3991df4d8014d0d558ad9cc9c93cfaf526 calldata=0x2a1ead645ba883d1e3c2ac1c649fee74bcb1f2798b3df6504f44083ad06b8fa execution_error="RunResources has no remaining steps"'
  );

  assert.equal(isRetryableTransportError(error), false);
});

test('still treats an HTTP 503 response as transient', () => {
  assert.equal(
    isRetryableTransportError(new Error('HTTP request failed with status 503 Service Unavailable')),
    true
  );
});

test('keeps captured legacy NFT transfer L2 gas below the Starknet transaction limit', () => {
  const resourceBounds = stark.toOverheadResourceBounds(
    {
      l2_gas_consumed: '856706960',
      l2_gas_price: '30192947832',
      l1_gas_consumed: '0',
      l1_gas_price: '73773416646947',
      l1_data_gas_consumed: '2336',
      l1_data_gas_price: '61673927975',
      overall_fee: '25866652620887060320',
      unit: 'FRI',
    },
    STARKNET_BATCH_RESOURCE_BOUNDS_OVERHEAD
  );

  assert.ok(
    resourceBounds.l2_gas.max_amount <= STARKNET_MAX_L2_GAS_AMOUNT,
    `L2 max amount ${resourceBounds.l2_gas.max_amount} exceeds ${STARKNET_MAX_L2_GAS_AMOUNT}`
  );
});

test('retries only NFT gas-cap rejections with reduced L2 overhead', () => {
  const gasCapError = new Error(
    'Max gas amount is too high: GasAmount(1336342112), maximum allowed gas amount: 1210000000'
  );

  assert.equal(
    shouldRetryNftMigrationWithReducedL2Overhead(
      [{ operation: 'nft.migrate_cards' }],
      gasCapError
    ),
    true
  );
  assert.equal(
    shouldRetryNftMigrationWithReducedL2Overhead([{ operation: 'xp.test' }], gasCapError),
    false
  );
  assert.equal(
    shouldRetryNftMigrationWithReducedL2Overhead(
      [{ operation: 'nft.migrate_cards' }],
      new Error('HTTP 503 Service Unavailable')
    ),
    false
  );
});

test('keeps the observed maximal-inventory estimate below Starknet L2 gas limit', () => {
  const resourceBounds = stark.toOverheadResourceBounds(
    {
      l2_gas_consumed: '954530080',
      l2_gas_price: '43584507006',
      l1_gas_consumed: '0',
      l1_gas_price: '109932978906043',
      l1_data_gas_consumed: '3456',
      l1_data_gas_price: '108233183219',
      overall_fee: '41601895220624404480',
      unit: 'FRI',
    },
    STARKNET_NFT_MIGRATION_RESOURCE_BOUNDS_OVERHEAD
  );

  assert.equal(resourceBounds.l2_gas.max_amount, 1_145_436_096n);
  assert.ok(resourceBounds.l2_gas.max_amount <= STARKNET_MAX_L2_GAS_AMOUNT);
});
