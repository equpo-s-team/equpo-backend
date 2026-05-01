import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
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
  teamDescription?: string;
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
      const error = new EqupoError('Invalid invitation code: missing team data');
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

    const isValid = !isExpired && hasUsesLeft;

    // Verificar si el usuario ya es miembro (para mostrar en el preview)
    // Nota: Esto es opcional, el frontend puede verificarlo después

    const response: TeamPreviewResponse = {
      code,
      team: {
        id: teamId,
        name: invitationData.teamName || 'Unknown Team',
        photoUrl: invitationData.teamPhotoUrl,
        description: invitationData.teamDescription,
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
