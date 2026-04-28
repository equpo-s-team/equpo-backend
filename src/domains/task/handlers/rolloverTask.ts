import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import {
  patchStepsInFirestore,
  patchTaskRolloverInFirestore,
  upsertTaskInFirestore,
} from '#a/domains/task/firestore/index.js';
import { teamTaskParam } from '#a/domains/task/schemas/index.js';
import { advanceDueDate } from '#a/domains/task/utils.js';
import { assertUserBelongsToTeam } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const rolloverTask: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    ({ teamId, taskId } = teamTaskParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedTaskId = taskId;
    const authenticatedActorUid = getActorUid(req);
    const { expectedDueDate } = req.body as { expectedDueDate: string };

    const rolledOver = await withTransaction(async client => {
      await assertUserBelongsToTeam(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const taskResult = await client.query(
        `SELECT id, due_date, status, is_recurring, recurring_interval, recurring_count
           FROM public.task
           WHERE id = $1 AND team_id = $2
           LIMIT 1`,
        [parsedTaskId, parsedTeamId]
      );

      if (!taskResult.rowCount) {
        const err = new EqupoError('Task not found');
        err.status = ERROR_STATUS.NOT_FOUND;
        throw err;
      }

      const t = taskResult.rows[0];
      if (!t.is_recurring || !t.recurring_interval || !t.recurring_count)
        return false;

      const currentDue = new Date(t.due_date as string);
      if (currentDue.toISOString() !== new Date(expectedDueDate).toISOString())
        return false;
      if (currentDue.getTime() > Date.now()) return false;

      const nextDue = advanceDueDate(
        currentDue,
        t.recurring_interval as string,
        t.recurring_count as number
      );

      if ((t.status as string) !== 'done') {
        // Clone as a new non-recurring task with the missed due date
        const copyResult = await client.query(
          `SELECT name, description, priority, assigned_user_uid, assigned_group_id
             FROM public.task WHERE id = $1 LIMIT 1`,
          [parsedTaskId]
        );
        const src = copyResult.rows[0];

        const newTask = await client.query(
          `INSERT INTO public.task
               (team_id, name, description, due_date, priority, status,
                is_recurring, recurring_interval, recurring_count,
                assigned_user_uid, assigned_group_id)
             VALUES ($1, $2, $3, $4::timestamptz, $5, 'todo', false, NULL, NULL, $6, $7)
             RETURNING id`,
          [
            parsedTeamId,
            src.name,
            src.description ?? '',
            currentDue.toISOString(),
            src.priority,
            src.assigned_user_uid ?? null,
            src.assigned_group_id ?? null,
          ]
        );

        const newTaskId = newTask.rows[0].id as string;

        // Copy steps (preserving isDone from the missed occurrence)
        const stepsResult = await client.query(
          `SELECT step_text, is_done, position FROM public.task_step
             WHERE task_id = $1 ORDER BY position ASC`,
          [parsedTaskId]
        );
        for (const step of stepsResult.rows) {
          await client.query(
            `INSERT INTO public.task_step (task_id, step_text, is_done, position, created_at, updated_at)
               VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [newTaskId, step.step_text, step.is_done, step.position]
          );
        }

        const now = new Date();
        await upsertTaskInFirestore({
          teamId: parsedTeamId,
          taskId: newTaskId,
          name: src.name as string,
          description: (src.description as string | null) ?? '',
          dueDate: currentDue,
          priority: src.priority as string,
          status: 'todo',
          isRecurring: false,
          recurringInterval: null,
          recurringCount: null,
          assignedUserId: (src.assigned_user_uid as string | null) ?? null,
          assignedGroup: (src.assigned_group_id as string | null) ?? null,
          category: [],
          createdAt: now,
          updatedAt: now,
        });
      }

      // Advance recurring task: new due date, reset status, reset steps
      await client.query(
        `UPDATE public.task
           SET due_date = $1::timestamptz, status = 'todo', updated_at = NOW()
           WHERE id = $2`,
        [nextDue.toISOString(), parsedTaskId]
      );

      await client.query(
        `UPDATE public.task_step SET is_done = false, updated_at = NOW()
           WHERE task_id = $1`,
        [parsedTaskId]
      );

      // Sync recurring task dueDate + status back to Firestore
      await patchTaskRolloverInFirestore(parsedTeamId, parsedTaskId, nextDue);

      const updatedStepsResult = await client.query(
        `SELECT step_text AS "step", is_done AS "isDone", position,
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM public.task_step WHERE task_id = $1 ORDER BY position ASC`,
        [parsedTaskId]
      );
      await patchStepsInFirestore(
        parsedTeamId,
        parsedTaskId,
        updatedStepsResult.rows
      );

      return true;
    });

    logEndpointAudit({
      operation: 'tasks.rollover',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });
    return res.json({ rolledOver });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.rollover',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
