import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../../../dist/utils/assertBody.js';
import {
  createTaskCommentarySchema,
  updateTaskCommentarySchema,
  taskCommentaryParam,
} from '../../../dist/domains/task/schemas/taskCommentarySchemas.js';

// ─── createTaskCommentarySchema ───────────────────────────────────────────────

test('createTaskCommentarySchema validates non-empty commentary', () => {
  const parsed = assertBody(createTaskCommentarySchema, {
    commentary: 'Looking good!',
  });
  assert.equal(parsed.commentary, 'Looking good!');
});

test('createTaskCommentarySchema rejects empty commentary', () => {
  assert.throws(() => assertBody(createTaskCommentarySchema, { commentary: '' }));
});

test('createTaskCommentarySchema rejects commentary longer than 500 chars', () => {
  assert.throws(() =>
    assertBody(createTaskCommentarySchema, { commentary: 'x'.repeat(501) })
  );
});

// ─── updateTaskCommentarySchema ───────────────────────────────────────────────

test('updateTaskCommentarySchema validates non-empty commentary', () => {
  const parsed = assertBody(updateTaskCommentarySchema, {
    commentary: 'Updated comment',
  });
  assert.equal(parsed.commentary, 'Updated comment');
});

test('updateTaskCommentarySchema rejects empty commentary', () => {
  assert.throws(() =>
    assertBody(updateTaskCommentarySchema, { commentary: '' })
  );
});

// ─── taskCommentaryParam ──────────────────────────────────────────────────────

test('taskCommentaryParam validates teamId, taskId UUIDs and commentaryId', () => {
  const parsed = taskCommentaryParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    taskId: '550e8400-e29b-41d4-a716-446655440002',
    commentaryId: 'commentary-id-123',
  });
  assert.equal(parsed.commentaryId, 'commentary-id-123');
});

test('taskCommentaryParam rejects non-UUID teamId', () => {
  assert.throws(() =>
    taskCommentaryParam.parse({
      teamId: 'bad',
      taskId: '550e8400-e29b-41d4-a716-446655440002',
      commentaryId: 'c-123',
    })
  );
});
