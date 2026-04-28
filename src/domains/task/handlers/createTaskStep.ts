import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { patchStepsInFirestore } from '#a/domains/task/firestore/index.js';
import {
  createTaskStepSchema,
  teamTaskParam,
} from '#a/domains/task/schemas/index.js';
import { fetchAllStepsForTask } from '#a/domains/task/utils.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createTaskStep: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    ({ teamId, taskId } = teamTaskParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedTaskId = taskId;
    const input = assertBody(createTaskStepSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const step = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const taskCheck = await client.query(
        `SELECT id FROM public.task WHERE id = $1 AND team_id = $2 LIMIT 1`,
        [parsedTaskId, parsedTeamId]
      );
      if (!taskCheck.rowCount) {
        const error = new EqupoError('Task not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      // Enforce max 14 user steps (position < last "Supero Review" position)
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM public.task_step WHERE task_id = $1 AND step != 'Supero Review'`,
        [parsedTaskId]
      );
      if (Number(countResult.rows[0]?.cnt ?? 0) >= 14) {
        const error = new EqupoError(
          'Maximum of 14 steps per task (excluding Supero Review)'
        );
        error.status = ERROR_STATUS.VALIDATION;
        throw error;
      }

      // Cannot add a step named "Supero Review"
      if (input.step === 'Supero Review') {
        const error = new EqupoError(
          '"Supero Review" step is auto-managed and cannot be added manually'
        );
        error.status = ERROR_STATUS.VALIDATION;
        throw error;
      }

      // Get next position (before "Supero Review")
      const superoResult = await client.query(
        `SELECT position FROM public.task_step WHERE task_id = $1 AND step = 'Supero Review' LIMIT 1`,
        [parsedTaskId]
      );
      const superoPos = superoResult.rowCount
        ? (superoResult.rows[0].position as number)
        : 0;

      // Insert before "Supero Review" — shift Supero Review position up
      await client.query(
        `UPDATE public.task_step SET position = position + 1, updated_at = NOW()
           WHERE task_id = $1 AND step = 'Supero Review'`,
        [parsedTaskId]
      );

      const result = await client.query(
        `INSERT INTO public.task_step (task_id, step, is_done, position, created_at, updated_at)
           VALUES ($1, $2, false, $3, NOW(), NOW())
           RETURNING task_id AS "taskId", step, is_done AS "isDone", position,
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
        [parsedTaskId, input.step, superoPos]
      );
      const allSteps = await fetchAllStepsForTask(client, parsedTaskId);
      return { step: result.rows[0], allSteps };
    });

    await patchStepsInFirestore(parsedTeamId, parsedTaskId, step.allSteps);

    logEndpointAudit({
      operation: 'tasks.steps.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.status(SUCCESS_STATUS.CREATED).json({ step: step.step });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.steps.create',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
