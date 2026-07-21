import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableTransportError } from '../src/transactionExecutors/starknetBatchTransactionExecutor.js';

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
