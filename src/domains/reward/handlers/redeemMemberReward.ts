import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { redeemMemberRewardParam } from '#a/domains/reward/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { RequestHandler } from 'express';

export const redeemMemberReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = redeemMemberRewardParam.parse(req.params));
    const { rewardId, userUid } = redeemMemberRewardParam.parse(req.params);
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const userReward = await withTransaction(async client => {
      await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const result = await client.query(
        `UPDATE public.user_reward
            SET redeemed_at = NOW(), updated_at = NOW()
          WHERE user_uid = $1 AND reward_id = $2 AND redeemed_at IS NULL
          RETURNING user_uid AS "userUid", reward_id AS "rewardId",
                    date_obtained AS "dateObtained", redeemed_at AS "redeemedAt"`,
        [userUid, rewardId]
      );

      if (!result.rowCount) {
        const existing = await client.query(
          `SELECT redeemed_at FROM public.user_reward WHERE user_uid = $1 AND reward_id = $2 LIMIT 1`,
          [userUid, rewardId]
        );
        const err = new EqupoError(
          existing.rowCount
            ? 'Reward already redeemed'
            : 'User has not obtained this reward'
        );
        err.status = ERROR_STATUS.CONFLICT;
        throw err;
      }

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.rewards.redeemMember',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ userReward });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.redeemMember',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
