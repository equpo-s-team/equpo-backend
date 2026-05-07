import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { rewardIdParam } from '#a/domains/reward/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { RequestHandler } from 'express';

export const deleteReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = rewardIdParam.parse(req.params));
    const { rewardId } = rewardIdParam.parse(req.params);
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    await withTransaction(async client => {
      await assertTeamAdminPermission(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `DELETE FROM public.reward WHERE team_id = $1 AND id = $2`,
        [parsedTeamId, rewardId]
      );

      if (!result.rowCount) {
        const err = new EqupoError('Reward not found');
        err.status = ERROR_STATUS.NOT_FOUND;
        throw err;
      }
    });

    logEndpointAudit({
      operation: 'teams.rewards.delete',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(204).send();
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.delete',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
