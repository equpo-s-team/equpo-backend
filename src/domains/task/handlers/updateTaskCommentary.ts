import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { patchCommentariesInFirestore } from '#a/domains/task/firestore/index.js';
import {
  taskCommentaryParam,
  updateTaskCommentarySchema,
} from '#a/domains/task/schemas/index.js';
import { fetchAllCommentariesForTask } from '#a/domains/task/utils.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const updateTaskCommentary: RequestHandler = async (req, res, next) => {
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
    const input = assertBody(updateTaskCommentarySchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const commentary = await withTransaction(async client => {
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
        const error = new EqupoError('You can only edit your own commentaries');
        error.status = ERROR_STATUS.FORBIDDEN;
        throw error;
      }

      const result = await client.query(
        `UPDATE public.task_commentary
           SET commentary = $1, updated_at = NOW()
           WHERE commentary = $2 AND task_id = $3
           RETURNING task_id AS "taskId", user_uid AS "userUid", commentary,
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.commentary, parsedCommentaryId, parsedTaskId]
      );

      const row = result.rows[0];
      const allCommentaries = await fetchAllCommentariesForTask(
        client,
        parsedTaskId
      );
      return {
        commentary: row,
        allCommentaries,
      };
    });

    await patchCommentariesInFirestore(
      parsedTeamId,
      parsedTaskId,
      commentary.allCommentaries
    );

    logEndpointAudit({
      operation: 'tasks.commentaries.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ commentary: commentary.commentary });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.commentaries.update',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
