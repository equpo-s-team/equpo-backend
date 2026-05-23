import test from 'node:test';
import assert from 'node:assert/strict';
import { grantTaskCompletionRewards } from '../../../dist/domains/task/helpers/grantTaskCompletionRewards.js';
import { makeSequentialClient } from '../../helpers/mockClient.js';

// Mock responses for the 9 achievement checkers run inside grantTaskCompletionRewards.
// Each checker's first query is getAchievementId — returning rowCount:0 short-circuits
// the checker before any DB write or Firestore call occurs.
const NINE_NULL_ACHIEVEMENT_IDS = Array(9).fill({ rowCount: 0, rows: [] });

const TEAM_ID = 'team-id-1';
const TASK_ID = 'task-id-1';
const ACTOR_UID = 'uid-actor';

test('grantTaskCompletionRewards: unassigned high-priority task grants XP 60 to actor', async () => {
  // Queries in order:
  // 1. UPDATE user (RETURNING experience_points, level, virtual_currency)
  // 2. UPDATE team_membership (RETURNING virtual_currency)
  // 3. UPDATE team
  // 4-12. 9 × getAchievementId → null (short-circuit)
  const responses = [
    { rowCount: 1, rows: [{ experience_points: 60, level: 0, virtual_currency: 10 }] },
    { rowCount: 1, rows: [{ virtual_currency: 10 }] },
    { rowCount: 1, rows: [] },
    ...NINE_NULL_ACHIEVEMENT_IDS,
  ];

  const client = makeSequentialClient(responses);
  const result = await grantTaskCompletionRewards({
    client,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    actorUid: ACTOR_UID,
    taskPriority: 'high',
    assignedUserUid: null,
    assignedGroupId: null,
  });

  assert.equal(result.xpReward.xpGained, 60);
  assert.equal(result.xpReward.leveledUp, false);
  assert.equal(result.xpReward.recipients.length, 1);
  assert.equal(result.xpReward.recipients[0].uid, ACTOR_UID);
  assert.deepEqual(result.unlockedAchievements, []);
});

test('grantTaskCompletionRewards: medium-priority task grants XP 30', async () => {
  const responses = [
    { rowCount: 1, rows: [{ experience_points: 30, level: 0, virtual_currency: 8 }] },
    { rowCount: 1, rows: [{ virtual_currency: 8 }] },
    { rowCount: 1, rows: [] },
    ...NINE_NULL_ACHIEVEMENT_IDS,
  ];

  const client = makeSequentialClient(responses);
  const result = await grantTaskCompletionRewards({
    client,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    actorUid: ACTOR_UID,
    taskPriority: 'medium',
    assignedUserUid: null,
    assignedGroupId: null,
  });

  assert.equal(result.xpReward.xpGained, 30);
});

test('grantTaskCompletionRewards: level-up sets leveledUp=true', async () => {
  // XP total = 150 → calculateLevel(150) = 1, old level = 0 → leveledUp
  const responses = [
    { rowCount: 1, rows: [{ experience_points: 150, level: 0, virtual_currency: 10 }] },
    { rowCount: 1, rows: [] }, // UPDATE user level
    { rowCount: 1, rows: [{ virtual_currency: 10 }] },
    { rowCount: 1, rows: [] },
    ...NINE_NULL_ACHIEVEMENT_IDS,
  ];

  const client = makeSequentialClient(responses);
  const result = await grantTaskCompletionRewards({
    client,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    actorUid: ACTOR_UID,
    taskPriority: 'high',
    assignedUserUid: null,
    assignedGroupId: null,
  });

  assert.equal(result.xpReward.leveledUp, true);
});

test('grantTaskCompletionRewards: task with assigned user grants XP to assignee', async () => {
  const ASSIGNED_UID = 'uid-assigned';
  // Queries:
  // 1. UPDATE user for ASSIGNED_UID
  // 2. UPDATE team_membership for ASSIGNED_UID
  // 3. UPDATE team
  // 4-12. 9 achievement ID queries → null
  const responses = [
    { rowCount: 1, rows: [{ experience_points: 60, level: 0, virtual_currency: 10 }] },
    { rowCount: 1, rows: [{ virtual_currency: 10 }] },
    { rowCount: 1, rows: [] },
    ...NINE_NULL_ACHIEVEMENT_IDS,
  ];

  const client = makeSequentialClient(responses);
  const result = await grantTaskCompletionRewards({
    client,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    actorUid: ACTOR_UID,
    taskPriority: 'high',
    assignedUserUid: ASSIGNED_UID,
    assignedGroupId: null,
  });

  assert.equal(result.xpReward.recipients.length, 1);
  assert.equal(result.xpReward.recipients[0].uid, ASSIGNED_UID);
  assert.equal(result.xpReward.xpGained, 60);
});

test('grantTaskCompletionRewards: task with group distributes XP to 2 members', async () => {
  const GROUP_ID = 'group-id-1';
  // Queries:
  // 1. SELECT group_membership WHERE group_id = GROUP_ID → 2 members
  // 2. UPDATE user for member-1
  // 3. UPDATE team_membership for member-1
  // 4. UPDATE user for member-2
  // 5. UPDATE team_membership for member-2
  // 6. UPDATE team
  // 7-15. 9 achievement ID queries → null (actorUid is actor, but no actorResult found — uses first recipient)
  const responses = [
    { rowCount: 2, rows: [{ user_uid: 'member-1' }, { user_uid: 'member-2' }] },
    { rowCount: 1, rows: [{ experience_points: 60, level: 0, virtual_currency: 10 }] },
    { rowCount: 1, rows: [{ virtual_currency: 10 }] },
    { rowCount: 1, rows: [{ experience_points: 60, level: 0, virtual_currency: 10 }] },
    { rowCount: 1, rows: [{ virtual_currency: 10 }] },
    { rowCount: 1, rows: [] },
    ...NINE_NULL_ACHIEVEMENT_IDS,
  ];

  const client = makeSequentialClient(responses);
  const result = await grantTaskCompletionRewards({
    client,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    actorUid: ACTOR_UID,
    taskPriority: 'high',
    assignedUserUid: null,
    assignedGroupId: GROUP_ID,
  });

  assert.equal(result.xpReward.recipients.length, 2);
  assert.deepEqual(result.unlockedAchievements, []);
});
