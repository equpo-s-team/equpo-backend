import cors from 'cors';
import express, {
  Application,
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
  Router,
} from 'express';
import { requireUser } from '#a/auth.js';
import { requireSystem } from '#a/systemAuth.js';
import { withTransaction } from '#a/db.js';
import { config } from '#a/config.js';
import { assertBody, createUserRateLimitMiddleware } from '#a/utils/index.js';
import {
  assertTeamLeaderPermission,
  assertTeamPermission,
  assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import { assertGroupBelongsToTeam } from '#a/domains/task/guards/index.js';
import {
  createAchievementSchema,
  unlockAchievementSchema,
} from '#a/domains/achievement/schemas/index.js';
import { createSystemUserRewardSchema } from '#a/domains/reward/schemas/index.js';
import {
  createTaskSchema,
  taskListPaginationQuery,
  teamTaskParam,
  updateTaskSchema,
} from '#a/domains/task/schemas/index.js';
import {
  createTeamRewardSchema,
  createTeamSchema,
  inviteTeamMemberSchema,
  teamIdParam,
  teamMemberParam,
  updateTeamMemberRoleSchema,
  updateTeamSchema,
} from '#a/domains/team/schemas/index.js';
import winston from 'winston';
import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';

function getActorUid(req: Request): string {
  if (!req.user) {
    throw new EqupoError(
      'Missing authenticated user',
      ERROR_STATUS.UNAUTHORIZED
    );
  }
  return req.user.uid;
}

type AuditOutcome = 'success' | 'error';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

function logEndpointAudit(params: {
  operation: string;
  outcome: AuditOutcome;
  actorUid: string | null;
  teamId?: string | null;
  taskId?: string | null;
  targetUserUid?: string | null;
  error?: unknown;
}) {
  const payload = {
    operation: params.operation,
    outcome: params.outcome,
    actorUid: params.actorUid,
    teamId: params.teamId ?? null,
    taskId: params.taskId ?? null,
    targetUserUid: params.targetUserUid ?? null,
    at: new Date().toISOString(),
    error: params.error ? getErrorMessage(params.error) : undefined,
  };

  if (params.outcome === 'success') {
    winston.info('task_audit', payload);
    return;
  }

  winston.warn('task_audit', payload);
}

async function assertTaskAssignmentsWithinTeam(
  client: import('pg').PoolClient,
  teamId: string,
  assignedUserUid?: string | null,
  assignedGroupId?: string | null
) {
  if (assignedUserUid) {
    await assertUserBelongsToTeam(client, teamId, assignedUserUid);
  }

  if (assignedGroupId) {
    await assertGroupBelongsToTeam(client, teamId, assignedGroupId);
  }
}

function normalizeCategories(categories: string[] | undefined): string[] {
  if (!categories?.length) return [];
  return [...new Set(categories)];
}

export const app: Application = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const api: Router = express.Router();
const userRateLimit = createUserRateLimitMiddleware(config.rateLimit);

api.get('/health', (_req, res) => {
  res.json({ ok: true, prefix: config.apiPrefix });
});

api.post('/teams', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  try {
    const input = assertBody(createTeamSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const team = await withTransaction(async client => {
      const teamResult = await client.query(
        `INSERT INTO public.team (name, leader_uid, virtual_currency, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, name, leader_uid, virtual_currency, description`,
        [
          input.name,
          authenticatedActorUid,
          input.virtualCurrency,
          input.description ?? null,
        ]
      );

      await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, 'leader', NOW())
         ON CONFLICT (user_uid, team_id) DO UPDATE SET role = 'leader'`,
        [authenticatedActorUid, teamResult.rows[0].id]
      );

      return teamResult.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: team.id as string,
    });

    res.status(201).json({ team });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.create',
      outcome: 'error',
      actorUid,
      error,
    });
    next(error);
  }
});

api.patch('/teams/:teamId', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(updateTeamSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    if (!Object.keys(input).length) {
      return res
        .status(ERROR_STATUS.VALIDATION)
        .json({ error: 'No fields to update' });
    }

    const team = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const updates: string[] = [];
      const values: Array<string | number | null> = [];
      let index = 1;

      if (input.name !== undefined) {
        updates.push(`name = $${index++}`);
        values.push(input.name);
      }
      if (input.description !== undefined) {
        updates.push(`description = $${index++}`);
        values.push(input.description);
      }
      if (input.virtualCurrency !== undefined) {
        updates.push(`virtual_currency = $${index++}`);
        values.push(input.virtualCurrency);
      }

      updates.push('updated_at = NOW()');
      values.push(parsedTeamId);

      const result = await client.query(
        `UPDATE public.team SET ${updates.join(', ')} WHERE id = $${index} RETURNING id, name, leader_uid, virtual_currency, description, updated_at`,
        values
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.update',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ team });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.update',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
});

api.post('/teams/:teamId/members', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(inviteTeamMemberSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const membership = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_uid, team_id)
         DO NOTHING
         RETURNING user_uid, team_id, role`,
        [input.userUid, parsedTeamId, input.role]
      );

      if (!result.rowCount) {
        const error = new EqupoError(
          'User is already a member of this team. Use role-change endpoint to modify role.'
        );
        error.status = ERROR_STATUS.CONFLICT;
        throw error;
      }

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.members.add',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
      targetUserUid: input.userUid,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ membership });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.members.add',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
});

