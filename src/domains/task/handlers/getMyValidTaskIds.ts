import { withTransaction } from '#a/db.js';
import { assertUserBelongsToTeam } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getMyValidTaskIds: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const taskIds = await withTransaction(async client => {
      await assertUserBelongsToTeam(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const result = await client.query(
        `SELECT DISTINCT t.id
         FROM public.task t
         LEFT JOIN public.group_membership gm ON gm.group_id = t.assigned_group_id
         WHERE t.team_id = $1
           AND (t.assigned_user_uid = $2 OR gm.user_uid = $2)
         ORDER BY t.id`,
        [parsedTeamId, authenticatedActorUid]
      );

      return result.rows.map(row => row.id as string);
    });

    logEndpointAudit({
      operation: 'tasks.myValidIds',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ taskIds });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.myValidIds',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
