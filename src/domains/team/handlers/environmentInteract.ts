import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { environmentInteractSchema } from '#a/domains/team/schemas/environmentInteractSchema.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

const INTERACTION_COSTS: Record<string, number> = {
  'feed-ducks': 10,
  'water-garden': 15,
};

export const environmentInteract: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const { eventType } = assertBody(environmentInteractSchema, req.body);
    const authenticatedActorUid = getActorUid(req);
    const cost = INTERACTION_COSTS[eventType];

    const result = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const userResult = await client.query(
        `SELECT virtual_currency FROM public."user" WHERE uid = $1 LIMIT 1`,
        [authenticatedActorUid]
      );

      const currentCoins = Number(userResult.rows[0]?.virtual_currency ?? 0);
      if (currentCoins < cost) {
        throw new EqupoError(
          `Insufficient coins: need ${cost}, have ${currentCoins}`,
          ERROR_STATUS.VALIDATION
        );
      }

      const updatedUser = await client.query(
        `UPDATE public."user"
           SET virtual_currency = virtual_currency - $1,
               updated_at = NOW()
           WHERE uid = $2
           RETURNING virtual_currency AS "newCoinBalance"`,
        [cost, authenticatedActorUid]
      );

      const healthBoost = Math.floor(Math.random() * 2) + 1;

      const updatedTeam = await client.query(
        `UPDATE public.team
           SET environment_health = LEAST(environment_health + $1, 100),
               updated_at = NOW()
           WHERE id = $2
           RETURNING environment_health AS "environmentHealth"`,
        [healthBoost, parsedTeamId]
      );

      return {
        newCoinBalance: Number(updatedUser.rows[0]?.newCoinBalance ?? 0),
        environmentHealth: Number(updatedTeam.rows[0]?.environmentHealth ?? 60),
      };
    });

    logEndpointAudit({
      operation: 'environment.interact',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json(result);
  } catch (error) {
    logEndpointAudit({
      operation: 'environment.interact',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
