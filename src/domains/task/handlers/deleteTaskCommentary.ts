import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { patchCommentariesInFirestore } from '#a/domains/task/firestore/index.js';
import { taskCommentaryParam } from '#a/domains/task/schemas/index.js';
import { fetchAllCommentariesForTask } from '#a/domains/task/utils.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const deleteTaskCommentary: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    const parsedParams = taskCommentaryParam.parse(req.params);
    teamId = parsedParams.teamId;
    taskId = parsedParams.taskId;
    const parsedTeamId = parsedParams.teamId;
    const parsedTaskId = parsedParams.taskId;
    const parsedCommentaryId = parsedParams.commentaryId;
    const authenticatedActorUid = getActorUid(req);

    const allCommentaries = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const commentaryResult = await client.query(
        `SELECT tc.user_uid
           FROM public.task_commentary tc
           JOIN public.task t ON t.id = tc.task_id
           WHERE tc.commentary = $1 AND tc.task_id = $2 AND t.team_id = $3
           LIMIT 1`,
        [parsedCommentaryId, parsedTaskId, parsedTeamId]
      );

      if (!commentaryResult.rowCount) {
        const error = new EqupoError('Commentary not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      if (commentaryResult.rows[0].user_uid !== authenticatedActorUid) {
        const error = new EqupoError(
          'You can only delete your own commentaries'
        );
        error.status = ERROR_STATUS.FORBIDDEN;
        throw error;
      }

      await client.query(
        `DELETE FROM public.task_commentary WHERE commentary = $1 AND task_id = $2`,
        [parsedCommentaryId, parsedTaskId]
      );

      return fetchAllCommentariesForTask(client, parsedTaskId);
    });

    await patchCommentariesInFirestore(
      parsedTeamId,
      parsedTaskId,
      allCommentaries
    );

    logEndpointAudit({
      operation: 'tasks.commentaries.delete',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ deletedCommentaryId: parsedCommentaryId });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.commentaries.delete',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
