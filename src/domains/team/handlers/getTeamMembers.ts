import { withTransaction } from '#a/db.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getTeamMembers: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const members = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `SELECT tm.user_uid AS "uid",
                  u.display_name AS "displayName",
                  u.photo_u_r_l  AS "photoUrl",
                  tm.role
           FROM public.team_membership tm
           JOIN public."user" u ON u.uid = tm.user_uid
           WHERE tm.team_id = $1
           ORDER BY u.display_name ASC`,
        [parsedTeamId]
      );

      return result.rows;
    });

    logEndpointAudit({
      operation: 'teams.members.list',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ members });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.members.list',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
