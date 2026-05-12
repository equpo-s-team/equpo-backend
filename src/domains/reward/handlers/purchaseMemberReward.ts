import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { rewardIdParam } from '#a/domains/reward/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { calculateLevel } from '#a/domains/user/xpUtils.js';
import { RequestHandler } from 'express';

export const purchaseMemberReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = rewardIdParam.parse(req.params));
    const { rewardId } = rewardIdParam.parse(req.params);
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const result = await withTransaction(async client => {
      // Rejects spectators; allows leader, collaborator, member
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      // Load reward
      const rewardResult = await client.query(
        `SELECT id, cost, experience_granted AS "experienceGranted", type
           FROM public.reward
           WHERE id = $1 AND team_id = $2
           LIMIT 1`,
        [rewardId, parsedTeamId]
      );

      if (!rewardResult.rowCount) {
        const err = new EqupoError('Reward not found');
        err.status = ERROR_STATUS.NOT_FOUND;
        throw err;
      }

      const reward = rewardResult.rows[0];
      if (reward.type !== 'member') {
        const err = new EqupoError(
          'This reward cannot be purchased with membership currency'
        );
        err.status = ERROR_STATUS.VALIDATION;
        throw err;
      }

      // Decrement membership wallet (also works for leader whose wallet is in team_membership)
      const membershipResult = await client.query(
        `UPDATE public.team_membership
            SET virtual_currency = virtual_currency - $1
          WHERE team_id = $2 AND user_uid = $3 AND virtual_currency >= $1
          RETURNING virtual_currency AS "virtualCurrency"`,
        [reward.cost, parsedTeamId, authenticatedActorUid]
      );

      if (!membershipResult.rowCount) {
        const err = new EqupoError('Insufficient membership currency');
        err.status = ERROR_STATUS.VALIDATION;
        throw err;
      }

      // Record the purchase
      const userRewardResult = await client.query(
        `INSERT INTO public.user_reward (user_uid, reward_id, team_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW(), NOW())
         RETURNING user_uid AS "userUid", reward_id AS "rewardId", team_id AS "teamId",
                   date_obtained AS "dateObtained", redeemed_at AS "redeemedAt"`,
        [authenticatedActorUid, rewardId, parsedTeamId]
      );

      // Grant XP to buyer
      const xpAmount = Number(reward.experienceGranted);
      if (xpAmount > 0) {
        const userXpResult = await client.query(
          `UPDATE public."user"
              SET experience_points = COALESCE(experience_points, 0) + $1,
                  updated_at = NOW()
            WHERE uid = $2
            RETURNING experience_points, level`,
          [xpAmount, authenticatedActorUid]
        );

        const newTotalXp = Number(userXpResult.rows[0]?.experience_points ?? 0);
        const newLevel = calculateLevel(newTotalXp);
        const oldLevel = Number(userXpResult.rows[0]?.level ?? 0);
        if (newLevel > oldLevel) {
          await client.query(
            `UPDATE public."user" SET level = $1, updated_at = NOW() WHERE uid = $2`,
            [newLevel, authenticatedActorUid]
          );
        }
      }

      return {
        userReward: userRewardResult.rows[0],
        newMembershipCurrency: Number(membershipResult.rows[0].virtualCurrency),
      };
    });

    logEndpointAudit({
      operation: 'teams.rewards.purchaseMember',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.CREATED).json(result);
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.purchaseMember',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
