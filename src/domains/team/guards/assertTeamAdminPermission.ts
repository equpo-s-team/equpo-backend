import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { PoolClient } from 'pg';
import {
  assertTeamMembership,
  type TeamMembershipResult,
} from './assertTeamMembership.js';

/**
 * Verifies a team exists, the actor belongs to it, AND the actor's role
 * is 'leader' or 'collaborator'.
 *
 * Use this for administrative operations: managing members, groups, 
 * rewards, and team settings.
 */
export async function assertTeamAdminPermission(
  client: PoolClient,
  teamId: string,
  actorUid: string
): Promise<TeamMembershipResult> {
  const membership = await assertTeamMembership(client, teamId, actorUid);

  // Leaders are always allowed
  if (membership.isLeader) {
    return membership;
  }

  if (membership.role !== 'collaborator') {
    const error = new EqupoError(
      'Forbidden: only leaders and collaborators can perform this action'
    );
    error.status = ERROR_STATUS.FORBIDDEN;
    throw error;
  }

  return membership;
}
