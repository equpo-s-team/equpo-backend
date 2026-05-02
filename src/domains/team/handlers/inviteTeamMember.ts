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
      await assertTeamAdminPermission(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_uid, team_id)
         DO NOTHING
         RETURNING user_uid, team_id, role`,
        [input.userUid, parsedTeamId, input.role]
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
        [generalGroupId, input.userUid]
      );
      await addChatRoomMemberInFirestore(
        parsedTeamId,
        generalGroupId,
        input.userUid,
        input.role
      );

      // Fetch display name for system message
      const userResult = await pool.query(
        `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
        [input.userUid]
      );
      const displayName =
        (userResult.rows[0]?.display_name as string | null) ?? input.userUid;
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
      targetUserUid: input.userUid,
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
