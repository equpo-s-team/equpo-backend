import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { PoolClient } from 'pg';

export async function assertGroupBelongsToTeam(
  client: PoolClient,
  teamId: string,
  groupId: string
) {
  const result = await client.query(
    'SELECT 1 FROM public."group" WHERE id = $1 AND team_id = $2 LIMIT 1',
    [groupId, teamId]
  );

  if (!result.rowCount) {
    const error = new EqupoError('Assigned group does not belong to the team');
    error.status = ERROR_STATUS.VALIDATION;
    throw error;
  }
}
