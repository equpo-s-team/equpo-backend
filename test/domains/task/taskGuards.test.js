import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGroupBelongsToTeam } from '../../../dist/domains/task/guards/assertGroupBelongsToTeam.js';
import { EqupoError } from '../../../dist/types/EqupoError.js';
import { makeSequentialClient } from '../../helpers/mockClient.js';

const TEAM_ID = '550e8400-e29b-41d4-a716-446655440001';
const GROUP_ID = '550e8400-e29b-41d4-a716-446655440002';

test('assertGroupBelongsToTeam passes when group belongs to the team', async () => {
  const client = makeSequentialClient([{ rowCount: 1, rows: [] }]);
  await assert.doesNotReject(() =>
    assertGroupBelongsToTeam(client, TEAM_ID, GROUP_ID)
  );
});

test('assertGroupBelongsToTeam throws 400 when group does not belong to the team', async () => {
  const client = makeSequentialClient([{ rowCount: 0, rows: [] }]);
  await assert.rejects(
    () => assertGroupBelongsToTeam(client, TEAM_ID, GROUP_ID),
    err => err instanceof EqupoError && err.status === 400
  );
});
