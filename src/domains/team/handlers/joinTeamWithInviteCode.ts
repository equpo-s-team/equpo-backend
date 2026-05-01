import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import {
  addChatRoomMemberInFirestore,
  insertSystemMessage,
} from '#a/domains/room/firestore/index.js';
import { upsertTeamMembershipInFirestore } from '#a/domains/team/firestore/teamMembershipFirestore.js';
import { joinTeamWithInviteCodeSchema } from '#a/domains/team/schemas/index.js';
import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

interface InvitationCodeData {
  teamId: string;
  role: 'collaborator' | 'spectator' | 'member';
  expiresAt: string;
  maxUses: number;
  currentUses: number;
  teamName?: string;
}

export const joinTeamWithInviteCode: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;

  try {
    const authenticatedActorUid = getActorUid(req);
    const input = assertBody(joinTeamWithInviteCodeSchema, req.body);

    // Buscar el código de invitación en Firestore usando collectionGroup
    const db = getFirestoreDb();
    const invitationCodesSnapshot = await db
      .collectionGroup('invitationCodes')
      .where('code', '==', input.code.toUpperCase())
      .limit(1)
      .get();

    if (invitationCodesSnapshot.empty) {
      const error = new EqupoError('Invalid or expired invitation code');
      error.status = ERROR_STATUS.NOT_FOUND;
      throw error;
    }

    const invitationDoc = invitationCodesSnapshot.docs[0];
    const invitationData = invitationDoc.data() as InvitationCodeData;
    teamId = invitationData.teamId;

    // Verificar que el teamId esté presente
    if (!teamId) {
      const error = new EqupoError('Invalid invitation code: missing team data');
      error.status = ERROR_STATUS.SERVER_ERROR;
      throw error;
    }

    // Verificar expiración
    const now = new Date();
    const expiresAt = new Date(invitationData.expiresAt);
    if (now > expiresAt) {
      const error = new EqupoError('Invitation code has expired');
      error.status = ERROR_STATUS.FORBIDDEN;
      throw error;
    }

    // Verificar usos máximos
    if (invitationData.currentUses >= invitationData.maxUses) {
      const error = new EqupoError('Invitation code has reached maximum uses');
      error.status = ERROR_STATUS.FORBIDDEN;
      throw error;
    }

    // Verificar que el usuario no sea ya miembro del equipo
    const existingMemberResult = await pool.query(
      `SELECT 1 FROM public.team_membership WHERE user_uid = $1 AND team_id = $2 LIMIT 1`,
      [authenticatedActorUid, teamId]
    );

    if (existingMemberResult.rowCount && existingMemberResult.rowCount > 0) {
      const error = new EqupoError('You are already a member of this team');
      error.status = ERROR_STATUS.CONFLICT;
      throw error;
    }

    // Añadir al usuario al equipo usando transacción
    const membership = await withTransaction(async client => {
      const result = await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING user_uid, team_id, role`,
        [authenticatedActorUid, teamId, invitationData.role]
      );

      return result.rows[0];
    });

    // Actualizar Firestore - añadir membresía
    await upsertTeamMembershipInFirestore(
      membership.team_id,
      membership.user_uid,
      membership.role
    );

    // Incrementar el contador de usos del código de invitación
    await invitationDoc.ref.update({
      currentUses: invitationData.currentUses + 1,
      updatedAt: now.toISOString(),
    });

    // Auto-add new member to "General" group
    const generalGroupResult = await pool.query(
      `SELECT id FROM public."group" WHERE team_id = $1 AND group_name = 'General' LIMIT 1`,
      [teamId]
    );

    if (generalGroupResult.rowCount && generalGroupResult.rowCount > 0) {
      const generalGroupId = generalGroupResult.rows[0].id as string;
      await pool.query(
        `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [generalGroupId, authenticatedActorUid]
      );
      await addChatRoomMemberInFirestore(
        teamId,
        generalGroupId,
        authenticatedActorUid,
        invitationData.role
      );

      // Fetch display name for system message
      const userResult = await pool.query(
        `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
        [authenticatedActorUid]
      );
      const displayName =
        (userResult.rows[0]?.display_name as string | null) ?? authenticatedActorUid;
      await insertSystemMessage(
        teamId,
        generalGroupId,
        `👋 ${displayName} se unió al equipo`
      );
    }

    logEndpointAudit({
      operation: 'teams.join.withInviteCode',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId,
      targetUserUid: authenticatedActorUid,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({
      membership,
      team: {
        id: teamId,
        name: invitationData.teamName || 'Unknown Team',
      },
    });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.join.withInviteCode',
      outcome: 'error',
      actorUid,
      teamId,
      targetUserUid: actorUid,
      error,
    });
    return next(error);
  }
};
