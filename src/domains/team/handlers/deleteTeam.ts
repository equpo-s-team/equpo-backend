import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import {
  deleteTeamFromFirestore,
  deleteTeamStorageFiles,
} from '#a/domains/team/firestore/teamDeleteFirestore.js';
import { assertTeamLeaderPermission } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const deleteTeam: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    await withTransaction(async client => {
      // Only the leader can delete the team
      await assertTeamLeaderPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      // Cascade: task_category → task → group_membership → group → team_membership → team
      await client.query(
        `DELETE FROM public.task_category
           WHERE task_id IN (SELECT id FROM public.task WHERE team_id = $1)`,
        [parsedTeamId]
      );
      await client.query(`DELETE FROM public.task WHERE team_id = $1`, [
        parsedTeamId,
      ]);
      await client.query(
        `DELETE FROM public.group_membership
           WHERE group_id IN (SELECT id FROM public."group" WHERE team_id = $1)`,
        [parsedTeamId]
      );
      await client.query(`DELETE FROM public."group" WHERE team_id = $1`, [
        parsedTeamId,
      ]);
      await client.query(
        `DELETE FROM public.team_membership WHERE team_id = $1`,
        [parsedTeamId]
      );
      await client.query(`DELETE FROM public.team WHERE id = $1`, [
        parsedTeamId,
      ]);
    });

    // After DB cleanup — Firestore + Storage (best-effort, non-blocking on partial failure)
    await Promise.allSettled([
      deleteTeamFromFirestore(parsedTeamId),
      deleteTeamStorageFiles(parsedTeamId),
    ]);

    logEndpointAudit({
      operation: 'teams.delete',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.NO_CONTENT).end();
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.delete',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
