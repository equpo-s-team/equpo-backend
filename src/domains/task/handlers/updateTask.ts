import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { withTransaction } from '#a/db.js';
import { upsertTaskInFirestore } from '#a/domains/task/firestore/index.js';
import { grantTaskCompletionRewards } from '#a/domains/task/helpers/grantTaskCompletionRewards.js';
import {
  teamTaskParam,
  updateTaskSchema,
} from '#a/domains/task/schemas/index.js';
import {
  assertTaskAssignmentsWithinTeam,
  normalizeCategories,
} from '#a/domains/task/utils.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const updateTask: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  let taskId: string | null = null;
  try {
    ({ teamId, taskId } = teamTaskParam.parse(req.params));
    const parsedTeamId = teamId;
    const parsedTaskId = taskId;
    const input = assertBody(updateTaskSchema, req.body);
    const authenticatedActorUid = getActorUid(req);
    const normalizedCategories =
      input.categories !== undefined
        ? normalizeCategories(input.categories)
        : undefined;

    if (!Object.keys(input).length) {
      return res
        .status(ERROR_STATUS.VALIDATION)
        .json({ error: 'No fields to update' });
    }
    let previousStatus: string | null = null;
    const task = await withTransaction(async client => {
      const membership = await assertTeamPermission(
        client,
        parsedTeamId,
        authenticatedActorUid
      );

      const taskResult = await client.query(
        `SELECT id, due_date, status, priority, assigned_user_uid, assigned_group_id
           FROM public.task
           WHERE id = $1 AND team_id = $2
           LIMIT 1`,
        [parsedTaskId, parsedTeamId]
      );

      if (!taskResult.rowCount) {
        const error = new EqupoError('Task not found');
        error.status = ERROR_STATUS.NOT_FOUND;
        throw error;
      }

      const existingTask = taskResult.rows[0];

      const hasAssignees =
        existingTask.assigned_user_uid !== null ||
        existingTask.assigned_group_id !== null;
      const isLeaderOrCollab =
        membership.isLeader || membership.role === 'collaborator';

      if (!isLeaderOrCollab && hasAssignees) {
        const isAssignedQuery = await client.query(
          `SELECT 1 WHERE $1::text = $3::text
           UNION
           SELECT 1 FROM public.group_membership WHERE group_id = $2 AND user_uid = $3`,
          [
            existingTask.assigned_user_uid,
            existingTask.assigned_group_id,
            authenticatedActorUid,
          ]
        );
        if (!isAssignedQuery.rowCount) {
          const error = new EqupoError(
            'Forbidden: only assigned users can edit this task'
          );
          error.status = ERROR_STATUS.FORBIDDEN;
          throw error;
        }
      }

      previousStatus = existingTask.status as string;
      const isOverdue =
        existingTask.status !== 'done' &&
        new Date(existingTask.due_date) < new Date();

      if (isOverdue) {
        await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
      }

      await assertTaskAssignmentsWithinTeam(
        client,
        parsedTeamId,
        input.assignedUserUid,
        input.assignedGroupId
      );

      const updates: string[] = [];
      const values: Array<string | number | boolean | null> = [];
      let index = 1;

      if (input.dueDate !== undefined) {
        updates.push(`due_date = $${index++}::timestamptz`);
        values.push(input.dueDate);
      }
      if (input.priority !== undefined) {
        updates.push(`priority = $${index++}`);
        values.push(input.priority);
      }
      if (input.status !== undefined) {
        updates.push(`status = $${index++}`);
        values.push(input.status);
      }
      if (input.isRecurring !== undefined) {
        updates.push(`is_recurring = $${index++}`);
        values.push(input.isRecurring);
      }
      if (input.recurringInterval !== undefined) {
        updates.push(`recurring_interval = $${index++}`);
        values.push(input.recurringInterval);
      }
      if (input.recurringCount !== undefined) {
        updates.push(`recurring_count = $${index++}`);
        values.push(input.recurringCount);
      }
      if (input.assignedUserUid !== undefined) {
        updates.push(`assigned_user_uid = $${index++}`);
        values.push(input.assignedUserUid);
      }
      if (input.assignedGroupId !== undefined) {
        updates.push(`assigned_group_id = $${index++}`);
        values.push(input.assignedGroupId);
      }

      values.push(parsedTaskId, parsedTeamId);

      const result = await client.query(
        `UPDATE public.task
         SET ${updates.join(', ')}
         WHERE id = $${index++} AND team_id = $${index}
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
        values
      );

      if (normalizedCategories !== undefined) {
        await client.query(
          `DELETE FROM public.task_category WHERE task_id = $1`,
          [parsedTaskId]
        );

        for (const category of normalizedCategories) {
          await client.query(
            `INSERT INTO public.task_category (task_id, name)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
            [parsedTaskId, category]
          );
        }
      }

      // Uncheck "Supero Review" when moving status backward from 'done'
      if (
        input.status !== undefined &&
        existingTask.status === 'done' &&
        input.status !== 'done'
      ) {
        await client.query(
          `UPDATE public.task_step
             SET is_done = false, updated_at = NOW()
             WHERE task_id = $1 AND step = 'Supero Review'`,
          [parsedTaskId]
        );
      }

      const categoryResult = await client.query(
        `SELECT name FROM public.task_category WHERE task_id = $1 ORDER BY name ASC`,
        [parsedTaskId]
      );

      return {
        ...result.rows[0],
        categories: categoryResult.rows.map(row => row.name as string),
      };
    });

    // ── XP, Coins & Achievements on task completion ─────────────────
    let xpReward = null;
    let unlockedAchievements: Array<{
      id: string;
      name: string;
      description: string | null;
      iconUrl: string | null;
      unlockedAt: string;
    }> = [];

    const isTransitionToDone =
      input.status === 'done' &&
      previousStatus !== null &&
      previousStatus !== 'done';

    if (isTransitionToDone) {
      const result = await withTransaction(client =>
        grantTaskCompletionRewards({
          client,
          teamId: parsedTeamId,
          taskId: parsedTaskId,
          actorUid: authenticatedActorUid,
          taskPriority: (task.priority as string) ?? 'medium',
          assignedUserUid: (task.assignedUserUid as string | null) ?? null,
          assignedGroupId: (task.assignedGroupId as string | null) ?? null,
        })
      );
      xpReward = result.xpReward;
      unlockedAchievements = result.unlockedAchievements;
    }

    await upsertTaskInFirestore({
      taskId: task.id as string,
      teamId: task.teamId as string,
      name: input.name,
      description: input.description,
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

    logEndpointAudit({
      operation: 'tasks.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      taskId: parsedTaskId,
    });

    const response: Record<string, unknown> = { task };
    if (xpReward) response.xpReward = xpReward;
    if (unlockedAchievements.length > 0) {
      response.unlockedAchievements = unlockedAchievements;
    }

    return res.json(response);
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.update',
      outcome: 'error',
      actorUid,
      teamId,
      taskId,
      error,
    });
    return next(error);
  }
};
