import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import {
  patchStepsInFirestore,
  patchTaskStatusInFirestore,
} from '#a/domains/task/firestore/index.js';
import {
  taskStepParam,
  toggleTaskStepSchema,
} from '#a/domains/task/schemas/index.js';
import { fetchAllStepsForTask } from '#a/domains/task/utils.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const toggleTaskStep: RequestHandler = async (req, res, next) => {
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
    const input = assertBody(toggleTaskStepSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const result = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const stepResult = await client.query(
        `SELECT ts.step, ts.is_done,
                  t.status, t.assigned_user_uid, t.assigned_group_id
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

      const stepRow = stepResult.rows[0];
      const isSuperoReview = stepRow.step === 'Supero Review';
      const taskStatus: string = stepRow.status;

      if (isSuperoReview) {
        // Must be in-qa to check Supero Review
        if (taskStatus !== 'in-qa') {
          const error = new EqupoError(
            'Supero Review can only be checked when the task is In QA'
          );
          error.status = ERROR_STATUS.VALIDATION;
          throw error;
        }

        // Check actor role for restriction
        const memberResult = await client.query(
          `SELECT role FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1`,
          [parsedTeamId, authenticatedActorUid]
        );
        const actorRole: string = memberResult.rows[0]?.role ?? 'member';
        const isLeaderOrCollab =
          actorRole === 'leader' || actorRole === 'collaborator';

        // Check if actor is an assigned user
        let isAssigned = stepRow.assigned_user_uid === authenticatedActorUid;
        if (!isAssigned && stepRow.assigned_group_id) {
          const groupCheck = await client.query(
            `SELECT 1 FROM public.group_membership
               WHERE group_id = $1 AND user_uid = $2 LIMIT 1`,
            [stepRow.assigned_group_id, authenticatedActorUid]
          );
          isAssigned = (groupCheck.rowCount ?? 0) > 0;
        }

        if (isAssigned && !isLeaderOrCollab) {
          const error = new EqupoError(
            'Assigned users cannot check the Supero Review step unless they are a leader or collaborator'
          );
          error.status = ERROR_STATUS.FORBIDDEN;
          throw error;
        }
      }

      // Toggle the step
      const updatedStep = await client.query(
        `UPDATE public.task_step
           SET is_done = $1, updated_at = NOW()
           WHERE step = $2 AND task_id = $3
           RETURNING task_id AS "taskId", step, is_done AS "isDone", position,
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.isDone, parsedStepId, parsedTaskId]
      );

      let newStatus: string = taskStatus;

      if (isSuperoReview) {
        if (input.isDone) {
          // Checking Supero Review → done
          newStatus = 'done';
          await client.query(
            `UPDATE public.task SET status = 'done' WHERE id = $1`,
            [parsedTaskId]
          );
        } else if (taskStatus === 'done') {
          // Unchecking Supero Review → back to in-qa
          newStatus = 'in-qa';
          await client.query(
            `UPDATE public.task SET status = 'in-qa' WHERE id = $1`,
            [parsedTaskId]
          );
        }
      } else {
        if (input.isDone) {
          // Checking a regular step while todo → in-progress
          if (taskStatus === 'todo') {
            newStatus = 'in-progress';
            await client.query(
              `UPDATE public.task SET status = 'in-progress' WHERE id = $1`,
              [parsedTaskId]
            );
          }

          // All regular steps done while in-progress → in-qa
          const currentStatus = newStatus || taskStatus;
          if (currentStatus === 'in-progress') {
            const pendingResult = await client.query(
              `SELECT COUNT(*)::int AS cnt
                 FROM public.task_step
                 WHERE task_id = $1 AND step != 'Supero Review' AND is_done = false`,
              [parsedTaskId]
            );
            if (Number(pendingResult.rows[0]?.cnt ?? 0) === 0) {
              newStatus = 'in-qa';
              await client.query(
                `UPDATE public.task SET status = 'in-qa' WHERE id = $1`,
                [parsedTaskId]
              );
            }
          }
        } else if (taskStatus === 'in-qa' || taskStatus === 'done') {
          // Unchecking any regular step while in-qa or done → back to in-progress.
          // When coming from 'done', also auto-uncheck Supero Review so the QA gate is reset.
          newStatus = 'in-progress';
          await client.query(
            `UPDATE public.task SET status = 'in-progress' WHERE id = $1`,
            [parsedTaskId]
          );
          if (taskStatus === 'done') {
            await client.query(
              `UPDATE public.task_step SET is_done = false, updated_at = NOW()
                 WHERE task_id = $1 AND step = 'Supero Review'`,
              [parsedTaskId]
            );
          }
        }
      }

      const allSteps = await fetchAllStepsForTask(client, parsedTaskId);
      return { step: updatedStep.rows[0], newStatus, taskStatus, allSteps };
    });

    if (result.newStatus !== result.taskStatus) {
      await patchTaskStatusInFirestore(
        parsedTeamId,
        parsedTaskId,
        result.newStatus
      );
    }
    await patchStepsInFirestore(parsedTeamId, parsedTaskId, result.allSteps);

    logEndpointAudit({
      operation: 'tasks.steps.toggle',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ step: result.step, newStatus: result.newStatus });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.steps.toggle',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
