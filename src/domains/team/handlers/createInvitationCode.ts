import { randomBytes } from 'crypto';
import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import {
  createInvitationCodeSchema,
  teamIdParam,
} from '#a/domains/team/schemas/index.js';
import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

interface InvitationCodeData {
  code: string;
  teamId: string;
  teamName: string;
  teamPhotoUrl?: string;
  role: string;
  expiresAt: string;
  maxUses: number;
  currentUses: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Generates a unique invitation code (8 characters, uppercase)
 */
function generateInviteCode(): string {
  // Generate 6 bytes = 12 hex chars, take first 8, convert to uppercase alphanumeric
  const bytes = randomBytes(6);
  return bytes
    .toString('base64')
    .replace(/[^A-Z0-9]/gi, '') // Remove non-alphanumeric
    .slice(0, 8)
    .toUpperCase();
}

/**
 * Ensures the generated code is unique in Firestore
 */
async function generateUniqueCode(db: FirebaseFirestore.Firestore, teamId: string): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const code = generateInviteCode();
    attempts++;

    // Check if code already exists in this team's invitation codes
    const existingSnapshot = await db
      .collection('teams')
      .doc(teamId)
      .collection('invitationCodes')
      .where('code', '==', code)
      .limit(1)
      .get();

    if (existingSnapshot.empty) {
      return code;
    }
  }

  throw new EqupoError('Failed to generate unique invitation code after multiple attempts');
}

export const createInvitationCode: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;

  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createInvitationCodeSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    // Verificar permisos (líder o colaborador)
    await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
    });

    // Obtener información del equipo
    const teamResult = await pool.query(
      `SELECT name FROM public.team WHERE id = $1 LIMIT 1`,
      [parsedTeamId]
    );

    if (!teamResult.rowCount || teamResult.rowCount === 0) {
      const error = new EqupoError('Team not found');
      error.status = ERROR_STATUS.NOT_FOUND;
      throw error;
    }

    const teamName = teamResult.rows[0].name as string;

    // Calcular fecha de expiración
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000);

    // Generar código único
    const db = getFirestoreDb();
    const code = await generateUniqueCode(db, parsedTeamId);

    // Obtener foto del equipo desde Firestore (si existe)
    const teamDoc = await db.collection('teams').doc(parsedTeamId).get();
    const teamData = teamDoc.data();
    const teamPhotoUrl =
      teamData?.photoURL ||
      teamData?.photoUrl ||
      teamData?.photo_url ||
      undefined;

    // Crear documento en Firestore (sin undefined values)
    const invitationData: Omit<InvitationCodeData, 'teamPhotoUrl'> & { teamPhotoUrl?: string } = {
      code,
      teamId: parsedTeamId,
      teamName,
      role: input.role,
      expiresAt: expiresAt.toISOString(),
      maxUses: input.maxUses,
      currentUses: 0,
      createdBy: authenticatedActorUid,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Solo añadir teamPhotoUrl si existe (Firestore no acepta undefined)
    if (teamPhotoUrl) {
      invitationData.teamPhotoUrl = teamPhotoUrl;
    }

    // Guardar en Firestore usando el código como ID del documento
    await db
      .collection('teams')
      .doc(parsedTeamId)
      .collection('invitationCodes')
      .doc(code)
      .set(invitationData);

    logEndpointAudit({
      operation: 'teams.invitationCodes.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      targetUserUid: null,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({
      code,
      teamId: parsedTeamId,
      teamName,
      teamPhotoUrl: teamPhotoUrl || undefined,
      role: input.role,
      expiresAt: invitationData.expiresAt,
      maxUses: input.maxUses,
      currentUses: 0,
      createdBy: authenticatedActorUid,
      createdAt: invitationData.createdAt,
    });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.invitationCodes.create',
      outcome: 'error',
      actorUid,
      teamId,
      targetUserUid: null,
      error,
    });
    return next(error);
  }
};
