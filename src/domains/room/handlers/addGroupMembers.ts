import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import {
  addChatRoomMemberInFirestore,
  insertSystemMessage,
} from '#a/domains/room/firestore/index.js';
import { addGroupMembersSchema } from '#a/domains/room/schemas/index.js';
import { assertGroupBelongsToTeam } from '#a/domains/task/guards/index.js';
import {
  assertTeamPermission,
  assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const addGroupMembers: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const groupId = String(req.params.groupId ?? '');
    const parsedTeamId = teamId;
    const input = assertBody(addGroupMembersSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
      await assertGroupBelongsToTeam(client, parsedTeamId, groupId);

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM public.group_membership WHERE group_id = $1`,
        [groupId]
      );
      const currentCount = Number(countResult.rows[0]?.cnt ?? 0);
      if (currentCount + input.memberUids.length > 40) {
        throw new EqupoError(
          'Group cannot exceed 40 members',
          ERROR_STATUS.VALIDATION
        );
      }

      for (const uid of input.memberUids) {
        await assertUserBelongsToTeam(client, parsedTeamId, uid);

        // Reject spectators from work groups
        const roleResult = await client.query(
          `SELECT role FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1`,
          [parsedTeamId, uid]
        );
        if (roleResult.rows[0]?.role === 'spectator') {
          throw new EqupoError(
            'Spectators cannot be added to work groups',
            ERROR_STATUS.VALIDATION
          );
        }

        await client.query(
          `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [groupId, uid]
        );
      }
    });

    for (const uid of input.memberUids) {
      await addChatRoomMemberInFirestore(parsedTeamId, groupId, uid, 'member');

      const userResult = await pool.query(
        `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
        [uid]
      );
      const displayName =
        (userResult.rows[0]?.display_name as string | null) ?? uid;
      await insertSystemMessage(
        parsedTeamId,
        groupId,
        `👤 ${displayName} fue agregado al grupo`
      );
    }

    logEndpointAudit({
      operation: 'teams.groups.members.add',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res
      .status(SUCCESS_STATUS.CREATED)
      .json({ added: input.memberUids.length });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.groups.members.add',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
