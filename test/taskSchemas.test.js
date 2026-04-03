import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../dist/utils/assertBody.js';
import { createTaskSchema } from '../dist/domains/task/schemas/createTaskSchema.js';
import { updateTaskSchema } from '../dist/domains/task/schemas/updateTaskSchema.js';
import {
  taskListPaginationQuery,
  teamTaskParam,
} from '../dist/domains/task/schemas/params.js';

test('createTaskSchema validates a full valid payload', () => {
  const parsed = assertBody(createTaskSchema, {
    dueDate: '2026-05-01T10:00:00.000Z',
    priority: 'high',
    status: 'todo',
    categories: ['backend', 'api'],
    isRecurring: true,
    recurringInterval: 'weeks',
    assignedUserUid: 'uid_123',
    assignedGroupId: '550e8400-e29b-41d4-a716-446655440000',
  });

  assert.equal(parsed.priority, 'high');
  assert.equal(parsed.status, 'todo');
  assert.equal(parsed.recurringInterval, 'weeks');
  assert.deepEqual(parsed.categories, ['backend', 'api']);
});

test('createTaskSchema rejects invalid priority', () => {
  assert.throws(() => {
    assertBody(createTaskSchema, {
      dueDate: '2026-05-01T10:00:00.000Z',
      priority: 'urgent',
      status: 'todo',
    });
  });
});

test('createTaskSchema rejects invalid status', () => {
  assert.throws(() => {
    assertBody(createTaskSchema, {
      dueDate: '2026-05-01T10:00:00.000Z',
      priority: 'low',
      status: 'blocked',
    });
  });
});

test('createTaskSchema rejects any category longer than 12 chars', () => {
  assert.throws(() => {
    assertBody(createTaskSchema, {
      dueDate: '2026-05-01T10:00:00.000Z',
      priority: 'medium',
      status: 'in-progress',
      categories: ['this-is-way-too-long'],
    });
  });
});

test('updateTaskSchema allows categories array and nullable recurringInterval', () => {
  const parsed = assertBody(updateTaskSchema, {
    categories: ['ux', 'qa'],
    recurringInterval: null,
    status: 'done',
  });

  assert.deepEqual(parsed.categories, ['ux', 'qa']);
  assert.equal(parsed.recurringInterval, null);
  assert.equal(parsed.status, 'done');
});

test('updateTaskSchema rejects invalid recurring interval', () => {
  assert.throws(() => {
    assertBody(updateTaskSchema, {
      recurringInterval: 'years',
    });
  });
});

test('taskListPaginationQuery sets defaults when query is empty', () => {
  const parsed = taskListPaginationQuery.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 100);
});

test('taskListPaginationQuery parses numeric query strings', () => {
  const parsed = taskListPaginationQuery.parse({ page: '2', limit: '200' });
  assert.equal(parsed.page, 2);
  assert.equal(parsed.limit, 200);
});

test('taskListPaginationQuery rejects limit above 200', () => {
  assert.throws(() => {
    taskListPaginationQuery.parse({ page: '1', limit: '201' });
  });
});

test('taskListPaginationQuery rejects page below 1', () => {
  assert.throws(() => {
    taskListPaginationQuery.parse({ page: '0', limit: '100' });
  });
});

test('teamTaskParam validates UUID params', () => {
  const parsed = teamTaskParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    taskId: '550e8400-e29b-41d4-a716-446655440002',
  });

  assert.equal(parsed.teamId, '550e8400-e29b-41d4-a716-446655440001');
});

test('teamTaskParam rejects non-UUID taskId', () => {
  assert.throws(() => {
    teamTaskParam.parse({
      teamId: '550e8400-e29b-41d4-a716-446655440001',
      taskId: 'task-1',
    });
  });
});

