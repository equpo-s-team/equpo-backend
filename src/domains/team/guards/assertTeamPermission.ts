import { TEAM_ALLOWED_ROLES } from '../schemas/constants.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { PoolClient } from 'pg';

export async function assertTeamPermission(
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
  if (team.leader_uid === actorUid) {
    return { isLeader: true, role: 'leader', teamId: team.id };
  }

  const membershipResult = await client.query(
    'SELECT role FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1',
    [teamId, actorUid]
  );

  if (!membershipResult.rowCount) {
    const error = new EqupoError('Forbidden: not a team member');
    error.status = ERROR_STATUS.FORBIDDEN;
    throw error;
  }

  const role = String(membershipResult.rows[0].role || '').toLowerCase() as
    | 'leader'
    | 'collaborator';
  if (!TEAM_ALLOWED_ROLES.has(role)) {
    const error = new EqupoError('Forbidden: insufficient role');
    error.status = ERROR_STATUS.FORBIDDEN;
    throw error;
  }

  return { isLeader: false, role, teamId: team.id };
}
