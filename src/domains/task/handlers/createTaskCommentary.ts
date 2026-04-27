import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { patchCommentariesInFirestore } from '#a/domains/task/firestore/index.js';
import {
  createTaskCommentarySchema,
  teamTaskParam,
} from '#a/domains/task/schemas/index.js';
import { fetchAllCommentariesForTask } from '#a/domains/task/utils.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createTaskCommentary: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    ({ teamId, taskId } = teamTaskParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedTaskId = taskId;
    const input = assertBody(createTaskCommentarySchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const commentary = await withTransaction(async client => {
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
        `INSERT INTO public.task_commentary (task_id, user_uid, commentary, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING task_id AS "taskId", user_uid AS "userUid", commentary,
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
        [parsedTaskId, authenticatedActorUid, input.commentary]
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
      operation: 'tasks.commentaries.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res
      .status(SUCCESS_STATUS.CREATED)
      .json({ commentary: commentary.commentary });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.commentaries.create',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
