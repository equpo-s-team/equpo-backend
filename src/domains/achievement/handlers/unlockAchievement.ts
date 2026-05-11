import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { unlockAchievementSchema } from '#a/domains/achievement/schemas/index.js';
import {
  assertTeamAdminPermission,
  assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const unlockAchievement: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(unlockAchievementSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const userAchievement = await withTransaction(async client => {

      await assertUserBelongsToTeam(client, parsedTeamId, input.userUid);

      const achievementResult = await client.query(
        `SELECT id FROM public.achievement WHERE id = $1 LIMIT 1`,
        [input.achievementId]
      );

      if (!achievementResult.rowCount) {
        const error = new EqupoError('Achievement not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      const result = await client.query(
        `INSERT INTO public.user_achievement (user_uid, achievement_id, unlocked_at)
           VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
           ON CONFLICT (user_uid, achievement_id)
           DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at
           RETURNING user_uid, achievement_id, unlocked_at`,
        [input.userUid, input.achievementId, input.unlockedAt ?? null]
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.achievements.unlock',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      targetUserUid: input.userUid,
    });

    return res.status(201).json({ userAchievement });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.achievements.unlock',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
