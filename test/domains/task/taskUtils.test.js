import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDueDate,
  normalizeCategories,
  toReportPriorityLabel,
  getReportDateRange,
  fetchAllStepsForTask,
  fetchAllCommentariesForTask,
  getReportsKpi,
  assertTaskAssignmentsWithinTeam,
  getReportsMembers,
  getReportsOverdueTasks,
} from '../../../dist/domains/task/utils.js';
import { EqupoError } from '../../../dist/types/EqupoError.js';
import { makeSequentialClient } from '../../helpers/mockClient.js';

// ─── advanceDueDate ───────────────────────────────────────────────────────────

test('advanceDueDate returns unchanged date when it is in the future', () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = advanceDueDate(futureDate, 'days', 1);
  assert.equal(result.toISOString(), futureDate);
});

test('advanceDueDate advances past date by days until future', () => {
  const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const result = advanceDueDate(pastDate, 'days', 3);
  assert.ok(result > new Date());
});

test('advanceDueDate advances past date by weeks until future', () => {
  const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = advanceDueDate(pastDate, 'weeks', 2);
  assert.ok(result > new Date());
});

test('advanceDueDate advances past date by months until future', () => {
  const pastDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const result = advanceDueDate(pastDate, 'months', 1);
  assert.ok(result > new Date());
});

test('advanceDueDate advances past date by years until future', () => {
  const pastDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const result = advanceDueDate(pastDate, 'years', 1);
  assert.ok(result > new Date());
});

test('advanceDueDate falls back to +1 day for invalid interval', () => {
  // 2.5 days ago → 3 iterations of +1 day → result is ~0.5 days in the future
  const pastDate = new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000).toISOString();
  const result = advanceDueDate(pastDate, 'unknown-interval', 1);
  assert.ok(result > new Date());
});

// ─── normalizeCategories ──────────────────────────────────────────────────────

test('normalizeCategories returns empty array for undefined', () => {
  assert.deepEqual(normalizeCategories(undefined), []);
});

test('normalizeCategories returns empty array for empty array', () => {
  assert.deepEqual(normalizeCategories([]), []);
});

test('normalizeCategories deduplicates case-insensitively', () => {
  const result = normalizeCategories(['Backend', 'backend', 'BACKEND']);
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Backend');
});

test('normalizeCategories trims whitespace', () => {
  const result = normalizeCategories(['  api  ', 'qa']);
  assert.deepEqual(result, ['api', 'qa']);
});

test('normalizeCategories removes empty strings after trimming', () => {
  const result = normalizeCategories(['valid', '   ', '']);
  assert.deepEqual(result, ['valid']);
});

test('normalizeCategories preserves order of first occurrence', () => {
  const result = normalizeCategories(['c', 'a', 'b', 'a', 'c']);
  assert.deepEqual(result, ['c', 'a', 'b']);
});

// ─── toReportPriorityLabel ────────────────────────────────────────────────────

test('toReportPriorityLabel maps high to Alta', () => {
  assert.equal(toReportPriorityLabel('high'), 'Alta');
});

test('toReportPriorityLabel maps low to Baja', () => {
  assert.equal(toReportPriorityLabel('low'), 'Baja');
});

test('toReportPriorityLabel maps medium and unknown to Media', () => {
  assert.equal(toReportPriorityLabel('medium'), 'Media');
  assert.equal(toReportPriorityLabel('unknown'), 'Media');
});

// ─── getReportDateRange ───────────────────────────────────────────────────────

test('getReportDateRange returns rangeStart and rangeEnd', () => {
  const { rangeStart, rangeEnd } = getReportDateRange(30);
  assert.ok(rangeStart instanceof Date);
  assert.ok(rangeEnd instanceof Date);
  assert.ok(rangeEnd > rangeStart);
});

test('getReportDateRange rangeStart is approximately days ago', () => {
  const { rangeStart } = getReportDateRange(7);
  const expectedStart = new Date();
  expectedStart.setDate(expectedStart.getDate() - 7);
  // Allow 1 second tolerance
  assert.ok(Math.abs(rangeStart.getTime() - expectedStart.getTime()) < 1000);
});

// ─── fetchAllStepsForTask (mock PoolClient) ───────────────────────────────────

test('fetchAllStepsForTask returns rows from DB', async () => {
  const mockRows = [
    { step: 'Step 1', isDone: false, position: 1, createdAt: new Date(), updatedAt: new Date() },
    { step: 'Step 2', isDone: true, position: 2, createdAt: new Date(), updatedAt: new Date() },
  ];
  const client = makeSequentialClient([{ rowCount: 2, rows: mockRows }]);
  const result = await fetchAllStepsForTask(client, 'task-id-1');
  assert.equal(result.length, 2);
  assert.equal(result[0].step, 'Step 1');
  assert.equal(result[1].isDone, true);
});

test('fetchAllStepsForTask returns empty array when no steps', async () => {
  const client = makeSequentialClient([{ rowCount: 0, rows: [] }]);
  const result = await fetchAllStepsForTask(client, 'task-id-2');
  assert.deepEqual(result, []);
});

// ─── fetchAllCommentariesForTask (mock PoolClient) ───────────────────────────

