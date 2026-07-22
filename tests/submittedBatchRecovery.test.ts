import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySubmittedNonce,
  hasExplicitMempoolEviction,
  isSubmittedBatchRecoveryDue,
} from '../src/runtime/submittedBatchRecovery.js';

test('recovers explicit mempool evictions immediately', () => {
  assert.equal(hasExplicitMempoolEviction('Transaction TTL, evicted from the mempool'), true);
  assert.equal(
    isSubmittedBatchRecoveryDue({
      submittedAt: new Date().toISOString(),
      errorMessage: 'Transaction TTL, evicted from the mempool, try to increase the tip',
      timeoutMs: 120000,
    }),
    true
  );
});

test('waits for the unknown receipt timeout when there is no eviction signal', () => {
  assert.equal(
    isSubmittedBatchRecoveryDue({
      submittedAt: '2026-07-22T22:00:00.000Z',
      errorMessage: 'Transaction hash not found',
      timeoutMs: 120000,
      nowMs: new Date('2026-07-22T22:01:59.999Z').getTime(),
    }),
    false
  );
  assert.equal(
    isSubmittedBatchRecoveryDue({
      submittedAt: '2026-07-22T22:00:00.000Z',
      errorMessage: 'Transaction hash not found',
      timeoutMs: 120000,
      nowMs: new Date('2026-07-22T22:02:00.000Z').getTime(),
    }),
    true
  );
});

test('uses nonce state to retry safely or quarantine and release the executor', () => {
  const unused = { latest: 0x96cn, preConfirmed: 0x96cn };
  assert.equal(classifySubmittedNonce('0x96c', unused), 'retry');
  assert.equal(
    classifySubmittedNonce('0x96c', { latest: 0x96cn, preConfirmed: 0x96dn }),
    'quarantine'
  );
  assert.equal(
    classifySubmittedNonce('0x96c', { latest: 0x96bn, preConfirmed: 0x96cn }),
    'quarantine'
  );
  assert.equal(
    classifySubmittedNonce(
      '0x96c',
      { latest: 0x96bn, preConfirmed: 0x96cn },
      true
    ),
    'retry'
  );
  assert.equal(classifySubmittedNonce('invalid', unused), 'quarantine');
});
