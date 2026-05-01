import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import {
  insertSystemMessage,
  removeChatRoomMemberFromFirestore,
} from '#a/domains/room/firestore/index.js';
import { deleteTeamMembershipFromFirestore } from '#a/domains/team/firestore/teamMembershipFirestore.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { teamMemberParam } from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const removeTeamMember: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let userUid: string | null = null;
  try {
    ({ teamId, userUid } = teamMemberParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedUserUid = userUid;
    const authenticatedActorUid = getActorUid(req);

    // Prevent removing yourself as leader
    if (parsedUserUid === authenticatedActorUid) {
      throw new EqupoError(
        'You cannot remove yourself from the team',
        ERROR_STATUS.VALIDATION
      );
    }

    const kickResult = await withTransaction(async client => {
      const { isLeader, role: actorRole } = await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      // Look up the target member's role
      const targetResult = await client.query(
        `SELECT tm.role
           FROM public.team_membership tm
           WHERE tm.team_id = $1 AND tm.user_uid = $2
           LIMIT 1`,
        [parsedTeamId, parsedUserUid]
      );

      if (!targetResult.rowCount) {
        throw new EqupoError(
          'Member not found in this team',
          ERROR_STATUS.NOT_FOUND
        );
      }

      const targetRole = targetResult.rows[0].role as string;

      // Prevent kicking the leader
      if (targetRole === 'leader') {
        throw new EqupoError(
          'The team leader cannot be removed',
          ERROR_STATUS.FORBIDDEN
        );
      }

      // Collaborators can only kick members/spectators, not other collaborators
      if (
        !isLeader &&
        actorRole === 'collaborator' &&
        targetRole === 'collaborator'
      ) {
        throw new EqupoError(
          'Collaborators cannot remove other collaborators',
          ERROR_STATUS.FORBIDDEN
        );
      }

      // Fetch display name for system messages
      const userResult = await client.query(
        `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
        [parsedUserUid]
      );
      const displayName =
        (userResult.rows[0]?.display_name as string | null) ?? parsedUserUid;

      // Fetch all groups this member belongs to in the team
      const groupsResult = await client.query(
        `SELECT gm.group_id
           FROM public.group_membership gm
           JOIN public."group" g ON g.id = gm.group_id
           WHERE g.team_id = $1 AND gm.user_uid = $2`,
        [parsedTeamId, parsedUserUid]
      );
      const groupIds = groupsResult.rows.map(r => r.group_id as string);

      // Remove from all group memberships
      if (groupIds.length > 0) {
        await client.query(
          `DELETE FROM public.group_membership
             WHERE user_uid = $1 AND group_id = ANY($2::uuid[])`,
          [parsedUserUid, groupIds]
        );
      }

      // Remove from team_membership
      await client.query(
        `DELETE FROM public.team_membership WHERE team_id = $1 AND user_uid = $2`,
        [parsedTeamId, parsedUserUid]
      );

      return { groupIds, displayName };
    });

    // Firestore cleanup after successful DB transaction
    await deleteTeamMembershipFromFirestore(parsedTeamId, parsedUserUid);
    for (const groupId of kickResult.groupIds) {
      await removeChatRoomMemberFromFirestore(
        parsedTeamId,
        groupId,
        parsedUserUid
      );
      await insertSystemMessage(
        parsedTeamId,
        groupId,
        `👋 ${kickResult.displayName} fue removido del equipo`
      );
    }

    logEndpointAudit({
      operation: 'teams.members.remove',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      targetUserUid: parsedUserUid,
    });

    return res.status(SUCCESS_STATUS.NO_CONTENT).end();
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.members.remove',
      outcome: 'error',
      actorUid,
      teamId,
      targetUserUid: userUid,
      error,
    });
    return next(error);
  }
};
