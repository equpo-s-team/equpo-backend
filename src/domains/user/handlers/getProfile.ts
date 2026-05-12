import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getProfile: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  try {
    const authenticatedActorUid = getActorUid(req);

    const profile = await withTransaction(async client => {
      const result = await client.query(
        `SELECT uid,
                display_name       AS "displayName",
                photo_u_r_l        AS "photoURL",
                virtual_currency   AS "virtualCurrency",
                level,
                experience_points  AS "experiencePoints"
           FROM public."user"
           WHERE uid = $1
           LIMIT 1`,
        [authenticatedActorUid]
      );

      if (!result.rowCount) {
        throw new EqupoError('User not found', ERROR_STATUS.NOT_FOUND);
      }

      return result.rows[0];
    });

    return res.json(profile);
  } catch (error) {
    logEndpointAudit({
      operation: 'users.profile.get',
      outcome: 'error',
      actorUid,
      error,
    });
    return next(error);
  }
};
