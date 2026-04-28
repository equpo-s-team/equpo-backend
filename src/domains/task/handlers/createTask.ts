import { SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import {
  patchStepsInFirestore,
  upsertTaskInFirestore,
} from '#a/domains/task/firestore/index.js';
import { createTaskSchema } from '#a/domains/task/schemas/index.js';
import {
  assertTaskAssignmentsWithinTeam,
  normalizeCategories,
} from '#a/domains/task/utils.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createTask: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createTaskSchema, req.body);
    const authenticatedActorUid = getActorUid(req);
    const normalizedCategories = normalizeCategories(input.categories);

    // Always force status to 'todo'
    const forcedStatus = 'todo';

    const task = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
      await assertTaskAssignmentsWithinTeam(
        client,
        parsedTeamId,
        input.assignedUserUid,
        input.assignedGroupId
      );

      const result = await client.query(
        `INSERT INTO public.task
           (team_id, due_date, priority, status, is_recurring, recurring_interval, recurring_count, assigned_user_uid, assigned_group_id)
         VALUES ($1, $2::timestamptz, $3, $4, COALESCE($5, false), $6, $7, $8, $9)
         RETURNING id,
                   team_id AS "teamId",
                   due_date AS "dueDate",
                   priority,
                   status,
                   is_recurring AS "isRecurring",
                   recurring_interval AS "recurringInterval",
                   recurring_count AS "recurringCount",
                   assigned_user_uid AS "assignedUserUid",
                   assigned_group_id AS "assignedGroupId"`,
        [
          parsedTeamId,
          input.dueDate,
          input.priority,
          forcedStatus,
          input.isRecurring ?? false,
          input.recurringInterval ?? null,
          input.recurringCount ?? null,
          input.assignedUserUid ?? null,
          input.assignedGroupId ?? null,
        ]
      );

      const createdTask = result.rows[0];

      if (normalizedCategories.length) {
        for (const category of normalizedCategories) {
          await client.query(
            `INSERT INTO public.task_category (task_id, name)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [createdTask.id, category]
          );
        }
      }

      // Insert user-defined steps + auto-append "Supero Review"
      const userSteps = input.steps ?? [];
      for (let i = 0; i < userSteps.length; i++) {
        await client.query(
          `INSERT INTO public.task_step (task_id, step, is_done, position, created_at, updated_at)
             VALUES ($1, $2, false, $3, NOW(), NOW())
             ON CONFLICT (task_id, step) DO NOTHING`,
          [createdTask.id, userSteps[i], i]
        );
      }
      // Always append "Supero Review" as the last step
      await client.query(
        `INSERT INTO public.task_step (task_id, step, is_done, position, created_at, updated_at)
           VALUES ($1, 'Supero Review', false, $2, NOW(), NOW())
           ON CONFLICT (task_id, step) DO NOTHING`,
        [createdTask.id, userSteps.length]
      );

      return {
        ...createdTask,
        categories: normalizedCategories,
        stepsTotal: userSteps.length + 1,
        stepsDone: 0,
      };
    });

    await upsertTaskInFirestore({
      taskId: task.id as string,
      teamId: task.teamId as string,
      name: input.name,
      description: input.description ?? null,
      dueDate: task.dueDate as string | Date,
      priority: task.priority as string,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      category: task.categories as string[],
      status: task.status as string,
      isRecurring: Boolean(task.isRecurring),
      recurringInterval: (task.recurringInterval as string | null) ?? null,
      recurringCount: (task.recurringCount as number | null) ?? null,
      assignedUserId: (task.assignedUserUid as string | null) ?? null,
      assignedGroup: (task.assignedGroupId as string | null) ?? null,
    });

    const now = new Date();
    const userStepsInput = (input.steps ?? []) as string[];
    await patchStepsInFirestore(task.teamId as string, task.id as string, [
      ...userStepsInput.map((s, i) => ({
        step: s,
        isDone: false,
        position: i,
        createdAt: now,
        updatedAt: now,
      })),
      {
        step: 'Supero Review',
        isDone: false,
        position: userStepsInput.length,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    logEndpointAudit({
      operation: 'tasks.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: task.id as string,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ task });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.create',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
