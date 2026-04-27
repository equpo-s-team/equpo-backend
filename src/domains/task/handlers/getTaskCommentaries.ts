import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { teamTaskParam } from '#a/domains/task/schemas/index.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getTaskCommentaries: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    ({ teamId, taskId } = teamTaskParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedTaskId = taskId;
    const authenticatedActorUid = getActorUid(req);

    const commentaries = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const taskCheck = await client.query(
        `SELECT id FROM public.task WHERE id = $1 AND team_id = $2 LIMIT 1`,
        [parsedTaskId, parsedTeamId]
      );
      if (!taskCheck.rowCount) {
        const error = new EqupoError('Task not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      const result = await client.query(
        `SELECT tc.task_id AS "taskId",
                  tc.user_uid AS "userUid",
                  u.display_name AS "displayName",
                  tc.commentary,
                  tc.created_at AS "createdAt",
                  tc.updated_at AS "updatedAt"
           FROM public.task_commentary tc
           JOIN public."user" u ON u.uid = tc.user_uid
           WHERE tc.task_id = $1
           ORDER BY tc.created_at DESC`,
        [parsedTaskId]
      );
      return result.rows;
    });

    logEndpointAudit({
      operation: 'tasks.commentaries.list',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ commentaries });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.commentaries.list',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
