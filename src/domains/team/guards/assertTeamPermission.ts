import { TEAM_ALLOWED_ROLES } from '../schemas/constants.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { PoolClient } from 'pg';
import {
  assertTeamMembership,
  type TeamMembershipResult,
} from './assertTeamMembership.js';

/**
 * Verifies a team exists, the actor belongs to it, AND the actor's role
 * is in TEAM_ALLOWED_ROLES (leader or collaborator).
 *
 * Use this for endpoints that require an active/contributing role
 * (e.g. create/edit/delete tasks, manage board).
 *
 * For read-only endpoints accessible to ALL members, use `assertTeamMembership`.
 * For leader-only endpoints, use `assertTeamLeaderPermission`.
 */
export async function assertTeamPermission(
  client: PoolClient,
  teamId: string,
  actorUid: string
): Promise<TeamMembershipResult> {
  const membership = await assertTeamMembership(client, teamId, actorUid);

  // Leaders are always allowed
  if (membership.isLeader) {
    return membership;
  }

  if (
    !TEAM_ALLOWED_ROLES.has(
      membership.role as typeof TEAM_ALLOWED_ROLES extends Set<infer T>
        ? T
        : never
    )
  ) {
    const error = new EqupoError('Forbidden: insufficient role');
    error.status = ERROR_STATUS.FORBIDDEN;
    throw error;
  }

  return membership;
}
