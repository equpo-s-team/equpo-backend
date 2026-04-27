import { withTransaction } from '#a/db.js';
import { createSystemUserRewardSchema } from '#a/domains/reward/schemas/index.js';
import { assertBody, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const grantSystemReward: RequestHandler = async (req, res, next) => {
  let userUid: string | null = null;
  try {
    const input = assertBody(createSystemUserRewardSchema, req.body);
    userUid = String(req.params.userUid ?? '');

    const userReward = await withTransaction(async client => {
      const result = await client.query(
        `INSERT INTO public.user_reward (user_uid, reward_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW(), NOW())
         ON CONFLICT (user_uid, reward_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING user_uid, reward_id, date_obtained, updated_at`,
        [userUid, input.rewardId, input.dateObtained ?? null]
      );
      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'internal.userRewards.create',
      outcome: 'success',
      actorUid: null,
      targetUserUid: userUid,
    });

    return res.status(201).json({ userReward });
  } catch (error) {
    logEndpointAudit({
      operation: 'internal.userRewards.create',
      outcome: 'error',
      actorUid: null,
      targetUserUid: userUid,
      error,
    });
    return next(error);
  }
};
