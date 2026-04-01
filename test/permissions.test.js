import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_ALLOWED_ROLES,
  assertBody,
  createTeamSchema,
  inviteTeamMemberSchema,
  updateTeamMemberRoleSchema,
} from '../src/permissions.js';

test('TEAM_ALLOWED_ROLES includes leader and collaborator', () => {
  assert.equal(TEAM_ALLOWED_ROLES.has('leader'), true);
  assert.equal(TEAM_ALLOWED_ROLES.has('collaborator'), true);
  assert.equal(TEAM_ALLOWED_ROLES.has('member'), false);
});

test('createTeamSchema validates expected payload', () => {
  const parsed = assertBody(createTeamSchema, {
    name: 'My Team',
    virtualCurrency: 0,
    description: 'Hello',
  });

  assert.equal(parsed.name, 'My Team');
});

test('inviteTeamMemberSchema defaults role to member', () => {
  const parsed = assertBody(inviteTeamMemberSchema, {
    userUid: 'uid_123',
  });
  assert.equal(parsed.role, 'member');
});

test('updateTeamMemberRoleSchema rejects invalid role', () => {
  assert.throws(() => {
    assertBody(updateTeamMemberRoleSchema, {
      role: 'owner',
    });
  });
});
