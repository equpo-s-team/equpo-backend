import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import {
  teamIdParam,
  updateTeamSchema,
} from '#a/domains/team/schemas/index.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const updateTeam: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(updateTeamSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    if (!Object.keys(input).length) {
      return res
        .status(ERROR_STATUS.VALIDATION)
        .json({ error: 'No fields to update' });
    }

    const team = await withTransaction(async client => {
      await assertTeamAdminPermission(client, parsedTeamId, authenticatedActorUid);

      const updates: string[] = [];
      const values: Array<string | number | null> = [];
      let index = 1;

      if (input.name !== undefined) {
        updates.push(`name = $${index++}`);
        values.push(input.name);
      }
      if (input.description !== undefined) {
        updates.push(`description = $${index++}`);
        values.push(input.description);
      }
      if (input.virtualCurrency !== undefined) {
        updates.push(`virtual_currency = $${index++}`);
        values.push(input.virtualCurrency);
      }
      if (input.photoUrl !== undefined) {
        updates.push(`photo_u_r_l = $${index++}`);
        values.push(input.photoUrl);
      }

      updates.push('updated_at = NOW()');
      values.push(parsedTeamId);

      const result = await client.query(
        `UPDATE public.team SET ${updates.join(', ')} WHERE id = $${index} RETURNING id, name, leader_uid, virtual_currency, description, photo_u_r_l AS "photoUrl", updated_at`,
        values
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ team });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.update',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
