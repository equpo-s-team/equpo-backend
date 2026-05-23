import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HTTP_STATUS,
  ERROR_STATUS,
  SUCCESS_STATUS,
} from '../../dist/constants/httpStatusCodes.js';

test('HTTP_STATUS has correct 2xx codes', () => {
  assert.equal(HTTP_STATUS.OK, 200);
  assert.equal(HTTP_STATUS.CREATED, 201);
  assert.equal(HTTP_STATUS.NO_CONTENT, 204);
});

test('HTTP_STATUS has correct 4xx codes', () => {
  assert.equal(HTTP_STATUS.BAD_REQUEST, 400);
  assert.equal(HTTP_STATUS.UNAUTHORIZED, 401);
  assert.equal(HTTP_STATUS.FORBIDDEN, 403);
  assert.equal(HTTP_STATUS.NOT_FOUND, 404);
  assert.equal(HTTP_STATUS.CONFLICT, 409);
  assert.equal(HTTP_STATUS.TOO_MANY_REQUESTS, 429);
});

test('HTTP_STATUS has correct 5xx codes', () => {
  assert.equal(HTTP_STATUS.INTERNAL_SERVER_ERROR, 500);
});

test('ERROR_STATUS maps to correct HTTP codes', () => {
  assert.equal(ERROR_STATUS.VALIDATION, 400);
  assert.equal(ERROR_STATUS.UNAUTHORIZED, 401);
  assert.equal(ERROR_STATUS.FORBIDDEN, 403);
  assert.equal(ERROR_STATUS.NOT_FOUND, 404);
  assert.equal(ERROR_STATUS.CONFLICT, 409);
  assert.equal(ERROR_STATUS.TOO_MANY_REQUESTS, 429);
  assert.equal(ERROR_STATUS.SERVER_ERROR, 500);
});

test('SUCCESS_STATUS maps to correct HTTP codes', () => {
  assert.equal(SUCCESS_STATUS.OK, 200);
  assert.equal(SUCCESS_STATUS.CREATED, 201);
  assert.equal(SUCCESS_STATUS.NO_CONTENT, 204);
});
