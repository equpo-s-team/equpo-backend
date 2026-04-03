import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserRateLimitMiddleware } from '../dist/utils/rateLimit.js';

function createResponseMock() {
  return {
    statusCode: 200,
    payload: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('rate limit blocks requests after exceeding maxRequests', () => {
  const middleware = createUserRateLimitMiddleware({
    windowMs: 1_000,
    maxRequests: 2,
    blockMs: 500,
    maxBlockMs: 2_000,
  });

  const req = { user: { uid: 'uid-a' } };
  const firstRes = createResponseMock();
  const secondRes = createResponseMock();
  const blockedRes = createResponseMock();
  let nextCalls = 0;

  middleware(req, firstRes, () => {
    nextCalls += 1;
  });
  middleware(req, secondRes, () => {
    nextCalls += 1;
  });
  middleware(req, blockedRes, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 2);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.payload.error, 'Too many requests');
  assert.ok(blockedRes.headers.has('retry-after'));
});

test('rate limit allows new request after block duration finishes', async () => {
  const middleware = createUserRateLimitMiddleware({
    windowMs: 100,
    maxRequests: 1,
    blockMs: 40,
    maxBlockMs: 100,
  });

  const req = { user: { uid: 'uid-b' } };
  middleware(req, createResponseMock(), () => {});

  const blockedRes = createResponseMock();
  middleware(req, blockedRes, () => {});
  assert.equal(blockedRes.statusCode, 429);

  await wait(45);

  let didPass = false;
  const afterBlockRes = createResponseMock();
  middleware(req, afterBlockRes, () => {
    didPass = true;
  });

  assert.equal(didPass, true);
  assert.equal(afterBlockRes.statusCode, 200);
});

test('rate limit state is isolated per user uid', () => {
  const middleware = createUserRateLimitMiddleware({
    windowMs: 1_000,
    maxRequests: 1,
    blockMs: 500,
    maxBlockMs: 2_000,
  });

  const userAReq = { user: { uid: 'uid-c' } };
  const userBReq = { user: { uid: 'uid-d' } };

  middleware(userAReq, createResponseMock(), () => {});
  middleware(userAReq, createResponseMock(), () => {});

  let userBAllowed = false;
  const userBRes = createResponseMock();
  middleware(userBReq, userBRes, () => {
    userBAllowed = true;
  });

  assert.equal(userBAllowed, true);
  assert.equal(userBRes.statusCode, 200);
});

