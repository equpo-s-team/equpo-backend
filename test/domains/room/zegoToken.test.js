import test from 'node:test';
import assert from 'node:assert/strict';
import { generateZegoToken } from '../../../dist/domains/room/zegoToken.js';

const VALID_APP_ID = 123456789;
const VALID_USER_ID = 'user-test-uid';
// serverSecret must be exactly 32 chars
const VALID_SECRET = 'abcdefgh12345678abcdefgh12345678';
const VALID_TTL = 600;

test('generateZegoToken returns string prefixed with "04"', () => {
  const token = generateZegoToken(VALID_APP_ID, VALID_USER_ID, VALID_SECRET, VALID_TTL);
  assert.ok(typeof token === 'string');
  assert.ok(token.startsWith('04'));
});

test('generateZegoToken returns different tokens on repeated calls (nonce is random)', () => {
  const token1 = generateZegoToken(VALID_APP_ID, VALID_USER_ID, VALID_SECRET, VALID_TTL);
  const token2 = generateZegoToken(VALID_APP_ID, VALID_USER_ID, VALID_SECRET, VALID_TTL);
  assert.notEqual(token1, token2);
});

test('generateZegoToken produces base64-decodable payload after "04" prefix', () => {
  const token = generateZegoToken(VALID_APP_ID, VALID_USER_ID, VALID_SECRET, VALID_TTL);
  const b64 = token.slice(2);
  const decoded = Buffer.from(b64, 'base64');
  // At minimum: 8 bytes expiredTime + 2 bytes ivLength + 16 bytes IV + 2 bytes encLength + encrypted
  assert.ok(decoded.length >= 28);
});

test('generateZegoToken throws when appId is 0', () => {
  assert.throws(() =>
    generateZegoToken(0, VALID_USER_ID, VALID_SECRET, VALID_TTL)
  );
});

test('generateZegoToken throws when userId is empty', () => {
  assert.throws(() =>
    generateZegoToken(VALID_APP_ID, '', VALID_SECRET, VALID_TTL)
  );
});

test('generateZegoToken throws when serverSecret is not 32 chars', () => {
  assert.throws(() =>
    generateZegoToken(VALID_APP_ID, VALID_USER_ID, 'short-secret', VALID_TTL)
  );
});

test('generateZegoToken throws when effectiveTime is 0 or negative', () => {
  assert.throws(() =>
    generateZegoToken(VALID_APP_ID, VALID_USER_ID, VALID_SECRET, 0)
  );
  assert.throws(() =>
    generateZegoToken(VALID_APP_ID, VALID_USER_ID, VALID_SECRET, -1)
  );
});
