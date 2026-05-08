import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import {
  addChatRoomMemberInFirestore,
  insertSystemMessage,
  removeChatRoomMemberFromFirestore,
  updateChatRoomInFirestore,
} from '#a/domains/room/firestore/index.js';
import {
  groupIdParam,
  updateGroupSchema,
} from '#a/domains/room/schemas/index.js';
import { assertGroupBelongsToTeam } from '#a/domains/task/guards/index.js';
import {
  assertTeamAdminPermission,
  assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const updateGroup: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    const { teamId: parsedTeamId, groupId } = groupIdParam.parse(req.params);
    teamId = parsedTeamId;
    const input = assertBody(updateGroupSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const membersToAdd: string[] = [];
    const membersToRemove: string[] = [];

    await withTransaction(async client => {
      // Allow leaders and collaborators to edit
      await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );
      await assertGroupBelongsToTeam(client, parsedTeamId, groupId);

      // Update group details if provided
      if (input.name !== undefined || input.photoUrl !== undefined) {
        const updates: string[] = [];
        const values: Array<string | null> = [];
        let index = 1;

        if (input.name !== undefined) {
          updates.push(`group_name = $${index++}`);
          values.push(input.name);
        }
        if (input.photoUrl !== undefined) {
          updates.push(`photo_u_r_l = $${index++}`);
          values.push(input.photoUrl);
        }

        if (updates.length > 0) {
          values.push(groupId, parsedTeamId);
          await client.query(
            `UPDATE public."group" SET ${updates.join(', ')} WHERE id = $${index++} AND team_id = $${index}`,
            values
          );
        }
      }

      // Update members if provided
      if (input.memberUids) {
        if (input.memberUids.length > 40) {
          throw new EqupoError(
            'Group cannot exceed 40 members',
            ERROR_STATUS.VALIDATION
          );
        }

        const currentMembersResult = await client.query(
          `SELECT user_uid FROM public.group_membership WHERE group_id = $1`,
          [groupId]
        );
        const currentMembers = currentMembersResult.rows.map(
          r => r.user_uid as string
        );

        const newMembersSet = new Set(input.memberUids);
        const currentMembersSet = new Set(currentMembers);

        for (const uid of input.memberUids) {
          if (!currentMembersSet.has(uid)) {
            membersToAdd.push(uid);
          }
        }

        for (const uid of currentMembers) {
          if (!newMembersSet.has(uid)) {
            membersToRemove.push(uid);
          }
        }

        // Validate new members
        for (const uid of membersToAdd) {
          await assertUserBelongsToTeam(client, parsedTeamId, uid);
        }

        // Apply removals
        if (membersToRemove.length > 0) {
          await client.query(
            `DELETE FROM public.group_membership WHERE group_id = $1 AND user_uid = ANY($2::uuid[])`,
            [groupId, membersToRemove]
          );
        }

        // Apply additions
        if (membersToAdd.length > 0) {
          for (const uid of membersToAdd) {
            await client.query(
              `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [groupId, uid]
            );
          }
        }
      }
    });

    // Firestore mirror updates
    if (input.name !== undefined || input.photoUrl !== undefined) {
      await updateChatRoomInFirestore(parsedTeamId, groupId, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.photoUrl !== undefined && {
          photoUrl: input.photoUrl ?? undefined,
        }),
        ...(input.photoUrl !== undefined && {
          photoUrl: input.photoUrl ?? undefined,
        }),
      });
      await insertSystemMessage(
        parsedTeamId,
        groupId,
        `🛠️ La información del grupo fue actualizada`
      );
    }

    if (membersToRemove.length > 0) {
      for (const uid of membersToRemove) {
        await removeChatRoomMemberFromFirestore(parsedTeamId, groupId, uid);

        const userResult = await pool.query(
          `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
          [uid]
        );
        const displayName =
          (userResult.rows[0]?.display_name as string | null) ?? uid;
        await insertSystemMessage(
          parsedTeamId,
          groupId,
          `🚪 ${displayName} fue removido del grupo`
        );
      }
    }

    if (membersToAdd.length > 0) {
      for (const uid of membersToAdd) {
        await addChatRoomMemberInFirestore(
          parsedTeamId,
          groupId,
          uid,
          'member'
        );

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
    }

    logEndpointAudit({
      operation: 'teams.groups.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.OK).json({ success: true });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.groups.update',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
