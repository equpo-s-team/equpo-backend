import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { assertTeamLeaderPermission } from '#a/domains/team/guards/index.js';
import { rewardIdParam } from '#a/domains/reward/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { calculateLevel } from '#a/domains/user/xpUtils.js';
import { RequestHandler } from 'express';

export const purchaseTeamReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = rewardIdParam.parse(req.params));
    const { rewardId } = rewardIdParam.parse(req.params);
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const result = await withTransaction(async client => {
      await assertTeamLeaderPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      // Load reward and verify it belongs to this team and is type 'team'
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
      if (reward.type !== 'team') {
        const err = new EqupoError(
          'This reward cannot be purchased with team currency'
        );
        err.status = ERROR_STATUS.VALIDATION;
        throw err;
      }

      // Decrement team wallet (atomic, fails if insufficient funds)
      const teamResult = await client.query(
        `UPDATE public.team
            SET virtual_currency = virtual_currency - $1,
                updated_at = NOW()
          WHERE id = $2 AND virtual_currency >= $1
          RETURNING virtual_currency AS "virtualCurrency"`,
        [reward.cost, parsedTeamId]
      );

      if (!teamResult.rowCount) {
        const err = new EqupoError('Insufficient team currency');
        err.status = ERROR_STATUS.VALIDATION;
        throw err;
      }

      // Upsert team_reward row (re-buy after redemption resets the row)
      const teamRewardResult = await client.query(
        `INSERT INTO public.team_reward (team_id, reward_id, date_obtained, redeemed_at, created_at, updated_at)
         VALUES ($1, $2, NOW(), NULL, NOW(), NOW())
         ON CONFLICT (team_id, reward_id)
         DO UPDATE SET date_obtained = NOW(), redeemed_at = NULL, updated_at = NOW()
         RETURNING team_id, reward_id, date_obtained AS "dateObtained", redeemed_at AS "redeemedAt"`,
        [parsedTeamId, rewardId]
      );

      // Grant XP to every member of the team
      const xpAmount = Number(reward.experienceGranted);
      if (xpAmount > 0) {
        const memberUids = await client.query(
          `SELECT user_uid FROM public.team_membership WHERE team_id = $1`,
          [parsedTeamId]
        );

        for (const row of memberUids.rows) {
          const userXpResult = await client.query(
            `UPDATE public."user"
                SET experience_points = COALESCE(experience_points, 0) + $1,
                    updated_at = NOW()
              WHERE uid = $2
              RETURNING experience_points, level`,
            [xpAmount, row.user_uid]
          );

          const newTotalXp = Number(
            userXpResult.rows[0]?.experience_points ?? 0
          );
          const newLevel = calculateLevel(newTotalXp);
          const oldLevel = Number(userXpResult.rows[0]?.level ?? 0);
          if (newLevel > oldLevel) {
            await client.query(
              `UPDATE public."user" SET level = $1, updated_at = NOW() WHERE uid = $2`,
              [newLevel, row.user_uid]
            );
          }
        }
      }

      return {
        teamReward: teamRewardResult.rows[0],
        newTeamVirtualCurrency: Number(teamResult.rows[0].virtualCurrency),
      };
    });

    logEndpointAudit({
      operation: 'teams.rewards.purchaseTeam',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.CREATED).json(result);
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.purchaseTeam',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
