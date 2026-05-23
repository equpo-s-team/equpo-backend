import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedExternalAvatarUrl,
  ALLOWED_EXTERNAL_AVATAR_HOSTS,
  MAX_USER_AVATAR_BYTES,
} from '../../../dist/domains/user/utils.js';
import { EqupoError } from '../../../dist/types/EqupoError.js';

// ─── ALLOWED_EXTERNAL_AVATAR_HOSTS ───────────────────────────────────────────

test('ALLOWED_EXTERNAL_AVATAR_HOSTS includes lh3.googleusercontent.com', () => {
  assert.ok(ALLOWED_EXTERNAL_AVATAR_HOSTS.has('lh3.googleusercontent.com'));
});

test('MAX_USER_AVATAR_BYTES is 5 MB', () => {
  assert.equal(MAX_USER_AVATAR_BYTES, 5 * 1024 * 1024);
});

// ─── assertAllowedExternalAvatarUrl ──────────────────────────────────────────

test('assertAllowedExternalAvatarUrl returns URL for allowed host', () => {
  const result = assertAllowedExternalAvatarUrl(
    'https://lh3.googleusercontent.com/photo.jpg'
  );
  assert.ok(result instanceof URL);
  assert.equal(result.hostname, 'lh3.googleusercontent.com');
});

test('assertAllowedExternalAvatarUrl accepts all allowed Google hosts', () => {
  const hosts = [
    'lh3.googleusercontent.com',
    'lh4.googleusercontent.com',
    'lh5.googleusercontent.com',
    'lh6.googleusercontent.com',
  ];
  for (const host of hosts) {
    const result = assertAllowedExternalAvatarUrl(`https://${host}/photo.jpg`);
    assert.equal(result.hostname, host);
  }
});

test('assertAllowedExternalAvatarUrl throws EqupoError on invalid URL', () => {
  assert.throws(
    () => assertAllowedExternalAvatarUrl('not-a-url'),
    err => err instanceof EqupoError && err.status === 400
  );
});

test('assertAllowedExternalAvatarUrl throws EqupoError on HTTP (non-HTTPS) URL', () => {
  assert.throws(
    () => assertAllowedExternalAvatarUrl('http://lh3.googleusercontent.com/photo.jpg'),
    err => err instanceof EqupoError && err.status === 400
  );
});

test('assertAllowedExternalAvatarUrl throws EqupoError on disallowed host', () => {
  assert.throws(
    () => assertAllowedExternalAvatarUrl('https://evil.com/photo.jpg'),
    err => err instanceof EqupoError && err.status === 400
  );
});
