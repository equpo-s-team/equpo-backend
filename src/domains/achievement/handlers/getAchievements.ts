import { withTransaction } from '#a/db.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getAchievements: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const achievements = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `SELECT a.id,
                  a.name,
                  a.description,
                  a.icon_u_r_l AS "iconUrl",
                  ua.unlocked_at AS "unlockedAt"
           FROM public.achievement a
           LEFT JOIN public.user_achievement ua
             ON ua.achievement_id = a.id AND ua.user_uid = $1
           ORDER BY ua.unlocked_at DESC NULLS LAST, a.name ASC`,
        [authenticatedActorUid]
      );

      return result.rows.map(row => ({
        id: row.id as string,
        name: row.name as string,
        description: row.description as string | null,
        iconUrl: (row.iconUrl as string | null) ?? null,
        unlockedAt: row.unlockedAt
          ? (row.unlockedAt as Date).toISOString()
          : null,
      }));
    });

    logEndpointAudit({
      operation: 'teams.achievements.list',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ achievements });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.achievements.list',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
