import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../../../dist/utils/assertBody.js';
import {
  createTaskStepSchema,
  toggleTaskStepSchema,
  updateTaskStepSchema,
  taskStepParam,
} from '../../../dist/domains/task/schemas/taskStepSchemas.js';

// ─── createTaskStepSchema ─────────────────────────────────────────────────────

test('createTaskStepSchema validates step string', () => {
  const parsed = assertBody(createTaskStepSchema, { step: 'Write unit tests' });
  assert.equal(parsed.step, 'Write unit tests');
});

test('createTaskStepSchema rejects empty step', () => {
  assert.throws(() => assertBody(createTaskStepSchema, { step: '' }));
});

test('createTaskStepSchema rejects step longer than 200 chars', () => {
  assert.throws(() =>
    assertBody(createTaskStepSchema, { step: 'x'.repeat(201) })
  );
});

// ─── toggleTaskStepSchema ─────────────────────────────────────────────────────

test('toggleTaskStepSchema validates isDone true', () => {
  const parsed = assertBody(toggleTaskStepSchema, { isDone: true });
  assert.equal(parsed.isDone, true);
});

test('toggleTaskStepSchema validates isDone false', () => {
  const parsed = assertBody(toggleTaskStepSchema, { isDone: false });
  assert.equal(parsed.isDone, false);
});

test('toggleTaskStepSchema rejects non-boolean isDone', () => {
  assert.throws(() => assertBody(toggleTaskStepSchema, { isDone: 'yes' }));
});

// ─── updateTaskStepSchema ─────────────────────────────────────────────────────

test('updateTaskStepSchema validates step string', () => {
  const parsed = assertBody(updateTaskStepSchema, { step: 'Updated step text' });
  assert.equal(parsed.step, 'Updated step text');
});

// ─── taskStepParam ────────────────────────────────────────────────────────────

test('taskStepParam validates teamId, taskId UUIDs and stepId', () => {
  const parsed = taskStepParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    taskId: '550e8400-e29b-41d4-a716-446655440002',
    stepId: 'step-abc-123',
  });
  assert.equal(parsed.stepId, 'step-abc-123');
});

test('taskStepParam rejects empty stepId', () => {
  assert.throws(() =>
    taskStepParam.parse({
      teamId: '550e8400-e29b-41d4-a716-446655440001',
      taskId: '550e8400-e29b-41d4-a716-446655440002',
      stepId: '',
    })
  );
});
