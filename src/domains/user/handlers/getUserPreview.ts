import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool } from '#a/db.js';
import { userPreviewQuerySchema } from '#a/domains/user/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';
import { z } from 'zod';

interface UserPreviewResponse {
  uid: string;
  displayName: string;
  photoUrl?: string;
  exists: boolean;
}

export const getUserPreview: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;

  try {
    const authenticatedActorUid = getActorUid(req);

    // Validar query params
    const query = userPreviewQuerySchema.parse(req.query);
    const targetUid = query.uid;

    // Buscar usuario en PostgreSQL
    const userResult = await pool.query(
      `SELECT uid, display_name, photo_u_r_l 
       FROM public."user" 
       WHERE uid = $1 
       LIMIT 1`,
      [targetUid]
    );

    if (userResult.rows.length === 0) {
      const response: UserPreviewResponse = {
        uid: targetUid,
        displayName: targetUid, // Fallback al UID si no existe
        exists: false,
      };

      logEndpointAudit({
        operation: 'users.preview',
        outcome: 'success',
        actorUid: authenticatedActorUid,
        targetUserUid: targetUid,
      });

      return res.status(SUCCESS_STATUS.OK).json(response);
    }

    const userRow = userResult.rows[0];
    const response: UserPreviewResponse = {
      uid: userRow.uid,
      displayName: userRow.display_name || userRow.uid,
      photoUrl: userRow.photo_u_r_l || undefined,
      exists: true,
    };

    logEndpointAudit({
      operation: 'users.preview',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      targetUserUid: targetUid,
    });

    return res.status(SUCCESS_STATUS.OK).json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const equpoError = new EqupoError('Invalid query parameters');
      equpoError.status = ERROR_STATUS.VALIDATION;
      return next(equpoError);
    }

    logEndpointAudit({
      operation: 'users.preview',
      outcome: 'error',
      actorUid,
      targetUserUid: req.query?.uid as string,
      error,
    });
    return next(error);
  }
};
