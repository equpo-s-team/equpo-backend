import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { createRewardSchema } from '#a/domains/reward/schemas/index.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createRewardSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const reward = await withTransaction(async client => {
      await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const result = await client.query(
        `INSERT INTO public.reward
           (team_id, name, cost, experience_granted, type, description, icon_u_r_l, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id,
                   name,
                   cost,
                   experience_granted AS "experienceGranted",
                   type,
                   description,
                   icon_u_r_l         AS "iconURL",
                   created_at         AS "createdAt",
                   updated_at         AS "updatedAt"`,
        [
          parsedTeamId,
          input.name,
          input.cost,
          input.experienceGranted,
          input.type,
          input.description ?? null,
          input.iconURL ?? null,
        ]
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.rewards.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ reward });
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