api.patch(
  '/teams/:teamId/members/:userUid/role',
  requireUser,
  userRateLimit,
  async (req, res, next) => {
    const actorUid = req.user?.uid ?? null;
    let teamId: string | null = null;
    let userUid: string | null = null;
    try {
      ({ teamId, userUid } = teamMemberParam.parse(req.params));
      const parsedTeamId = teamId;
      const parsedUserUid = userUid;
      const input = assertBody(updateTeamMemberRoleSchema, req.body);
      const authenticatedActorUid = getActorUid(req);

      const membership = await withTransaction(async client => {
        await assertTeamLeaderPermission(
          client,
          parsedTeamId,
          authenticatedActorUid
        );

        const result = await client.query(
          `UPDATE public.team_membership
         SET role = $3
         WHERE team_id = $1 AND user_uid = $2
         RETURNING user_uid, team_id, role`,
          [parsedTeamId, parsedUserUid, input.role]
        );

        if (!result.rowCount) {
          const error = new EqupoError('Team membership not found');
          error.status = ERROR_STATUS.NOT_FOUND;
          throw error;
        }

        return result.rows[0];
      });

      logEndpointAudit({
        operation: 'teams.members.role.update',
        outcome: 'success',
        actorUid: authenticatedActorUid,
        teamId: parsedTeamId,
        targetUserUid: parsedUserUid,
      });

      return res.json({ membership });
    } catch (error) {
      logEndpointAudit({
        operation: 'teams.members.role.update',
        outcome: 'error',
        actorUid,
        teamId,
        targetUserUid: userUid,
        error,
      });
      return next(error);
    }
  }
);

api.post('/teams/:teamId/rewards', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createTeamRewardSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const teamReward = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `INSERT INTO public.team_reward (team_id, reward_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW(), NOW())
         ON CONFLICT (team_id, reward_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING team_id, reward_id, date_obtained, updated_at`,
        [parsedTeamId, input.rewardId, input.dateObtained ?? null]
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.rewards.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ teamReward });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.create',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
});

api.post('/teams/:teamId/achievements', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createAchievementSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const achievement = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const result = await client.query(
        `INSERT INTO public.achievement (name, description, icon_url, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id, name, description, icon_url, created_at, updated_at`,
        [input.name, input.description ?? null, input.iconURL ?? null]
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.achievements.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(201).json({ achievement });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.achievements.create',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
});

