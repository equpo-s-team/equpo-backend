import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { rewardIdParam } from '#a/domains/reward/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { RequestHandler } from 'express';

export const redeemTeamReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = rewardIdParam.parse(req.params));
    const { rewardId } = rewardIdParam.parse(req.params);
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const teamReward = await withTransaction(async client => {
      await assertTeamAdminPermission(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `UPDATE public.team_reward
            SET redeemed_at = NOW(), updated_at = NOW()
          WHERE team_id = $1 AND reward_id = $2 AND redeemed_at IS NULL
          RETURNING team_id, reward_id, date_obtained AS "dateObtained", redeemed_at AS "redeemedAt"`,
        [parsedTeamId, rewardId]
      );

      if (!result.rowCount) {
        // Row either doesn't exist or is already redeemed
        const existing = await client.query(
          `SELECT redeemed_at FROM public.team_reward WHERE team_id = $1 AND reward_id = $2 LIMIT 1`,
          [parsedTeamId, rewardId]
        );
        const err = new EqupoError(
          existing.rowCount
            ? 'Reward already redeemed'
            : 'Reward has not been obtained'
        );
        err.status = ERROR_STATUS.CONFLICT;
        throw err;
      }

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.rewards.redeemTeam',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ teamReward });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.redeemTeam',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
