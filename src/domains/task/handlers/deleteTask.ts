import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { deleteTaskFromFirestore } from '#a/domains/task/firestore/index.js';
import { teamTaskParam } from '#a/domains/task/schemas/index.js';
import {
  assertTeamPermission,
  assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const deleteTask: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    ({ teamId, taskId } = teamTaskParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedTaskId = taskId;
    const authenticatedActorUid = getActorUid(req);

    const deletedTaskId = await withTransaction(async client => {
      await assertUserBelongsToTeam(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const taskResult = await client.query(
        `SELECT id, assigned_user_uid, assigned_group_id
         FROM public.task
         WHERE id = $1 AND team_id = $2
         LIMIT 1`,
        [parsedTaskId, parsedTeamId]
      );

      if (!taskResult.rowCount) {
        const error = new EqupoError('Task not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      const task = taskResult.rows[0];
      const hasAssignment = Boolean(
        task.assigned_user_uid || task.assigned_group_id
      );

      if (hasAssignment) {
        await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
      }

      await client.query(
        `DELETE FROM public.task_category WHERE task_id = $1`,
        [parsedTaskId]
      );
      await client.query(
        `DELETE FROM public.task WHERE id = $1 AND team_id = $2`,
        [parsedTaskId, parsedTeamId]
      );

      return parsedTaskId;
    });

    await deleteTaskFromFirestore(parsedTeamId, deletedTaskId);

    logEndpointAudit({
      operation: 'tasks.delete',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: deletedTaskId,
    });

    return res.json({ deletedTaskId });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.delete',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
