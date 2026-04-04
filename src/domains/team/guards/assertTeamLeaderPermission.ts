import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { PoolClient } from 'pg';
import {
  assertTeamMembership,
  type TeamMembershipResult,
} from './assertTeamMembership.js';

/**
 * Verifies a team exists, the actor belongs to it, AND the actor is the
 * team leader (team.leader_uid).
 *
 * Use this for privileged operations: change roles, remove members,
 * update team settings, delete team.
 */
export async function assertTeamLeaderPermission(
  client: PoolClient,
  teamId: string,
  actorUid: string
): Promise<TeamMembershipResult> {
  const membership = await assertTeamMembership(client, teamId, actorUid);

  if (!membership.isLeader) {
    const error = new EqupoError(
      'Forbidden: only team leader can perform this action'
    );
    error.status = ERROR_STATUS.FORBIDDEN;
    throw error;
  }

  return membership;
}
