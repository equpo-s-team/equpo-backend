import { config } from '#a/config.js';
import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import { insertSystemMessage } from '#a/domains/room/firestore/index.js';
import { zegoTokenParam } from '#a/domains/room/schemas/index.js';
import { generateZegoToken } from '#a/domains/room/zegoToken.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const generateZegoTokenEndpoint: RequestHandler = async (
  req,
  res,
  next
) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    const params = zegoTokenParam.parse(req.params);
    teamId = params.teamId;
    const parsedTeamId = params.teamId;
    const roomId = params.roomId;
    const authenticatedActorUid = getActorUid(req);

    await withTransaction(async client => {
      const groupCheck = await client.query(
        `SELECT 1 FROM public."group" g
           WHERE g.id = $1 AND g.team_id = $2
           AND (
             EXISTS (SELECT 1 FROM public.group_membership gm WHERE gm.group_id = $1 AND gm.user_uid = $3)
             OR EXISTS (SELECT 1 FROM public.team t WHERE t.id = $2 AND t.leader_uid = $3)
           )
           LIMIT 1`,
        [roomId, parsedTeamId, authenticatedActorUid]
      );

      if (!groupCheck.rowCount) {
        throw new EqupoError(
          'Forbidden: not a member of this group',
          ERROR_STATUS.FORBIDDEN
        );
      }
    });

    const payloadString = JSON.stringify({
      room_id: roomId,
      privilege: { '1': 1, '2': 1 },
      stream_id_list: null,
    });

    const token = generateZegoToken(
      config.zegoAppId,
      authenticatedActorUid,
      config.zegoServerSecret,
      config.zegoTokenTtlSeconds,
      payloadString
    );

    const expiresAt = new Date(
      Date.now() + config.zegoTokenTtlSeconds * 1000
    ).toISOString();

    const userResult = await pool.query(
      `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
      [authenticatedActorUid]
    );
    const displayName =
      (userResult.rows[0]?.display_name as string | null) ??
      authenticatedActorUid;
    await insertSystemMessage(
      parsedTeamId,
      roomId,
      `📹 ${displayName} inició una videollamada`
    );

    logEndpointAudit({
      operation: 'rooms.zegoToken',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.OK).json({
      token,
      appId: config.zegoAppId,
      userId: authenticatedActorUid,
      roomId,
      expiresAt,
    });
  } catch (error) {
    logEndpointAudit({
      operation: 'rooms.zegoToken',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
