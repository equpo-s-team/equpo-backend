import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTeamMembership } from '../../../dist/domains/team/guards/assertTeamMembership.js';
import { assertTeamPermission } from '../../../dist/domains/team/guards/assertTeamPermission.js';
import { assertTeamLeaderPermission } from '../../../dist/domains/team/guards/assertTeamLeaderPermission.js';
import { assertTeamAdminPermission } from '../../../dist/domains/team/guards/assertTeamAdminPermission.js';
import { assertUserBelongsToTeam } from '../../../dist/domains/team/guards/assertUserBelongsToTeam.js';
import { EqupoError } from '../../../dist/types/EqupoError.js';
import { makeSequentialClient } from '../../helpers/mockClient.js';

const TEAM_ID = '550e8400-e29b-41d4-a716-446655440001';
const ACTOR_UID = 'uid-actor';
const OTHER_UID = 'uid-other';

// ─── assertTeamMembership ─────────────────────────────────────────────────────

test('assertTeamMembership throws 404 when team not found', async () => {
  const client = makeSequentialClient([{ rowCount: 0, rows: [] }]);
  await assert.rejects(
    () => assertTeamMembership(client, TEAM_ID, ACTOR_UID),
    err => err instanceof EqupoError && err.status === 404
  );
});

test('assertTeamMembership returns isLeader=true when actor is the team leader', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: ACTOR_UID }] },
  ]);
  const result = await assertTeamMembership(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.isLeader, true);
  assert.equal(result.role, 'leader');
});

test('assertTeamMembership returns correct role for member', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'member' }] },
  ]);
  const result = await assertTeamMembership(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.isLeader, false);
  assert.equal(result.role, 'member');
});

test('assertTeamMembership throws 403 when actor is not a member', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 0, rows: [] },
  ]);
  await assert.rejects(
    () => assertTeamMembership(client, TEAM_ID, ACTOR_UID),
    err => err instanceof EqupoError && err.status === 403
  );
});

// ─── assertTeamPermission ─────────────────────────────────────────────────────

test('assertTeamPermission allows leader', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: ACTOR_UID }] },
  ]);
  const result = await assertTeamPermission(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.isLeader, true);
});

test('assertTeamPermission allows collaborator', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'collaborator' }] },
  ]);
  const result = await assertTeamPermission(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.role, 'collaborator');
});

test('assertTeamPermission allows member', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'member' }] },
  ]);
  const result = await assertTeamPermission(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.role, 'member');
});

test('assertTeamPermission throws 403 for spectator', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'spectator' }] },
  ]);
  await assert.rejects(
    () => assertTeamPermission(client, TEAM_ID, ACTOR_UID),
    err => err instanceof EqupoError && err.status === 403
  );
});

// ─── assertTeamLeaderPermission ───────────────────────────────────────────────

test('assertTeamLeaderPermission allows the team leader', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: ACTOR_UID }] },
  ]);
  const result = await assertTeamLeaderPermission(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.isLeader, true);
});

test('assertTeamLeaderPermission throws 403 for non-leader member', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'member' }] },
  ]);
  await assert.rejects(
    () => assertTeamLeaderPermission(client, TEAM_ID, ACTOR_UID),
    err => err instanceof EqupoError && err.status === 403
  );
});

// ─── assertTeamAdminPermission ────────────────────────────────────────────────

test('assertTeamAdminPermission allows leader', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: ACTOR_UID }] },
  ]);
  const result = await assertTeamAdminPermission(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.isLeader, true);
});

test('assertTeamAdminPermission allows collaborator', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'collaborator' }] },
  ]);
  const result = await assertTeamAdminPermission(client, TEAM_ID, ACTOR_UID);
  assert.equal(result.role, 'collaborator');
});

test('assertTeamAdminPermission throws 403 for member', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [{ id: TEAM_ID, leader_uid: OTHER_UID }] },
    { rowCount: 1, rows: [{ role: 'member' }] },
  ]);
  await assert.rejects(
    () => assertTeamAdminPermission(client, TEAM_ID, ACTOR_UID),
    err => err instanceof EqupoError && err.status === 403
  );
});

// ─── assertUserBelongsToTeam ──────────────────────────────────────────────────

test('assertUserBelongsToTeam passes when user is the leader', async () => {
  const client = makeSequentialClient([
    { rowCount: 1, rows: [] }, // leader check
  ]);
  await assert.doesNotReject(() =>
    assertUserBelongsToTeam(client, TEAM_ID, ACTOR_UID)
  );
});

test('assertUserBelongsToTeam passes when user is a regular member', async () => {
  const client = makeSequentialClient([
    { rowCount: 0, rows: [] }, // leader check fails
    { rowCount: 1, rows: [] }, // membership check passes
  ]);
  await assert.doesNotReject(() =>
    assertUserBelongsToTeam(client, TEAM_ID, ACTOR_UID)
  );
});

test('assertUserBelongsToTeam throws 400 when user is not in the team', async () => {
  const client = makeSequentialClient([
    { rowCount: 0, rows: [] }, // leader check
    { rowCount: 0, rows: [] }, // membership check
  ]);
  await assert.rejects(
    () => assertUserBelongsToTeam(client, TEAM_ID, ACTOR_UID),
    err => err instanceof EqupoError && err.status === 400
  );
});
