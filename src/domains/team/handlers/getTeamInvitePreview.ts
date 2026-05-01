import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool } from '#a/db.js';
import { invitePreviewQuerySchema } from '#a/domains/team/schemas/index.js';
import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';
import { z } from 'zod';

interface InvitationCodeData {
  teamId: string;
  role: 'collaborator' | 'spectator' | 'member';
  expiresAt: string;
  maxUses: number;
  currentUses: number;
  teamName?: string;
  teamPhotoUrl?: string;
  code: string;
}

interface TeamPreviewResponse {
  code: string;
  team: {
    id: string;
    name: string;
    photoUrl?: string;
    description?: string;
  };
  role: string;
  expiresAt: string;
  usesLeft: number;
  isValid: boolean;
}

export const getTeamInvitePreview: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;

  try {
    const authenticatedActorUid = getActorUid(req);

    // Validar query params
    const query = invitePreviewQuerySchema.parse(req.query);
    const code = query.code.toUpperCase();

    // Buscar el código de invitación en Firestore usando collectionGroup
    const db = getFirestoreDb();
    const invitationCodesSnapshot = await db
      .collectionGroup('invitationCodes')
      .where('code', '==', code)
      .limit(1)
      .get();

    if (invitationCodesSnapshot.empty) {
      const error = new EqupoError('Invalid or expired invitation code');
      error.status = ERROR_STATUS.NOT_FOUND;
      throw error;
    }

    const invitationDoc = invitationCodesSnapshot.docs[0];
    const invitationData = invitationDoc.data() as InvitationCodeData;
    const teamId = invitationData.teamId;

    // Verificar que el teamId esté presente
    if (!teamId) {
      const error = new EqupoError(
        'Invalid invitation code: missing team data'
      );
      error.status = ERROR_STATUS.SERVER_ERROR;
      throw error;
    }

    // Verificar expiración
    const now = new Date();
    const expiresAt = new Date(invitationData.expiresAt);
    const isExpired = now > expiresAt;

    // Verificar usos máximos
    const usesLeft = invitationData.maxUses - invitationData.currentUses;
    const hasUsesLeft = usesLeft > 0;

    // Si el código está expirado o sin usos, eliminarlo de Firestore y devolver error
    if (isExpired || !hasUsesLeft) {
      await invitationDoc.ref.delete();
      const error = new EqupoError(
        isExpired
          ? 'Invitation code has expired'
          : 'Invitation code has reached maximum uses'
      );
      error.status = ERROR_STATUS.FORBIDDEN;
      throw error;
    }

    const isValid = true;

    // Obtener foto del equipo (del invitationCode o directo de Firestore como fallback)
    let photoUrl = invitationData.teamPhotoUrl;
    if (!photoUrl) {
      const teamDoc = await db.collection('teams').doc(teamId).get();
      const teamData = teamDoc.data();
      photoUrl =
        teamData?.photoURL ||
        teamData?.photoUrl ||
        teamData?.photo_url ||
        undefined;
    }

    // Obtener descripción desde PostgreSQL
    const pgTeamResult = await pool.query(
      `SELECT description FROM public.team WHERE id = $1 LIMIT 1`,
      [teamId]
    );
    const pgDescription =
      (pgTeamResult.rows[0]?.description as string | undefined) || undefined;

    const response: TeamPreviewResponse = {
      code,
      team: {
        id: teamId,
        name: invitationData.teamName || 'Unknown Team',
        photoUrl,
        description: pgDescription || undefined,
      },
      role: invitationData.role,
      expiresAt: invitationData.expiresAt,
      usesLeft,
      isValid,
    };

    logEndpointAudit({
      operation: 'teams.invite.preview',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId,
    });

    return res.status(SUCCESS_STATUS.OK).json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const equpoError = new EqupoError('Invalid query parameters');
      equpoError.status = ERROR_STATUS.VALIDATION;
      return next(equpoError);
    }

    logEndpointAudit({
      operation: 'teams.invite.preview',
      outcome: 'error',
      actorUid,
      error,
    });
    return next(error);
  }
};
