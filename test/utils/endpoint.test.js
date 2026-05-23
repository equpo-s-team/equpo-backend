import test from 'node:test';
import assert from 'node:assert/strict';
import { getErrorMessage, getActorUid, logEndpointAudit } from '../../dist/utils/endpoint.js';
import { EqupoError } from '../../dist/types/EqupoError.js';

// ─── getErrorMessage ──────────────────────────────────────────────────────────

test('getErrorMessage returns message from Error instance', () => {
  const err = new Error('Something broke');
  assert.equal(getErrorMessage(err), 'Something broke');
});

test('getErrorMessage returns message from EqupoError', () => {
  const err = new EqupoError('Domain error', 403);
  assert.equal(getErrorMessage(err), 'Domain error');
});

test('getErrorMessage returns "Unknown error" for non-Error values', () => {
  assert.equal(getErrorMessage('string error'), 'Unknown error');
  assert.equal(getErrorMessage(42), 'Unknown error');
  assert.equal(getErrorMessage(null), 'Unknown error');
  assert.equal(getErrorMessage(undefined), 'Unknown error');
  assert.equal(getErrorMessage({ message: 'obj' }), 'Unknown error');
});

// ─── getActorUid ─────────────────────────────────────────────────────────────

test('getActorUid returns uid when req.user is set', () => {
  const mockReq = { user: { uid: 'firebase-uid-abc', claims: {} } };
  const uid = getActorUid(mockReq);
  assert.equal(uid, 'firebase-uid-abc');
});

test('getActorUid throws EqupoError when req.user is missing', () => {
  const mockReq = {};
  assert.throws(
    () => getActorUid(mockReq),
    err => err instanceof EqupoError && err.status === 401
  );
});

// ─── logEndpointAudit ─────────────────────────────────────────────────────────

test('logEndpointAudit does not throw on success outcome', () => {
  assert.doesNotThrow(() =>
    logEndpointAudit({ operation: 'test_op', outcome: 'success', actorUid: 'uid-1', teamId: 'team-1' })
  );
});

test('logEndpointAudit does not throw on error outcome with error value', () => {
  assert.doesNotThrow(() =>
    logEndpointAudit({ operation: 'test_op', outcome: 'error', actorUid: 'uid-1', error: new Error('boom') })
  );
});

test('logEndpointAudit does not throw on error outcome with no error value', () => {
  assert.doesNotThrow(() =>
    logEndpointAudit({ operation: 'test_op', outcome: 'error', actorUid: null })
  );
});
