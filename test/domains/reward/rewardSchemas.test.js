import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../../../dist/utils/assertBody.js';
import { createRewardSchema } from '../../../dist/domains/reward/schemas/createRewardSchema.js';
import { updateRewardSchema } from '../../../dist/domains/reward/schemas/updateRewardSchema.js';
import {
  rewardIdParam,
  redeemMemberRewardParam,
} from '../../../dist/domains/reward/schemas/rewardIdParam.js';
import { createSystemUserRewardSchema } from '../../../dist/domains/reward/schemas/createSystemUserRewardSchema.js';

// ─── createRewardSchema ───────────────────────────────────────────────────────

test('createRewardSchema validates full payload', () => {
  const parsed = assertBody(createRewardSchema, {
    name: 'Gold Badge',
    cost: 100,
    experienceGranted: 50,
    type: 'team',
    description: 'Awarded to top teams',
    iconURL: 'https://example.com/badge.png',
  });
  assert.equal(parsed.name, 'Gold Badge');
  assert.equal(parsed.type, 'team');
});

test('createRewardSchema validates member type', () => {
  const parsed = assertBody(createRewardSchema, {
    name: 'Silver Badge',
    cost: 50,
    experienceGranted: 25,
    type: 'member',
  });
  assert.equal(parsed.type, 'member');
});

test('createRewardSchema rejects invalid type', () => {
  assert.throws(() =>
    assertBody(createRewardSchema, {
      name: 'Badge',
      cost: 0,
      experienceGranted: 0,
      type: 'admin',
    })
  );
});

test('createRewardSchema rejects negative cost', () => {
  assert.throws(() =>
    assertBody(createRewardSchema, {
      name: 'Badge',
      cost: -1,
      experienceGranted: 0,
      type: 'team',
    })
  );
});

// ─── updateRewardSchema ───────────────────────────────────────────────────────

test('updateRewardSchema allows partial update', () => {
  const parsed = assertBody(updateRewardSchema, { name: 'Updated Name' });
  assert.equal(parsed.name, 'Updated Name');
});

test('updateRewardSchema accepts null description and iconURL', () => {
  const parsed = assertBody(updateRewardSchema, {
    description: null,
    iconURL: null,
  });
  assert.equal(parsed.description, null);
  assert.equal(parsed.iconURL, null);
});

test('updateRewardSchema rejects name longer than 120 chars', () => {
  assert.throws(() => assertBody(updateRewardSchema, { name: 'a'.repeat(121) }));
});

// ─── rewardIdParam ────────────────────────────────────────────────────────────

test('rewardIdParam validates UUIDs', () => {
  const parsed = rewardIdParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    rewardId: '550e8400-e29b-41d4-a716-446655440002',
  });
  assert.equal(parsed.rewardId, '550e8400-e29b-41d4-a716-446655440002');
});

test('rewardIdParam rejects non-UUID rewardId', () => {
  assert.throws(() =>
    rewardIdParam.parse({
      teamId: '550e8400-e29b-41d4-a716-446655440001',
      rewardId: 'not-uuid',
    })
  );
});

test('redeemMemberRewardParam validates UUIDs and userUid', () => {
  const parsed = redeemMemberRewardParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    userUid: 'firebase-uid',
    rewardId: '550e8400-e29b-41d4-a716-446655440002',
  });
  assert.equal(parsed.userUid, 'firebase-uid');
});

// ─── createSystemUserRewardSchema ─────────────────────────────────────────────

test('createSystemUserRewardSchema validates UUID rewardId', () => {
  const parsed = assertBody(createSystemUserRewardSchema, {
    rewardId: '550e8400-e29b-41d4-a716-446655440001',
  });
  assert.equal(parsed.rewardId, '550e8400-e29b-41d4-a716-446655440001');
});

test('createSystemUserRewardSchema rejects non-UUID rewardId', () => {
  assert.throws(() =>
    assertBody(createSystemUserRewardSchema, { rewardId: 'bad' })
  );
});

test('createSystemUserRewardSchema accepts optional dateObtained', () => {
  const parsed = assertBody(createSystemUserRewardSchema, {
    rewardId: '550e8400-e29b-41d4-a716-446655440001',
    dateObtained: '2026-05-01T10:00:00.000Z',
  });
  assert.equal(parsed.dateObtained, '2026-05-01T10:00:00.000Z');
});
