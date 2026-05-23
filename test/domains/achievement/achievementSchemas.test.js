import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../../../dist/utils/assertBody.js';
import {
  createAchievementSchema,
  unlockAchievementSchema,
} from '../../../dist/domains/achievement/schemas/createAchievementSchema.js';

// ─── createAchievementSchema ──────────────────────────────────────────────────

test('createAchievementSchema validates minimal payload', () => {
  const parsed = assertBody(createAchievementSchema, { name: 'First Step' });
  assert.equal(parsed.name, 'First Step');
});

test('createAchievementSchema accepts optional description and iconURL', () => {
  const parsed = assertBody(createAchievementSchema, {
    name: 'Champion',
    description: 'Win 10 tasks',
    iconURL: 'https://example.com/icon.png',
  });
  assert.equal(parsed.description, 'Win 10 tasks');
  assert.equal(parsed.iconURL, 'https://example.com/icon.png');
});

test('createAchievementSchema rejects empty name', () => {
  assert.throws(() => assertBody(createAchievementSchema, { name: '' }));
});

test('createAchievementSchema rejects name longer than 120 chars', () => {
  assert.throws(() =>
    assertBody(createAchievementSchema, { name: 'a'.repeat(121) })
  );
});

test('createAchievementSchema rejects invalid iconURL', () => {
  assert.throws(() =>
    assertBody(createAchievementSchema, { name: 'Test', iconURL: 'not-a-url' })
  );
});

test('createAchievementSchema accepts null description and iconURL', () => {
  const parsed = assertBody(createAchievementSchema, {
    name: 'Test',
    description: null,
    iconURL: null,
  });
  assert.equal(parsed.description, null);
  assert.equal(parsed.iconURL, null);
});

// ─── unlockAchievementSchema ──────────────────────────────────────────────────

test('unlockAchievementSchema validates required fields', () => {
  const parsed = assertBody(unlockAchievementSchema, {
    userUid: 'user-123',
    achievementId: '550e8400-e29b-41d4-a716-446655440001',
  });
  assert.equal(parsed.userUid, 'user-123');
  assert.equal(parsed.achievementId, '550e8400-e29b-41d4-a716-446655440001');
});

test('unlockAchievementSchema rejects non-UUID achievementId', () => {
  assert.throws(() =>
    assertBody(unlockAchievementSchema, {
      userUid: 'user-123',
      achievementId: 'not-a-uuid',
    })
  );
});

test('unlockAchievementSchema accepts optional unlockedAt datetime', () => {
  const parsed = assertBody(unlockAchievementSchema, {
    userUid: 'user-123',
    achievementId: '550e8400-e29b-41d4-a716-446655440001',
    unlockedAt: '2026-05-01T10:00:00.000Z',
  });
  assert.equal(parsed.unlockedAt, '2026-05-01T10:00:00.000Z');
});
