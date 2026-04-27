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
                (SELECT COUNT(*)::int FROM public.group_membership gm2 WHERE gm2.group_id = g.id) AS "memberCount",
                COALESCE(
                  json_agg(
                    json_build_object(
                      'uid', gm_u.uid,
                      'displayName', gm_u.display_name,
                      'photoUrl', gm_u.photo_u_r_l
                    )
                  ) FILTER (WHERE gm_u.uid IS NOT NULL),
                  '[]'
                ) AS members
         FROM public."group" g
         LEFT JOIN public.group_membership gm ON gm.group_id = g.id
         LEFT JOIN public."user" gm_u ON gm_u.uid = gm.user_uid
         WHERE g.team_id = $1
           AND (
             EXISTS (SELECT 1 FROM public.group_membership gm3 WHERE gm3.group_id = g.id AND gm3.user_uid = $2)
             OR EXISTS (SELECT 1 FROM public.team t WHERE t.id = $1 AND t.leader_uid = $2)
           )
         GROUP BY g.id
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

