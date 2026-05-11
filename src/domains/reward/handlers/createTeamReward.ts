import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import {
  createTeamRewardSchema,
  teamIdParam,
} from '#a/domains/team/schemas/index.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createTeamReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createTeamRewardSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const teamReward = await withTransaction(async client => {
      await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const result = await client.query(
        `INSERT INTO public.team_reward (team_id, reward_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW(), NOW())
         RETURNING team_id, reward_id, date_obtained, updated_at`,
        [parsedTeamId, input.rewardId, input.dateObtained ?? null]
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.rewards.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ teamReward });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.create',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
