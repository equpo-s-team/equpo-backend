import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../../../dist/utils/assertBody.js';
import {
  zegoTokenParam,
  createGroupSchema,
  addGroupMembersSchema,
  groupIdParam,
  updateGroupSchema,
} from '../../../dist/domains/room/schemas/roomSchemas.js';

// ─── zegoTokenParam ───────────────────────────────────────────────────────────

test('zegoTokenParam validates teamId UUID and roomId string', () => {
  const parsed = zegoTokenParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    roomId: 'room-abc-123',
  });
  assert.equal(parsed.roomId, 'room-abc-123');
});

test('zegoTokenParam rejects non-UUID teamId', () => {
  assert.throws(() =>
    zegoTokenParam.parse({ teamId: 'bad', roomId: 'room-1' })
  );
});

test('zegoTokenParam rejects empty roomId', () => {
  assert.throws(() =>
    zegoTokenParam.parse({ teamId: '550e8400-e29b-41d4-a716-446655440001', roomId: '' })
  );
});

// ─── createGroupSchema ────────────────────────────────────────────────────────

test('createGroupSchema validates name', () => {
  const parsed = assertBody(createGroupSchema, { name: 'Dev Team' });
  assert.equal(parsed.name, 'Dev Team');
});

test('createGroupSchema accepts optional memberUids and photoUrl', () => {
  const parsed = assertBody(createGroupSchema, {
    name: 'Design',
    memberUids: ['uid-1', 'uid-2'],
    photoUrl: 'https://example.com/photo.jpg',
  });
  assert.deepEqual(parsed.memberUids, ['uid-1', 'uid-2']);
});

test('createGroupSchema rejects empty name', () => {
  assert.throws(() => assertBody(createGroupSchema, { name: '' }));
});

test('createGroupSchema rejects memberUids array above 40', () => {
  assert.throws(() =>
    assertBody(createGroupSchema, {
      name: 'Group',
      memberUids: Array(41).fill('uid'),
    })
  );
});

// ─── addGroupMembersSchema ────────────────────────────────────────────────────

test('addGroupMembersSchema requires at least 1 member', () => {
  const parsed = assertBody(addGroupMembersSchema, { memberUids: ['uid-1'] });
  assert.deepEqual(parsed.memberUids, ['uid-1']);
});

test('addGroupMembersSchema rejects empty array', () => {
  assert.throws(() => assertBody(addGroupMembersSchema, { memberUids: [] }));
});

test('addGroupMembersSchema rejects more than 40 members', () => {
  assert.throws(() =>
    assertBody(addGroupMembersSchema, { memberUids: Array(41).fill('uid') })
  );
});

// ─── groupIdParam ─────────────────────────────────────────────────────────────

test('groupIdParam validates teamId and groupId UUIDs', () => {
  const parsed = groupIdParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    groupId: '550e8400-e29b-41d4-a716-446655440002',
  });
  assert.equal(parsed.groupId, '550e8400-e29b-41d4-a716-446655440002');
});

test('groupIdParam rejects non-UUID groupId', () => {
  assert.throws(() =>
    groupIdParam.parse({
      teamId: '550e8400-e29b-41d4-a716-446655440001',
      groupId: 'not-uuid',
    })
  );
});

// ─── updateGroupSchema ────────────────────────────────────────────────────────

test('updateGroupSchema allows all fields optional', () => {
  const parsed = assertBody(updateGroupSchema, {});
  assert.equal(parsed.name, undefined);
});

test('updateGroupSchema rejects invalid photoUrl', () => {
  assert.throws(() =>
    assertBody(updateGroupSchema, { photoUrl: 'not-a-url' })
  );
});
