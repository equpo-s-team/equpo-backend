import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import {
  addChatRoomMemberInFirestore,
  insertSystemMessage,
} from '#a/domains/room/firestore/index.js';
import { upsertTeamMembershipInFirestore } from '#a/domains/team/firestore/teamMembershipFirestore.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import {
  inviteTeamMemberSchema,
  teamIdParam,
} from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const inviteTeamMember: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(inviteTeamMemberSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const membership = await withTransaction(async client => {
      await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      let resolvedUid = input.userUid ?? null;
      if (!resolvedUid && input.email) {
        const lookup = await client.query(
          `SELECT uid FROM public."user" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [input.email]
        );
        if (!lookup.rowCount) {
          const error = new EqupoError(
            'No user found with that email address.'
          );
          error.status = ERROR_STATUS.NOT_FOUND;
          throw error;
        }
        resolvedUid = lookup.rows[0].uid as string;
      }

      if (!resolvedUid) {
        const error = new EqupoError('userUid or email is required');
        error.status = ERROR_STATUS.VALIDATION;
        throw error;
      }

      const result = await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at, virtual_currency)
         VALUES ($1, $2, $3, NOW(), 0)
         ON CONFLICT (user_uid, team_id)
         DO NOTHING
         RETURNING user_uid, team_id, role`,
        [resolvedUid, parsedTeamId, input.role]
      );

      if (!result.rowCount) {
        const error = new EqupoError(
          'User is already a member of this team. Use role-change endpoint to modify role.'
        );
        error.status = ERROR_STATUS.CONFLICT;
        throw error;
      }

      return result.rows[0];
    });

    await upsertTeamMembershipInFirestore(
      membership.team_id,
      membership.user_uid,
      membership.role
    );

    // Auto-add new member to "General" group
    const generalGroupResult = await pool.query(
      `SELECT id FROM public."group" WHERE team_id = $1 AND group_name = 'General' LIMIT 1`,
      [parsedTeamId]
    );
    if (generalGroupResult.rowCount) {
      const generalGroupId = generalGroupResult.rows[0].id as string;
      await pool.query(
        `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [generalGroupId, membership.user_uid]
      );
      await addChatRoomMemberInFirestore(
        parsedTeamId,
        generalGroupId,
        membership.user_uid,
        input.role
      );

      // Fetch display name for system message
      const userResult = await pool.query(
        `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
        [membership.user_uid]
      );
      const displayName =
        (userResult.rows[0]?.display_name as string | null) ??
        membership.user_uid;
      await insertSystemMessage(
        parsedTeamId,
        generalGroupId,
        `👋 ${displayName} se unió al equipo`
      );
    }

    logEndpointAudit({
      operation: 'teams.members.add',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      targetUserUid: membership.user_uid,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ membership });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.members.add',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
