import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { assertBody } from '../../dist/utils/assertBody.js';
import { EqupoError } from '../../dist/types/EqupoError.js';

const nameSchema = z.object({ name: z.string().min(1) });

test('assertBody returns parsed data on valid input', () => {
  const result = assertBody(nameSchema, { name: 'Alice' });
  assert.equal(result.name, 'Alice');
});

test('assertBody throws EqupoError with status 400 on invalid input', () => {
  assert.throws(
    () => assertBody(nameSchema, { name: '' }),
    err => err instanceof EqupoError && err.status === 400
  );
});

test('assertBody throws EqupoError with details array on validation failure', () => {
  let caught;
  try {
    assertBody(nameSchema, { name: '' });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof EqupoError);
  assert.ok(Array.isArray(caught.details));
  assert.ok(caught.details.length > 0);
  assert.ok(typeof caught.details[0].path === 'string');
  assert.ok(typeof caught.details[0].message === 'string');
});

test('assertBody throws EqupoError when required field is missing', () => {
  assert.throws(
    () => assertBody(nameSchema, {}),
    err => err instanceof EqupoError
  );
});