api.post(
  '/teams/:teamId/achievements/unlocks',
  requireUser,
  userRateLimit,
  async (req, res, next) => {
    const actorUid = req.user?.uid ?? null;
    let teamId: string | null = null;
    try {
      ({ teamId } = teamIdParam.parse(req.params));
      const parsedTeamId = teamId;
      const input = assertBody(unlockAchievementSchema, req.body);
      const authenticatedActorUid = getActorUid(req);

      const userAchievement = await withTransaction(async client => {
        await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
        await assertUserBelongsToTeam(client, parsedTeamId, input.userUid);

        const achievementResult = await client.query(
          `SELECT id FROM public.achievement WHERE id = $1 LIMIT 1`,
          [input.achievementId]
        );

        if (!achievementResult.rowCount) {
          const error = new EqupoError('Achievement not found');
          error.status = ERROR_STATUS.NOT_FOUND;
          throw error;
        }

        const result = await client.query(
          `INSERT INTO public.user_achievement (user_uid, achievement_id, unlocked_at)
           VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
           ON CONFLICT (user_uid, achievement_id)
           DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at
           RETURNING user_uid, achievement_id, unlocked_at`,
          [input.userUid, input.achievementId, input.unlockedAt ?? null]
        );

        return result.rows[0];
      });

      logEndpointAudit({
        operation: 'teams.achievements.unlock',
        outcome: 'success',
        actorUid: authenticatedActorUid,
        teamId: parsedTeamId,
        targetUserUid: input.userUid,
      });

      return res.status(201).json({ userAchievement });
    } catch (error) {
      logEndpointAudit({
        operation: 'teams.achievements.unlock',
        outcome: 'error',
        actorUid,
        teamId,
        error,
      });
      return next(error);
    }
  }
);

api.post('/teams/:teamId/tasks', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createTaskSchema, req.body);
    const authenticatedActorUid = getActorUid(req);
    const normalizedCategories = normalizeCategories(input.categories);

    const task = await withTransaction(async client => {
      await assertUserBelongsToTeam(
        client,
        parsedTeamId,
        authenticatedActorUid
      );
      await assertTaskAssignmentsWithinTeam(
        client,
        parsedTeamId,
        input.assignedUserUid,
        input.assignedGroupId
      );

      const result = await client.query(
        `INSERT INTO public.task
           (team_id, due_date, priority, status, is_recurring, recurring_interval, assigned_user_uid, assigned_group_id, created_at, updated_at)
         VALUES ($1, $2::timestamptz, $3, $4, COALESCE($5, false), $6, $7, $8, NOW(), NOW())
         RETURNING id,
                   team_id AS "teamId",
                   due_date AS "dueDate",
                   priority,
                   status,
                   is_recurring AS "isRecurring",
                   recurring_interval AS "recurringInterval",
                   assigned_user_uid AS "assignedUserUid",
                   assigned_group_id AS "assignedGroupId",
                   updated_at AS "updatedAt"`,
        [
          parsedTeamId,
          input.dueDate,
          input.priority,
          input.status,
          input.isRecurring ?? false,
          input.recurringInterval ?? null,
          input.assignedUserUid ?? null,
          input.assignedGroupId ?? null,
        ]
      );

      const createdTask = result.rows[0];

      if (normalizedCategories.length) {
        for (const category of normalizedCategories) {
          await client.query(
            `INSERT INTO public.task_category (task_id, name)
             VALUES ($1, $2)`,
            [createdTask.id, category]
          );
        }
      }

      return {
        ...createdTask,
        categories: normalizedCategories,
      };
    });

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
});

