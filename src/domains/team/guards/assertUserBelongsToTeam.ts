import { EqupoError } from '@/types/EqupoError';
import { ERROR_STATUS } from '@/constants/httpStatusCodes';
import { PoolClient } from 'pg';

export async function assertUserBelongsToTeam(
  client: PoolClient,
  teamId: string,
  userUid: string
) {
  const isLeader = await client.query(
    'SELECT 1 FROM public.team WHERE id = $1 AND leader_uid = $2 LIMIT 1',
    [teamId, userUid]
  );
  if (isLeader.rowCount) return;

  const membership = await client.query(
    'SELECT 1 FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1',
    [teamId, userUid]
  );

  if (!membership.rowCount) {
    const error = new EqupoError('Target user is not part of the team');
    error.status = ERROR_STATUS.VALIDATION;
    throw error;
  }
}
