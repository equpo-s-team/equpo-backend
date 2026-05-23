import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEnvironmentHealth,
  checkAchievementsOnTaskComplete,
} from '../../../dist/domains/achievement/achievementChecker.js';
import { makeSequentialClient } from '../../helpers/mockClient.js';

// ─── computeEnvironmentHealth ─────────────────────────────────────────────────

test('computeEnvironmentHealth returns 60 when no tasks', () => {
  assert.equal(computeEnvironmentHealth(0, 0, 0), 60);
});

test('computeEnvironmentHealth returns 100 when all tasks done', () => {
  assert.equal(computeEnvironmentHealth(10, 10, 0), 100);
});

test('computeEnvironmentHealth returns 0 when heavily overdue', () => {
  assert.equal(computeEnvironmentHealth(10, 0, 10), 0);
});

test('computeEnvironmentHealth clamps result to [0, 100]', () => {
  const health = computeEnvironmentHealth(10, 10, 10);
  assert.ok(health >= 0);
  assert.ok(health <= 100);
});

test('computeEnvironmentHealth applies formula: 60 + completedPct - overduePct*2', () => {
  // 5 done / 10 total = 50% completed, 2 overdue / 10 total = 20% overdue
  // health = 60 + 50 - 20*2 = 60 + 50 - 40 = 70
  assert.equal(computeEnvironmentHealth(10, 5, 2), 70);
});

test('computeEnvironmentHealth rounds to integer', () => {
  const health = computeEnvironmentHealth(3, 1, 0);
  assert.equal(health, Math.round(health));
});

// ─── checkAchievementsOnTaskComplete ─────────────────────────────────────────
//
// Strategy: mock all 9 achievement ID lookups to return rowCount: 0 so every
// checker short-circuits before any DB write or Firestore call.

test('checkAchievementsOnTaskComplete returns empty array when no achievements are seeded', async () => {
  // 9 checkers run in parallel; each first query is getAchievementId → null
  const mockClient = makeSequentialClient(Array(9).fill({ rowCount: 0, rows: [] }));

  const result = await checkAchievementsOnTaskComplete({
    client: mockClient,
    userUid: 'uid-actor',
    teamId: 'team-1',
    taskId: 'task-1',
    newLevel: 0,
    assignedUserUid: null,
    assignedGroupId: null,
  });

  assert.deepEqual(result, []);
});

test('checkAchievementsOnTaskComplete returns empty array when all achievements already unlocked', async () => {
  // Each checker: getAchievementId → id found, isNotUnlocked → false (already unlocked)
  // 9 checkers × 2 queries each = 18 queries
  const pair = [
    { rowCount: 1, rows: [{ id: 'ach-id' }] },
    { rowCount: 1, rows: [] }, // isNotUnlocked returns rowCount:1 → meaning it IS already unlocked
  ];
  const responses = Array(9).fill(pair).flat();
  const mockClient = makeSequentialClient(responses);

  const result = await checkAchievementsOnTaskComplete({
    client: mockClient,
    userUid: 'uid-actor',
    teamId: 'team-1',
    taskId: 'task-1',
    newLevel: 0,
    assignedUserUid: null,
    assignedGroupId: null,
  });

  assert.deepEqual(result, []);
});
