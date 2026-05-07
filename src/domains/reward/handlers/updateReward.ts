import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { rewardIdParam, updateRewardSchema } from '#a/domains/reward/schemas/index.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { RequestHandler } from 'express';

export const updateReward: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = rewardIdParam.parse(req.params));
    const { rewardId } = rewardIdParam.parse(req.params);
    const parsedTeamId = teamId;
    const input = assertBody(updateRewardSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const reward = await withTransaction(async client => {
      await assertTeamAdminPermission(client, parsedTeamId, authenticatedActorUid);

      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [parsedTeamId, rewardId];
      let idx = 3;

      if (input.name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(input.name); }
      if (input.cost !== undefined) { setClauses.push(`cost = $${idx++}`); values.push(input.cost); }
      if (input.experienceGranted !== undefined) { setClauses.push(`experience_granted = $${idx++}`); values.push(input.experienceGranted); }
      if ('description' in input) { setClauses.push(`description = $${idx++}`); values.push(input.description ?? null); }
      if ('iconURL' in input) { setClauses.push(`icon_u_r_l = $${idx++}`); values.push(input.iconURL ?? null); }

      const result = await client.query(
        `UPDATE public.reward
            SET ${setClauses.join(', ')}
          WHERE team_id = $1 AND id = $2
          RETURNING id,
                    name,
                    cost,
                    experience_granted AS "experienceGranted",
                    type,
                    description,
                    icon_u_r_l         AS "iconURL",
                    created_at         AS "createdAt",
                    updated_at         AS "updatedAt"`,
        values
      );

      if (!result.rowCount) {
        const err = new EqupoError('Reward not found');
        err.status = ERROR_STATUS.NOT_FOUND;
        throw err;
      }

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.rewards.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ reward });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.update',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