api.patch(
  '/teams/:teamId/tasks/:taskId',
  requireUser,
  userRateLimit,
  async (req, res, next) => {
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

      const task = await withTransaction(async client => {
        await assertUserBelongsToTeam(
          client,
          parsedTeamId,
          authenticatedActorUid
        );

        const taskResult = await client.query(
          `SELECT id FROM public.task WHERE id = $1 AND team_id = $2 LIMIT 1`,
          [parsedTaskId, parsedTeamId]
        );

        if (!taskResult.rowCount) {
          const error = new EqupoError('Task not found');
          error.status = ERROR_STATUS.NOT_FOUND;
          throw error;
        }

        await assertTaskAssignmentsWithinTeam(
          client,
          parsedTeamId,
          input.assignedUserUid,
          input.assignedGroupId
        );

        const updates: string[] = [];
        const values: Array<string | boolean | null> = [];
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
        if (input.assignedUserUid !== undefined) {
          updates.push(`assigned_user_uid = $${index++}`);
          values.push(input.assignedUserUid);
        }
        if (input.assignedGroupId !== undefined) {
          updates.push(`assigned_group_id = $${index++}`);
          values.push(input.assignedGroupId);
        }

        updates.push('updated_at = NOW()');
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
                   assigned_user_uid AS "assignedUserUid",
                   assigned_group_id AS "assignedGroupId",
                   updated_at AS "updatedAt"`,
          values
        );

        if (normalizedCategories !== undefined) {
          await client.query(`DELETE FROM public.task_category WHERE task_id = $1`, [
            parsedTaskId,
          ]);

          for (const category of normalizedCategories) {
            await client.query(
              `INSERT INTO public.task_category (task_id, name)
               VALUES ($1, $2)`,
              [parsedTaskId, category]
            );
          }
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

      logEndpointAudit({
        operation: 'tasks.update',
        outcome: 'success',
        actorUid: authenticatedActorUid,
        teamId: parsedTeamId,
        taskId: parsedTaskId,
      });

      return res.json({ task });
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
  }
);

api.get('/teams/:teamId/tasks', requireUser, userRateLimit, async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);
    const { page, limit } = taskListPaginationQuery.parse(req.query);
    const offset = (page - 1) * limit;

    const { tasks, total } = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const totalResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM public.task WHERE team_id = $1`,
        [parsedTeamId]
      );
      const total = Number(totalResult.rows[0]?.total ?? 0);

      const result = await client.query(
        `WITH paged_tasks AS (
           SELECT t.id,
                  t.team_id,
                  t.due_date,
                  t.priority,
                  t.status,
                  t.is_recurring,
                  t.recurring_interval,
                  t.assigned_user_uid,
                  t.assigned_group_id,
                  t.updated_at
           FROM public.task t
           WHERE t.team_id = $1
           ORDER BY t.due_date ASC, t.id ASC
           LIMIT $2 OFFSET $3
         ),
         category_agg AS (
           SELECT tc.task_id,
                  array_agg(DISTINCT tc.name ORDER BY tc.name) AS categories
           FROM public.task_category tc
           JOIN paged_tasks pt ON pt.id = tc.task_id
           GROUP BY tc.task_id
         ),
         assigned_union AS (
           SELECT pt.id AS task_id, u.uid, u.display_name
           FROM paged_tasks pt
           JOIN public."user" u ON u.uid = pt.assigned_user_uid
           UNION
           SELECT pt.id AS task_id, u.uid, u.display_name
           FROM paged_tasks pt
           JOIN public.group_membership gm ON gm.group_id = pt.assigned_group_id
           JOIN public."user" u ON u.uid = gm.user_uid
         ),
         assigned_agg AS (
           SELECT au.task_id,
                  jsonb_agg(
                    jsonb_build_object('uid', au.uid, 'displayName', au.display_name)
                    ORDER BY au.uid
                  ) AS assigned_users
           FROM assigned_union au
           GROUP BY au.task_id
         )
         SELECT pt.id,
                pt.team_id AS "teamId",
                pt.due_date AS "dueDate",
                pt.priority,
                pt.status,
                COALESCE(pt.is_recurring, false) AS "isRecurring",
                pt.recurring_interval AS "recurringInterval",
                pt.assigned_group_id AS "assignedGroupId",
                pt.updated_at AS "updatedAt",
                COALESCE(ca.categories, '{}') AS categories,
                COALESCE(aa.assigned_users, '[]'::jsonb) AS "assignedUsers"
         FROM paged_tasks pt
         LEFT JOIN category_agg ca ON ca.task_id = pt.id
         LEFT JOIN assigned_agg aa ON aa.task_id = pt.id
         ORDER BY pt.due_date ASC, pt.id ASC`,
        [parsedTeamId, limit, offset]
      );

      return {
        tasks: result.rows,
        total,
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1 && totalPages > 0;

    logEndpointAudit({
      operation: 'tasks.list',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({
      tasks,
      meta: {
        page,
        limit,
        maxLimit: 200,
        total,
        totalPages,
        hasNext,
        hasPrev,
        nextPage: hasNext ? page + 1 : null,
        prevPage: hasPrev ? page - 1 : null,
      },
    });
  } catch (error) {
    logEndpointAudit({
      operation: 'tasks.list',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
});

api.delete(
  '/teams/:teamId/tasks/:taskId',
  requireUser,
  userRateLimit,
  async (req, res, next) => {
    const actorUid = req.user?.uid ?? null;
    let teamId: string | null = null;
    let taskId: string | null = null;
    try {
      ({ teamId, taskId } = teamTaskParam.parse(req.params));
      const parsedTeamId = teamId;
      const parsedTaskId = taskId;
      const authenticatedActorUid = getActorUid(req);

      const deletedTaskId = await withTransaction(async client => {
        await assertUserBelongsToTeam(
          client,
          parsedTeamId,
          authenticatedActorUid
        );

        const taskResult = await client.query(
          `SELECT id, assigned_user_uid, assigned_group_id
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

        const task = taskResult.rows[0];
        const hasAssignment = Boolean(
          task.assigned_user_uid || task.assigned_group_id
        );

        if (hasAssignment) {
          await assertTeamPermission(
            client,
            parsedTeamId,
            authenticatedActorUid
          );
        }

        await client.query(
          `DELETE FROM public.task_category WHERE task_id = $1`,
          [parsedTaskId]
        );
        await client.query(
          `DELETE FROM public.task WHERE id = $1 AND team_id = $2`,
          [parsedTaskId, parsedTeamId]
        );

        return parsedTaskId;
      });

      logEndpointAudit({
        operation: 'tasks.delete',
        outcome: 'success',
        actorUid: authenticatedActorUid,
        teamId: parsedTeamId,
        taskId: deletedTaskId,
      });

      return res.json({ deletedTaskId });
    } catch (error) {
      logEndpointAudit({
        operation: 'tasks.delete',
        outcome: 'error',
        actorUid,
        teamId,
        taskId,
        error,
      });
      return next(error);
    }
  }
);

api.get(
  '/teams/:teamId/tasks/my-valid-ids',
  requireUser,
  userRateLimit,
  async (req, res, next) => {
    const actorUid = req.user?.uid ?? null;
    let teamId: string | null = null;
    try {
      ({ teamId } = teamIdParam.parse(req.params));
      const parsedTeamId = teamId;
      const authenticatedActorUid = getActorUid(req);

      const taskIds = await withTransaction(async client => {
        await assertUserBelongsToTeam(
          client,
          parsedTeamId,
          authenticatedActorUid
        );

        const result = await client.query(
          `SELECT DISTINCT t.id
         FROM public.task t
         LEFT JOIN public.group_membership gm ON gm.group_id = t.assigned_group_id
         WHERE t.team_id = $1
           AND (t.assigned_user_uid = $2 OR gm.user_uid = $2)
           AND t.due_date >= NOW()
         ORDER BY t.id`,
          [parsedTeamId, authenticatedActorUid]
        );

        return result.rows.map(row => row.id as string);
      });

      logEndpointAudit({
        operation: 'tasks.myValidIds',
        outcome: 'success',
        actorUid: authenticatedActorUid,
        teamId: parsedTeamId,
      });

      return res.json({ taskIds });
    } catch (error) {
      logEndpointAudit({
        operation: 'tasks.myValidIds',
        outcome: 'error',
        actorUid,
        teamId,
        error,
      });
      return next(error);
    }
  }
);

api.post(
  '/internal/users/:userUid/rewards',
  requireSystem,
  async (req, res, next) => {
    let userUid: string | null = null;
    try {
      const input = assertBody(createSystemUserRewardSchema, req.body);
      userUid = String(req.params.userUid ?? '');

      const userReward = await withTransaction(async client => {
        const result = await client.query(
          `INSERT INTO public.user_reward (user_uid, reward_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW(), NOW())
         ON CONFLICT (user_uid, reward_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING user_uid, reward_id, date_obtained, updated_at`,
          [userUid, input.rewardId, input.dateObtained ?? null]
        );
        return result.rows[0];
      });

      logEndpointAudit({
        operation: 'internal.userRewards.create',
        outcome: 'success',
        actorUid: null,
        targetUserUid: userUid,
      });

      return res.status(201).json({ userReward });
    } catch (error) {
      logEndpointAudit({
        operation: 'internal.userRewards.create',
        outcome: 'error',
        actorUid: null,
        targetUserUid: userUid,
        error,
      });
      return next(error);
    }
  }
);

app.use(config.apiPrefix, api);

const errorHandler: ErrorRequestHandler = (
  error: EqupoError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = Number(error.status || 500);
  if (status >= 500) {
    winston.error('Server error:', error);
  }

  const payload: { error: string; details?: EqupoError['details'] } = {
    error: error.message || 'Internal server error',
  };
  if (error.details) {
    payload.details = error.details;
  }

  res.status(status).json(payload);
};

app.use(errorHandler);
