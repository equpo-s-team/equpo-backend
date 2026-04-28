import { withTransaction } from '#a/db.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getGroups: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const groups = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `SELECT g.id,
                  g.group_name   AS "groupName",
                  g.photo_u_r_l  AS "photoUrl",
                  (SELECT COUNT(*)::int FROM public.group_membership gm2 WHERE gm2.group_id = g.id) AS "memberCount"
           FROM public."group" g
           WHERE g.team_id = $1
             AND (
               EXISTS (SELECT 1 FROM public.group_membership gm WHERE gm.group_id = g.id AND gm.user_uid = $2)
               OR EXISTS (SELECT 1 FROM public.team t WHERE t.id = $1 AND t.leader_uid = $2)
             )
           ORDER BY g.group_name ASC`,
        [parsedTeamId, authenticatedActorUid]
      );

      return result.rows;
    });

    logEndpointAudit({
      operation: 'teams.groups.list',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ groups });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.groups.list',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
