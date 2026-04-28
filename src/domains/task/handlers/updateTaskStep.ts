import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { patchStepsInFirestore } from '#a/domains/task/firestore/index.js';
import {
  taskStepParam,
  updateTaskStepSchema,
} from '#a/domains/task/schemas/index.js';
import { fetchAllStepsForTask } from '#a/domains/task/utils.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const updateTaskStep: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    const parsedParams = taskStepParam.parse(req.params);
    teamId = parsedParams.teamId;
    taskId = parsedParams.taskId;
    const parsedTeamId = parsedParams.teamId;
    const parsedTaskId = parsedParams.taskId;
    const parsedStepId = parsedParams.stepId;
    const input = assertBody(updateTaskStepSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const step = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const stepResult = await client.query(
        `SELECT ts.step
           FROM public.task_step ts
           JOIN public.task t ON t.id = ts.task_id
           WHERE ts.step = $1 AND ts.task_id = $2 AND t.team_id = $3
           LIMIT 1`,
        [parsedStepId, parsedTaskId, parsedTeamId]
      );

      if (!stepResult.rowCount) {
        const error = new EqupoError('Step not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      if (stepResult.rows[0].step === 'Supero Review') {
        const error = new EqupoError('The Supero Review step cannot be edited');
        error.status = ERROR_STATUS.VALIDATION;
        throw error;
      }

      const result = await client.query(
        `UPDATE public.task_step
           SET step = $1, updated_at = NOW()
           WHERE step = $2 AND task_id = $3
           RETURNING task_id AS "taskId", step, is_done AS "isDone", position,
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.step, parsedStepId, parsedTaskId]
      );
      const allSteps = await fetchAllStepsForTask(client, parsedTaskId);
      return { step: result.rows[0], allSteps };
    });

    await patchStepsInFirestore(parsedTeamId, parsedTaskId, step.allSteps);

    logEndpointAudit({
      operation: 'tasks.steps.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ step: step.step });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.steps.update',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