test('fetchAllCommentariesForTask returns rows from DB', async () => {
  const mockRows = [
    { userUid: 'uid-1', commentary: 'Great work!', createdAt: new Date(), updatedAt: new Date() },
  ];
  const client = makeSequentialClient([{ rowCount: 1, rows: mockRows }]);
  const result = await fetchAllCommentariesForTask(client, 'task-id-1');
  assert.equal(result.length, 1);
  assert.equal(result[0].commentary, 'Great work!');
});

// ─── getReportsKpi (mock PoolClient) ─────────────────────────────────────────

test('getReportsKpi returns KPI object from DB', async () => {
  const kpiRow = { todo: 2, progress: 1, qa: 0, done: 5, overdue: 1, total: 9 };
  const client = makeSequentialClient([{ rowCount: 1, rows: [kpiRow] }]);
  const result = await getReportsKpi(
    client,
    'team-1',
    new Date('2026-01-01'),
    new Date('2026-12-31')
  );
  assert.equal(result.done, 5);
  assert.equal(result.total, 9);
  assert.equal(result.overdue, 1);
});

// ─── assertTaskAssignmentsWithinTeam (mock PoolClient) ───────────────────────

test('assertTaskAssignmentsWithinTeam passes when assignedUserUid is a team leader', async () => {
  // assertUserBelongsToTeam: leader check → rowCount:1 (user is leader)
  const client = makeSequentialClient([{ rowCount: 1, rows: [] }]);
  await assert.doesNotReject(() =>
    assertTaskAssignmentsWithinTeam(client, 'team-1', 'uid-leader', null)
  );
});

test('assertTaskAssignmentsWithinTeam passes when assignedGroupId belongs to team', async () => {
  // assertGroupBelongsToTeam: rowCount:1
  const client = makeSequentialClient([{ rowCount: 1, rows: [] }]);
  await assert.doesNotReject(() =>
    assertTaskAssignmentsWithinTeam(client, 'team-1', null, 'group-1')
  );
});

test('assertTaskAssignmentsWithinTeam passes when neither uid nor group is provided', async () => {
  const client = makeSequentialClient([]);
  await assert.doesNotReject(() =>
    assertTaskAssignmentsWithinTeam(client, 'team-1', null, null)
  );
});

test('assertTaskAssignmentsWithinTeam throws when assignedUserUid is not in team', async () => {
  // leader check → rowCount:0, membership check → rowCount:0 → throws 400
  const client = makeSequentialClient([
    { rowCount: 0, rows: [] },
    { rowCount: 0, rows: [] },
  ]);
  await assert.rejects(
    () => assertTaskAssignmentsWithinTeam(client, 'team-1', 'uid-stranger', null),
    err => err instanceof EqupoError && err.status === 400
  );
});

// ─── getReportsMembers (mock PoolClient) ──────────────────────────────────────

test('getReportsMembers returns member stats from DB', async () => {
  const memberRows = [
    { uid: 'uid-1', displayName: 'Alice', role: 'member', total: 5, completed: 3 },
    { uid: 'uid-2', displayName: null, role: 'collaborator', total: 0, completed: 0 },
  ];
  const client = makeSequentialClient([{ rowCount: 2, rows: memberRows }]);
  const result = await getReportsMembers(
    client,
    'team-1',
    new Date('2026-01-01'),
    new Date('2026-12-31')
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].uid, 'uid-1');
  assert.equal(result[0].completionRate, 60);
  assert.equal(result[1].displayName, null);
  assert.equal(result[1].completionRate, 0);
});

test('getReportsMembers returns empty array when no members', async () => {
  const client = makeSequentialClient([{ rowCount: 0, rows: [] }]);
  const result = await getReportsMembers(
    client,
    'team-1',
    new Date('2026-01-01'),
    new Date('2026-12-31')
  );
  assert.deepEqual(result, []);
});

// ─── getReportsOverdueTasks (mock PoolClient) ─────────────────────────────────

test('getReportsOverdueTasks returns overdue task list from DB', async () => {
  const taskRows = [
    {
      taskId: 'task-1',
      status: 'in-progress',
      priority: 'high',
      dueDate: '2026-04-01T00:00:00Z',
      daysOverdue: 5,
      categories: ['backend'],
      assignedUsers: [{ uid: 'uid-1', displayName: 'Alice' }],
      assignee: 'Alice',
    },
  ];
  const client = makeSequentialClient([{ rowCount: 1, rows: taskRows }]);
  const result = await getReportsOverdueTasks(
    client,
    'team-1',
    new Date('2026-01-01'),
    new Date('2026-12-31'),
    50
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].taskId, 'task-1');
  assert.equal(result[0].priorityLabel, 'Alta');
  assert.equal(result[0].daysOverdue, 5);
});

test('getReportsOverdueTasks returns empty array when no overdue tasks', async () => {
  const client = makeSequentialClient([{ rowCount: 0, rows: [] }]);
  const result = await getReportsOverdueTasks(
    client,
    'team-1',
    new Date('2026-01-01'),
    new Date('2026-12-31'),
    50
  );
  assert.deepEqual(result, []);
});
