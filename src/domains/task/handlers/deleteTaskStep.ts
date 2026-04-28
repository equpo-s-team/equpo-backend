import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { patchStepsInFirestore } from '#a/domains/task/firestore/index.js';
import { taskStepParam } from '#a/domains/task/schemas/index.js';
import { fetchAllStepsForTask } from '#a/domains/task/utils.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const deleteTaskStep: RequestHandler = async (req, res, next) => {
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
    const authenticatedActorUid = getActorUid(req);

    const allSteps = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const stepResult = await client.query(
        `SELECT ts.step, ts.position
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
        const error = new EqupoError(
          'The Supero Review step cannot be deleted'
        );
        error.status = ERROR_STATUS.VALIDATION;
        throw error;
      }

      const deletedPos: number = stepResult.rows[0].position;
      await client.query(
        `DELETE FROM public.task_step WHERE step = $1 AND task_id = $2`,
        [parsedStepId, parsedTaskId]
      );

      // Reorder remaining steps to close the gap
      await client.query(
        `UPDATE public.task_step
           SET position = position - 1, updated_at = NOW()
           WHERE task_id = $1 AND position > $2`,
        [parsedTaskId, deletedPos]
      );

      return fetchAllStepsForTask(client, parsedTaskId);
    });

    await patchStepsInFirestore(parsedTeamId, parsedTaskId, allSteps);

    logEndpointAudit({
      operation: 'tasks.steps.delete',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ deletedStepId: parsedStepId });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.steps.delete',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
