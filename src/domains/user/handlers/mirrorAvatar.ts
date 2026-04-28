import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { mirrorMyAvatarSchema } from '#a/domains/team/schemas/index.js';
import {
  assertAllowedExternalAvatarUrl,
  MAX_USER_AVATAR_BYTES,
} from '#a/domains/user/utils.js';
import { getStorageBucket } from '#a/firebaseAdmin.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

export const mirrorAvatar: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;

  try {
    const authenticatedActorUid = getActorUid(req);
    const { sourceUrl } = assertBody(mirrorMyAvatarSchema, req.body);
    const parsedAvatarUrl = assertAllowedExternalAvatarUrl(sourceUrl);

    const sourceResponse = await globalThis.fetch(parsedAvatarUrl.toString(), {
      redirect: 'follow',
    });

    if (!sourceResponse.ok) {
      throw new EqupoError(
        `Failed to fetch avatar source (${sourceResponse.status})`,
        ERROR_STATUS.SERVER_ERROR
      );
    }

    const contentType = sourceResponse.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      throw new EqupoError(
        'Avatar source must be an image',
        ERROR_STATUS.VALIDATION
      );
    }

    const avatarArrayBuffer = await sourceResponse.arrayBuffer();
    const avatarBuffer = Buffer.from(avatarArrayBuffer);

    if (!avatarBuffer.length) {
      throw new EqupoError('Avatar source is empty', ERROR_STATUS.VALIDATION);
    }

    if (avatarBuffer.length > MAX_USER_AVATAR_BYTES) {
      throw new EqupoError(
        'Avatar source exceeds 5MB limit',
        ERROR_STATUS.VALIDATION
      );
    }

    const bucket = getStorageBucket();
    const objectPath = `users/${authenticatedActorUid}/profile`;
    const downloadToken = randomUUID();

    await bucket.file(objectPath).save(avatarBuffer, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: 'public,max-age=3600',
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    await withTransaction(async client => {
      const updateResult = await client.query(
        `UPDATE public."user"
         SET photo_u_r_l = $1,
             updated_at = NOW()
         WHERE uid = $2`,
        [photoURL, authenticatedActorUid]
      );

      if (updateResult.rowCount === 0) {
        throw new EqupoError('User profile not found', ERROR_STATUS.NOT_FOUND);
      }
    });

    return res.json({ photoURL });
  } catch (error) {
    logEndpointAudit({
      operation: 'users.avatar.mirror',
      outcome: 'error',
      actorUid,
      error,
    });
    return next(error);
  }
};
