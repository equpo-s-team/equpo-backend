import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { PoolClient } from 'pg';

export async function assertTeamLeaderPermission(
  client: PoolClient,
  teamId: string,
  actorUid: string
) {
  const teamResult = await client.query(
    'SELECT id, leader_uid FROM public.team WHERE id = $1 LIMIT 1',
    [teamId]
  );

  if (!teamResult.rowCount) {
    const error = new EqupoError('Team not found');
    error.status = ERROR_STATUS.NOT_FOUND;
    throw error;
  }

  const team = teamResult.rows[0];
  if (team.leader_uid !== actorUid) {
    const error = new EqupoError(
      'Forbidden: only team leader can perform this action'
    );
    error.status = ERROR_STATUS.FORBIDDEN;
    throw error;
  }

  return { isLeader: true, role: 'leader', teamId: team.id };
}
