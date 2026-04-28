import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { upsertTeamMembershipInFirestore } from '#a/domains/team/firestore/teamMembershipFirestore.js';
import { assertTeamLeaderPermission } from '#a/domains/team/guards/index.js';
import {
  teamMemberParam,
  updateTeamMemberRoleSchema,
} from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const updateTeamMemberRole: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let userUid: string | null = null;
  try {
    ({ teamId, userUid } = teamMemberParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedUserUid = userUid;
    const input = assertBody(updateTeamMemberRoleSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const membership = await withTransaction(async client => {
      await assertTeamLeaderPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const result = await client.query(
        `UPDATE public.team_membership
         SET role = $3
         WHERE team_id = $1 AND user_uid = $2
         RETURNING user_uid, team_id, role`,
        [parsedTeamId, parsedUserUid, input.role]
      );

      if (!result.rowCount) {
        const error = new EqupoError('Team membership not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      return result.rows[0];
    });

    await upsertTeamMembershipInFirestore(
      membership.team_id,
      membership.user_uid,
      membership.role
    );

    logEndpointAudit({
      operation: 'teams.members.role.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      targetUserUid: parsedUserUid,
    });

    return res.json({ membership });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.members.role.update',
      outcome: 'error',
      actorUid,
      teamId,
      targetUserUid: userUid,
      error,
    });
    return next(error);
  }
};
