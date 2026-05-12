import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { deleteChatRoomFromFirestore } from '#a/domains/room/firestore/index.js';
import { groupIdParam } from '#a/domains/room/schemas/index.js';
import { assertGroupBelongsToTeam } from '#a/domains/task/guards/index.js';
import { assertTeamAdminPermission } from '#a/domains/team/guards/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const deleteGroup: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    const { teamId: parsedTeamId, groupId } = groupIdParam.parse(req.params);
    teamId = parsedTeamId;
    const authenticatedActorUid = getActorUid(req);

    await withTransaction(async client => {
      // Allow leaders and collaborators to delete
      await assertTeamAdminPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );
      await assertGroupBelongsToTeam(client, parsedTeamId, groupId);

      // Delete group memberships first
      await client.query(
        `DELETE FROM public.group_membership WHERE group_id = $1`,
        [groupId]
      );

      // Delete the group itself
      await client.query(
        `DELETE FROM public."group" WHERE id = $1 AND team_id = $2`,
        [groupId, parsedTeamId]
      );

      // Note: we are currently not nullifying task assignments that point to this group.
      // If task.assigned_group_id references public."group"(id) ON DELETE SET NULL,
      // the DB constraint will handle it.
    });

    // Mirror deletion to Firestore
    await deleteChatRoomFromFirestore(parsedTeamId, groupId);

    logEndpointAudit({
      operation: 'teams.groups.delete',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.NO_CONTENT).end();
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.groups.delete',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
