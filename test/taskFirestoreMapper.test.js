import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskFirestoreDocument } from '../dist/domains/task/firestore/taskFirestoreMapper.js';

test('buildTaskFirestoreDocument maps backend task shape to Firestore payload', () => {
  const payload = buildTaskFirestoreDocument({
    taskId: '550e8400-e29b-41d4-a716-446655440002',
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Prepare release',
    description: 'Coordinate checklist with QA',
    dueDate: '2026-05-01T10:00:00.000Z',
    priority: 'high',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
    category: ['backend', 'qa'],
    status: 'todo',
    isRecurring: false,
    recurringInterval: null,
    assignedUserId: 'uid_123',
    assignedGroup: null,
  });

  assert.equal(payload.name, 'Prepare release');
  assert.equal(payload.description, 'Coordinate checklist with QA');
  assert.equal(payload.priority, 'high');
  assert.deepEqual(payload.category, ['backend', 'qa']);
  assert.equal(payload.assignedUserId, 'uid_123');
  assert.ok(payload.dueDate instanceof Date);
  assert.ok(payload.createdAt instanceof Date);
  assert.ok(payload.updatedAt instanceof Date);
  assert.equal(Object.hasOwn(payload, 'teamId'), false);
});

test('buildTaskFirestoreDocument throws on invalid date input', () => {
  assert.throws(() => {
    buildTaskFirestoreDocument({
      taskId: '550e8400-e29b-41d4-a716-446655440002',
      teamId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Invalid date task',
      description: null,
      dueDate: 'not-a-date',
      priority: 'low',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-02T10:00:00.000Z',
      category: [],
      status: 'todo',
      isRecurring: false,
      recurringInterval: null,
      assignedUserId: null,
      assignedGroup: null,
    });
  });
});

test('buildTaskFirestoreDocument omits name and description when not provided', () => {
  const payload = buildTaskFirestoreDocument({
    taskId: '550e8400-e29b-41d4-a716-446655440002',
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    dueDate: '2026-05-01T10:00:00.000Z',
    priority: 'medium',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
    category: ['api'],
    status: 'in-progress',
    isRecurring: false,
    recurringInterval: null,
    assignedUserId: null,
    assignedGroup: null,
  });

  assert.equal(Object.hasOwn(payload, 'name'), false);
  assert.equal(Object.hasOwn(payload, 'description'), false);
});




