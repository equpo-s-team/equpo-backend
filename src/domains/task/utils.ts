import type {
  CommentaryFirestoreDoc,
  StepFirestoreDoc,
} from '#a/domains/task/firestore/index.js';
import { assertGroupBelongsToTeam } from '#a/domains/task/guards/index.js';
import { assertUserBelongsToTeam } from '#a/domains/team/guards/index.js';

export function advanceDueDate(
  dueDateStr: string | Date,
  interval: string,
  count: number
): Date {
  const current = new Date(dueDateStr);
  const now = new Date();

  if (current >= now) return current;

  while (current < now) {
    switch (interval) {
      case 'days':
        current.setDate(current.getDate() + count);
        break;
      case 'weeks':
        current.setDate(current.getDate() + count * 7);
        break;
      case 'months':
        current.setMonth(current.getMonth() + count);
        break;
      case 'years':
        current.setFullYear(current.getFullYear() + count);
        break;
      default:
        // fallback to push 1 day if invalid
        current.setDate(current.getDate() + 1);
        break;
    }
  }
  return current;
}

export async function assertTaskAssignmentsWithinTeam(
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

export async function fetchAllStepsForTask(
  client: import('pg').PoolClient,
  taskId: string
): Promise<StepFirestoreDoc[]> {
  const result = await client.query(
    `SELECT step, is_done AS "isDone", position,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM public.task_step WHERE task_id = $1 ORDER BY position ASC`,
    [taskId]
  );
  return result.rows as StepFirestoreDoc[];
}

export async function fetchAllCommentariesForTask(
  client: import('pg').PoolClient,
  taskId: string
): Promise<CommentaryFirestoreDoc[]> {
  const result = await client.query(
    `SELECT tc.user_uid AS "userUid", tc.commentary,
            tc.created_at AS "createdAt", tc.updated_at AS "updatedAt"
     FROM public.task_commentary tc
     WHERE tc.task_id = $1
     ORDER BY tc.created_at DESC`,
    [taskId]
  );
  return result.rows as CommentaryFirestoreDoc[];
}

export function normalizeCategories(
  categories: string[] | undefined
): string[] {
  if (!categories?.length) return [];

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const category of categories) {
    const trimmed = category.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
}

export type ReportPriorityLabel = 'Alta' | 'Media' | 'Baja';

export function toReportPriorityLabel(priority: string): ReportPriorityLabel {
  if (priority === 'high') return 'Alta';
  if (priority === 'low') return 'Baja';
  return 'Media';
}

export function getReportDateRange(days: number) {
  const today = new Date();
  const rangeStart = new Date(today);
  rangeStart.setDate(today.getDate() - days);

  const rangeEnd = new Date(today);
  rangeEnd.setDate(today.getDate() + days);

  return {
    rangeStart,
    rangeEnd,
  };
}

export async function getReportsKpi(
  client: import('pg').PoolClient,
  teamId: string,
  rangeStart: Date,
  rangeEnd: Date
) {
  const result = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE t.status = 'todo')::int AS todo,
       COUNT(*) FILTER (WHERE t.status = 'in-progress')::int AS progress,
       COUNT(*) FILTER (WHERE t.status = 'in-qa')::int AS qa,
       COUNT(*) FILTER (WHERE t.status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE t.status <> 'done' AND t.due_date < NOW())::int AS overdue,
       COUNT(*)::int AS total
     FROM public.task t
     WHERE t.team_id = $1
       AND t.due_date >= $2::timestamptz
       AND t.due_date <= $3::timestamptz`,
    [teamId, rangeStart.toISOString(), rangeEnd.toISOString()]
  );

  return result.rows[0] as {
    todo: number;
    progress: number;
    qa: number;
    done: number;
    overdue: number;
    total: number;
  };
}

export async function getReportsMembers(
  client: import('pg').PoolClient,
  teamId: string,
  rangeStart: Date,
  rangeEnd: Date
) {
  const result = await client.query(
    `WITH member_base AS (
       SELECT tm.user_uid AS uid,
              tm.role,
              u.display_name AS display_name
       FROM public.team_membership tm
       LEFT JOIN public."user" u ON u.uid = tm.user_uid
       WHERE tm.team_id = $1
     ),
     ranged_tasks AS (
       SELECT t.id,
              t.status,
              t.assigned_user_uid,
              t.assigned_group_id
       FROM public.task t
       WHERE t.team_id = $1
         AND t.due_date >= $2::timestamptz
         AND t.due_date <= $3::timestamptz
     ),
     assigned_union AS (
       SELECT rt.id AS task_id,
              rt.status,
              rt.assigned_user_uid AS user_uid
       FROM ranged_tasks rt
       JOIN public.team_membership tm ON tm.user_uid = rt.assigned_user_uid AND tm.team_id = $1
       WHERE rt.assigned_user_uid IS NOT NULL AND tm.role != 'spectator'
       UNION
       SELECT rt.id AS task_id,
              rt.status,
              gm.user_uid
       FROM ranged_tasks rt
       JOIN public.group_membership gm ON gm.group_id = rt.assigned_group_id
       JOIN public.team_membership tm ON tm.user_uid = gm.user_uid AND tm.team_id = $1
       WHERE tm.role != 'spectator'
     ),
     dedup_assigned AS (
       SELECT DISTINCT task_id, status, user_uid
       FROM assigned_union
     )
     SELECT mb.uid,
            mb.display_name AS "displayName",
            mb.role,
            COUNT(da.task_id)::int AS total,
            COUNT(*) FILTER (WHERE da.status = 'done')::int AS completed
     FROM member_base mb
     LEFT JOIN dedup_assigned da ON da.user_uid = mb.uid
     GROUP BY mb.uid, mb.display_name, mb.role
     ORDER BY mb.display_name ASC NULLS LAST`,
    [teamId, rangeStart.toISOString(), rangeEnd.toISOString()]
  );

  return result.rows.map(row => {
    const total = Number(row.total ?? 0);
    const completed = Number(row.completed ?? 0);

    return {
      uid: row.uid as string,
      displayName: (row.displayName as string | null) ?? null,
      role: row.role as string,
      completed,
      total,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });
}

export async function getReportsOverdueTasks(
  client: import('pg').PoolClient,
  teamId: string,
  rangeStart: Date,
  rangeEnd: Date,
  overdueLimit: number
) {
  const result = await client.query(
    `WITH overdue_tasks AS (
       SELECT t.id,
              t.status,
              t.priority,
              t.due_date,
              t.assigned_user_uid,
              t.assigned_group_id
       FROM public.task t
       WHERE t.team_id = $1
         AND t.due_date >= $2::timestamptz
         AND t.due_date <= $3::timestamptz
         AND t.status <> 'done'
         AND t.due_date < NOW()
       ORDER BY t.due_date ASC, t.id ASC
       LIMIT $4
     ),
     category_agg AS (
       SELECT tc.task_id,
              array_agg(DISTINCT tc.name ORDER BY tc.name) AS categories
       FROM public.task_category tc
       JOIN overdue_tasks ot ON ot.id = tc.task_id
       GROUP BY tc.task_id
     ),
     assigned_union AS (
       SELECT ot.id AS task_id, u.uid, u.display_name
       FROM overdue_tasks ot
       JOIN public."user" u ON u.uid = ot.assigned_user_uid
       JOIN public.team_membership tm ON tm.user_uid = u.uid AND tm.team_id = $1
       WHERE tm.role != 'spectator'
       UNION
       SELECT ot.id AS task_id, u.uid, u.display_name
       FROM overdue_tasks ot
       JOIN public.group_membership gm ON gm.group_id = ot.assigned_group_id
       JOIN public."user" u ON u.uid = gm.user_uid
       JOIN public.team_membership tm ON tm.user_uid = u.uid AND tm.team_id = $1
       WHERE tm.role != 'spectator'
     ),
     assigned_agg AS (
       SELECT au.task_id,
              jsonb_agg(
                jsonb_build_object('uid', au.uid, 'displayName', au.display_name)
                ORDER BY au.uid
              ) AS assigned_users,
              string_agg(DISTINCT au.display_name, ', ' ORDER BY au.display_name) AS assignee
       FROM assigned_union au
       GROUP BY au.task_id
     )
     SELECT ot.id AS "taskId",
            ot.status,
            ot.priority,
            ot.due_date AS "dueDate",
            GREATEST(
              1,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - ot.due_date)) / 86400)
            )::int AS "daysOverdue",
            COALESCE(ca.categories, '{}') AS categories,
            COALESCE(aa.assigned_users, '[]'::jsonb) AS "assignedUsers",
            COALESCE(aa.assignee, 'Sin asignar') AS assignee
     FROM overdue_tasks ot
     LEFT JOIN category_agg ca ON ca.task_id = ot.id
     LEFT JOIN assigned_agg aa ON aa.task_id = ot.id
     ORDER BY ot.due_date ASC, ot.id ASC`,
    [teamId, rangeStart.toISOString(), rangeEnd.toISOString(), overdueLimit]
  );

  return result.rows.map(row => ({
    taskId: row.taskId as string,
    status: row.status as string,
    priority: row.priority as string,
    priorityLabel: toReportPriorityLabel(row.priority as string),
    dueDate: row.dueDate as string,
    daysOverdue: Number(row.daysOverdue ?? 0),
    categories: row.categories as string[],
    assignedUsers: row.assignedUsers as Array<{
      uid: string;
      displayName: string | null;
    }>,
    assignee: row.assignee as string,
  }));
}
