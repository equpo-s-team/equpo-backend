import test from 'node:test';
import assert from 'node:assert/strict';
import { EqupoError } from '../../dist/types/EqupoError.js';

test('EqupoError is an instance of Error', () => {
  const err = new EqupoError('Something failed');
  assert.ok(err instanceof Error);
});

test('EqupoError sets message correctly', () => {
  const err = new EqupoError('Validation failed');
  assert.equal(err.message, 'Validation failed');
});

test('EqupoError defaults status to 400', () => {
  const err = new EqupoError('Bad request');
  assert.equal(err.status, 400);
});

test('EqupoError accepts custom status', () => {
  const err = new EqupoError('Not found', 404);
  assert.equal(err.status, 404);
});

test('EqupoError accepts details array', () => {
  const details = [{ path: 'name', message: 'Required' }];
  const err = new EqupoError('Invalid body', 400, details);
  assert.deepEqual(err.details, details);
});

test('EqupoError details is undefined when not provided', () => {
  const err = new EqupoError('Error');
  assert.equal(err.details, undefined);
});

test('EqupoError name is ValidationError', () => {
  const err = new EqupoError('Error');
  assert.equal(err.name, 'ValidationError');
});
