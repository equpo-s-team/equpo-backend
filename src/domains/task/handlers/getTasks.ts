import { pool, withTransaction } from '#a/db.js';
import { taskListPaginationQuery } from '#a/domains/task/schemas/index.js';
import { advanceDueDate } from '#a/domains/task/utils.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';
import winston from 'winston';

export const getTasks: RequestHandler = async (req, res, next) => {
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
                  t.team_id AS team_id,
                  t.due_date,
                  t.priority,
                  t.status,
                  t.is_recurring,
                  t.recurring_interval,
                  t.recurring_count,
                  t.assigned_user_uid,
                  t.assigned_group_id
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
           JOIN public.team_membership tm ON tm.user_uid = u.uid AND tm.team_id = $1
           WHERE tm.role != 'spectator'
           UNION
           SELECT pt.id AS task_id, u.uid, u.display_name
           FROM paged_tasks pt
           JOIN public.group_membership gm ON gm.group_id = pt.assigned_group_id
           JOIN public."user" u ON u.uid = gm.user_uid
           JOIN public.team_membership tm ON tm.user_uid = u.uid AND tm.team_id = $1
           WHERE tm.role != 'spectator'
         ),
         assigned_agg AS (
           SELECT au.task_id,
                  jsonb_agg(
                    jsonb_build_object('uid', au.uid, 'displayName', au.display_name)
                    ORDER BY au.uid
                  ) AS assigned_users
           FROM assigned_union au
           GROUP BY au.task_id
         ),
         step_counts AS (
           SELECT ts.task_id,
                  COUNT(*)::int AS steps_total,
                  SUM(CASE WHEN ts.is_done THEN 1 ELSE 0 END)::int AS steps_done
           FROM public.task_step ts
           JOIN paged_tasks pt ON pt.id = ts.task_id
           GROUP BY ts.task_id
         )
         SELECT pt.id,
                pt.team_id AS "teamId",
                pt.due_date AS "dueDate",
                pt.priority,
                pt.status,
                COALESCE(pt.is_recurring, false) AS "isRecurring",
                pt.recurring_interval AS "recurringInterval",
                pt.recurring_count AS "recurringCount",
                pt.assigned_group_id AS "assignedGroupId",
                COALESCE(ca.categories, '{}') AS categories,
                COALESCE(aa.assigned_users, '[]'::jsonb) AS "assignedUsers",
                COALESCE(sc.steps_total, 0) AS "stepsTotal",
                COALESCE(sc.steps_done, 0) AS "stepsDone"
         FROM paged_tasks pt
         LEFT JOIN category_agg ca ON ca.task_id = pt.id
         LEFT JOIN assigned_agg aa ON aa.task_id = pt.id
         LEFT JOIN step_counts sc ON sc.task_id = pt.id
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

    // Lazy Update for overdue recurring tasks
    const now = new Date();

    for (const pt of tasks) {
      if (pt.isRecurring && pt.dueDate && new Date(pt.dueDate) < now) {
        const newDate = advanceDueDate(
          pt.dueDate,
          pt.recurringInterval,
          pt.recurringCount || 1
        );

        // Update Postgres outside of the original transaction, this is fine for Lazy Updates.
        pool
          .query(
            `UPDATE public.task SET due_date = $1::timestamptz WHERE id = $2`,
            [newDate.toISOString(), pt.id]
          )
          .catch(error => {
            winston.error(
              `Failed to lazy update Postgres task ${pt.id}`,
              error
            );
          });

        // Update Firestore directly
        getFirestoreDb()
          .collection(parsedTeamId)
          .doc(pt.id)
          .set(
            {
              dueDate: newDate,
              updatedAt: newDate,
            },
            { merge: true }
          )
          .catch(error => {
            winston.error(
              `Failed to lazy update Firestore task ${pt.id}`,
              error
            );
          });

        // Update the response so the user gets the fresh data
        pt.dueDate = newDate.toISOString();
      }
    }

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
};
