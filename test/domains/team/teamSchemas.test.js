import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBody } from '../../../dist/utils/assertBody.js';
import { TEAM_ALLOWED_ROLES } from '../../../dist/domains/team/schemas/constants.js';
import { createTeamSchema } from '../../../dist/domains/team/schemas/createTeamSchema.js';
import {
  inviteTeamMemberSchema,
  updateTeamMemberRoleSchema,
  teamIdParam,
  teamMemberParam,
  updateTeamSchema,
  joinTeamWithInviteCodeSchema,
  createInvitationCodeSchema,
} from '../../../dist/domains/team/schemas/params.js';
import { createTeamRewardSchema } from '../../../dist/domains/team/schemas/createTeamRewardSchema.js';

// ─── TEAM_ALLOWED_ROLES ───────────────────────────────────────────────────────

test('TEAM_ALLOWED_ROLES includes leader and collaborator', () => {
  assert.equal(TEAM_ALLOWED_ROLES.has('leader'), true);
  assert.equal(TEAM_ALLOWED_ROLES.has('collaborator'), true);
  assert.equal(TEAM_ALLOWED_ROLES.has('member'), false);
});

// ─── createTeamSchema ─────────────────────────────────────────────────────────

test('createTeamSchema validates expected payload', () => {
  const parsed = assertBody(createTeamSchema, {
    name: 'My Team',
    virtualCurrency: 0,
    description: 'Hello',
  });
  assert.equal(parsed.name, 'My Team');
});

test('createTeamSchema defaults virtualCurrency to 0', () => {
  const parsed = assertBody(createTeamSchema, { name: 'Team A' });
  assert.equal(parsed.virtualCurrency, 0);
});

test('createTeamSchema rejects empty name', () => {
  assert.throws(() => assertBody(createTeamSchema, { name: '' }));
});

// ─── inviteTeamMemberSchema ───────────────────────────────────────────────────

test('inviteTeamMemberSchema defaults role to member', () => {
  const parsed = assertBody(inviteTeamMemberSchema, { userUid: 'uid_123' });
  assert.equal(parsed.role, 'member');
});

test('inviteTeamMemberSchema accepts email', () => {
  const parsed = assertBody(inviteTeamMemberSchema, {
    email: 'user@example.com',
    role: 'collaborator',
  });
  assert.equal(parsed.email, 'user@example.com');
  assert.equal(parsed.role, 'collaborator');
});

test('inviteTeamMemberSchema rejects both userUid and email', () => {
  assert.throws(() =>
    assertBody(inviteTeamMemberSchema, {
      userUid: 'uid_123',
      email: 'user@example.com',
    })
  );
});

test('inviteTeamMemberSchema rejects neither userUid nor email', () => {
  assert.throws(() => assertBody(inviteTeamMemberSchema, { role: 'member' }));
});

// ─── updateTeamMemberRoleSchema ───────────────────────────────────────────────

test('updateTeamMemberRoleSchema rejects invalid role', () => {
  assert.throws(() => assertBody(updateTeamMemberRoleSchema, { role: 'owner' }));
});

test('updateTeamMemberRoleSchema accepts collaborator', () => {
  const parsed = assertBody(updateTeamMemberRoleSchema, { role: 'collaborator' });
  assert.equal(parsed.role, 'collaborator');
});

// ─── teamIdParam ──────────────────────────────────────────────────────────────

test('teamIdParam validates UUID', () => {
  const parsed = teamIdParam.parse({ teamId: '550e8400-e29b-41d4-a716-446655440001' });
  assert.equal(parsed.teamId, '550e8400-e29b-41d4-a716-446655440001');
});

test('teamIdParam rejects non-UUID', () => {
  assert.throws(() => teamIdParam.parse({ teamId: 'not-a-uuid' }));
});

// ─── teamMemberParam ──────────────────────────────────────────────────────────

test('teamMemberParam validates teamId UUID + userUid string', () => {
  const parsed = teamMemberParam.parse({
    teamId: '550e8400-e29b-41d4-a716-446655440001',
    userUid: 'firebase-uid',
  });
  assert.equal(parsed.userUid, 'firebase-uid');
});

// ─── updateTeamSchema ─────────────────────────────────────────────────────────

test('updateTeamSchema allows partial updates', () => {
  const parsed = assertBody(updateTeamSchema, { name: 'New Name' });
  assert.equal(parsed.name, 'New Name');
});

test('updateTeamSchema rejects invalid photoUrl', () => {
  assert.throws(() => assertBody(updateTeamSchema, { photoUrl: 'not-a-url' }));
});

// ─── joinTeamWithInviteCodeSchema ─────────────────────────────────────────────

test('joinTeamWithInviteCodeSchema requires non-empty code', () => {
  const parsed = assertBody(joinTeamWithInviteCodeSchema, { code: 'ABC123' });
  assert.equal(parsed.code, 'ABC123');
});

test('joinTeamWithInviteCodeSchema rejects empty code', () => {
  assert.throws(() => assertBody(joinTeamWithInviteCodeSchema, { code: '' }));
});

// ─── createInvitationCodeSchema ───────────────────────────────────────────────

test('createInvitationCodeSchema defaults role to member and expiresInHours to 24', () => {
  const parsed = assertBody(createInvitationCodeSchema, {});
  assert.equal(parsed.role, 'member');
  assert.equal(parsed.expiresInHours, 24);
  assert.equal(parsed.maxUses, 10);
});

test('createInvitationCodeSchema rejects expiresInHours above 720', () => {
  assert.throws(() => assertBody(createInvitationCodeSchema, { expiresInHours: 721 }));
});

// ─── createTeamRewardSchema ───────────────────────────────────────────────────

test('createTeamRewardSchema validates UUID rewardId', () => {
  const parsed = assertBody(createTeamRewardSchema, {
    rewardId: '550e8400-e29b-41d4-a716-446655440001',
  });
  assert.equal(parsed.rewardId, '550e8400-e29b-41d4-a716-446655440001');
});

test('createTeamRewardSchema rejects non-UUID rewardId', () => {
  assert.throws(() => assertBody(createTeamRewardSchema, { rewardId: 'bad' }));
});
