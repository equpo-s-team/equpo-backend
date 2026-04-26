import cors from 'cors';
import {randomUUID} from 'node:crypto';
import {URL} from 'node:url';
import express, {
    Application,
    ErrorRequestHandler,
    NextFunction,
    Request,
    Response,
    Router,
} from 'express';
import {requireUser} from '#a/auth.js';
import {requireSystem} from '#a/systemAuth.js';
import {pool, withTransaction} from '#a/db.js';
import {config} from '#a/config.js';
import {assertBody, createUserRateLimitMiddleware} from '#a/utils/index.js';
import {
    assertTeamLeaderPermission,
    assertTeamMembership,
    assertTeamPermission,
    assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import {assertGroupBelongsToTeam} from '#a/domains/task/guards/index.js';
import {
    createAchievementSchema,
    unlockAchievementSchema,
    checkAchievementsOnTaskComplete,
} from '#a/domains/achievement/schemas/index.js';
import {
    XP_REWARDS,
    COIN_REWARDS,
    calculateLevel,
} from '#a/domains/user/xpUtils.js';
import {createSystemUserRewardSchema} from '#a/domains/reward/schemas/index.js';
import {
    createTaskSchema,
    reportOverviewQuery,
    taskListPaginationQuery,
    teamTaskParam,
    updateTaskSchema,
} from '#a/domains/task/schemas/index.js';
import {
    deleteTaskFromFirestore,
    upsertTaskInFirestore,
} from '#a/domains/task/firestore/index.js';
import {advanceDueDate} from '#a/domains/task/utils.js';
import {
    upsertTeamMembershipInFirestore,
    deleteTeamMembershipFromFirestore,
} from '#a/domains/team/firestore/teamMembershipFirestore.js';
import {
    deleteTeamFromFirestore,
    deleteTeamStorageFiles,
} from '#a/domains/team/firestore/teamDeleteFirestore.js';
import {
    createTeamRewardSchema,
    createTeamSchema,
    inviteTeamMemberSchema,
    mirrorMyAvatarSchema,
    teamIdParam,
    teamMemberParam,
    updateTeamMemberRoleSchema,
    updateTeamSchema,
} from '#a/domains/team/schemas/index.js';
import {
    zegoTokenParam,
    createGroupSchema,
    addGroupMembersSchema,
} from '#a/domains/room/schemas/index.js';
import {generateZegoToken} from '#a/domains/room/zegoToken.js';
import {
    createChatRoomInFirestore,
    addChatRoomMemberInFirestore,
    removeChatRoomMemberFromFirestore,
    insertSystemMessage,
} from '#a/domains/room/firestore/index.js';
import winston from 'winston';
import {ERROR_STATUS, SUCCESS_STATUS} from '#a/constants/httpStatusCodes.js';
import {EqupoError} from '#a/types/EqupoError.js';
import {getFirestoreDb, getStorageBucket} from '#a/firebaseAdmin.js';

const ALLOWED_EXTERNAL_AVATAR_HOSTS = new Set([
    'lh3.googleusercontent.com',
    'lh4.googleusercontent.com',
    'lh5.googleusercontent.com',
    'lh6.googleusercontent.com',
]);

const MAX_USER_AVATAR_BYTES = 5 * 1024 * 1024;

function assertAllowedExternalAvatarUrl(sourceUrl: string): URL {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(sourceUrl);
    } catch {
        throw new EqupoError('Invalid avatar source URL', ERROR_STATUS.VALIDATION);
    }

    if (parsedUrl.protocol !== 'https:') {
        throw new EqupoError(
            'Only HTTPS avatar URLs are allowed',
            ERROR_STATUS.VALIDATION
        );
    }

    if (!ALLOWED_EXTERNAL_AVATAR_HOSTS.has(parsedUrl.hostname)) {
        throw new EqupoError('Avatar host is not allowed', ERROR_STATUS.VALIDATION);
    }

    return parsedUrl;
}

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

type ReportPriorityLabel = 'Alta' | 'Media' | 'Baja';

function toReportPriorityLabel(priority: string): ReportPriorityLabel {
    if (priority === 'high') return 'Alta';
    if (priority === 'low') return 'Baja';
    return 'Media';
}

function getReportDateRange(days: number) {
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

async function getReportsKpi(
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

async function getReportsMembers(
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
       WHERE rt.assigned_user_uid IS NOT NULL
       UNION
       SELECT rt.id AS task_id,
              rt.status,
              gm.user_uid
       FROM ranged_tasks rt
       JOIN public.group_membership gm ON gm.group_id = rt.assigned_group_id
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

async function getReportsOverdueTasks(
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
       UNION
       SELECT ot.id AS task_id, u.uid, u.display_name
       FROM overdue_tasks ot
       JOIN public.group_membership gm ON gm.group_id = ot.assigned_group_id
       JOIN public."user" u ON u.uid = gm.user_uid
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
    res.json({ok: true});
});

const api: Router = express.Router();
const userRateLimit = createUserRateLimitMiddleware(config.rateLimit);

api.get('/health', (_req, res) => {
    res.json({ok: true, prefix: config.apiPrefix});
});

api.get('/teams/me', requireUser, async (req, res, next) => {
    try {
        const actorUid = getActorUid(req);

        const result = await pool.query(
            `SELECT
         t.id,
         t.name,
         t.leader_uid       AS "leaderUid",
         t.virtual_currency AS "virtualCurrency",
         t.description,
         t.photo_u_r_l      AS "photoUrl",
         t.created_at       AS "createdAt",
         t.updated_at       AS "updatedAt",
         COALESCE(
           json_agg(
             json_build_object(
               'userUid',     tm.user_uid,
               'role',        tm.role,
               'joinedAt',    tm.joined_at,
               'displayName', u.display_name
             )
           ) FILTER (WHERE tm.user_uid IS NOT NULL),
           '[]'
         ) AS members
       FROM public.team t
       INNER JOIN public.team_membership me
         ON me.team_id = t.id AND me.user_uid = $1
       LEFT JOIN public.team_membership tm
         ON tm.team_id = t.id
       LEFT JOIN public."user" u
         ON u.uid = tm.user_uid
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
            [actorUid]
        );

        return res.json({teams: result.rows});
    } catch (error) {
        return next(error);
    }
});

api.post(
    '/users/me/avatar/mirror',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;

        try {
            const authenticatedActorUid = getActorUid(req);
            const {sourceUrl} = assertBody(mirrorMyAvatarSchema, req.body);
            const parsedAvatarUrl = assertAllowedExternalAvatarUrl(sourceUrl);

            const sourceResponse = await globalThis.fetch(
                parsedAvatarUrl.toString(),
                {
                    redirect: 'follow',
                }
            );

            if (!sourceResponse.ok) {
                throw new EqupoError(
                    `Failed to fetch avatar source (${sourceResponse.status})`,
                    ERROR_STATUS.SERVER_ERROR
                );
            }

            const contentType = sourceResponse.headers.get('content-type') ?? '';
            if (!contentType.startsWith('image/')) {
                throw new EqupoError(
                    'Avatar source must be an image',
                    ERROR_STATUS.VALIDATION
                );
            }

            const avatarArrayBuffer = await sourceResponse.arrayBuffer();
            const avatarBuffer = Buffer.from(avatarArrayBuffer);

            if (!avatarBuffer.length) {
                throw new EqupoError('Avatar source is empty', ERROR_STATUS.VALIDATION);
            }

            if (avatarBuffer.length > MAX_USER_AVATAR_BYTES) {
                throw new EqupoError(
                    'Avatar source exceeds 5MB limit',
                    ERROR_STATUS.VALIDATION
                );
            }

            const bucket = getStorageBucket();
            const objectPath = `users/${authenticatedActorUid}/profile`;
            const downloadToken = randomUUID();

            await bucket.file(objectPath).save(avatarBuffer, {
                resumable: false,
                contentType,
                metadata: {
                    cacheControl: 'public,max-age=3600',
                    metadata: {
                        firebaseStorageDownloadTokens: downloadToken,
                    },
                },
            });

            const photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

            await withTransaction(async client => {
                const updateResult = await client.query(
                    `UPDATE public."user"
         SET photo_u_r_l = $1,
             updated_at = NOW()
         WHERE uid = $2`,
                    [photoURL, authenticatedActorUid]
                );

                if (updateResult.rowCount === 0) {
                    throw new EqupoError(
                        'User profile not found',
                        ERROR_STATUS.NOT_FOUND
                    );
                }
            });

            return res.json({photoURL});
        } catch (error) {
            logEndpointAudit({
                operation: 'users.avatar.mirror',
                outcome: 'error',
                actorUid,
                error,
            });
            return next(error);
        }
    }
);

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

        await upsertTeamMembershipInFirestore(
            team.id as string,
            authenticatedActorUid,
            'leader'
        );

        // Auto-create "General" group + chatRoom
        const generalGroup = await withTransaction(async client => {
            const groupResult = await client.query(
                `INSERT INTO public."group" (team_id, group_name) VALUES ($1, 'General') RETURNING id`,
                [team.id]
            );
            const groupId = groupResult.rows[0].id as string;

            await client.query(
                `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [groupId, authenticatedActorUid]
            );

            return {id: groupId};
        });

        await createChatRoomInFirestore(
            team.id as string,
            generalGroup.id,
            'General',
            authenticatedActorUid
        );
        await addChatRoomMemberInFirestore(
            team.id as string,
            generalGroup.id,
            authenticatedActorUid,
            'leader'
        );
        await insertSystemMessage(
            team.id as string,
            generalGroup.id,
            '🎉 Grupo "General" creado'
        );

        logEndpointAudit({
            operation: 'teams.create',
            outcome: 'success',
            actorUid: authenticatedActorUid,
            teamId: team.id as string,
        });

        res.status(201).json({team});
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

api.patch(
    '/teams/:teamId',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const input = assertBody(updateTeamSchema, req.body);
            const authenticatedActorUid = getActorUid(req);

            if (!Object.keys(input).length) {
                return res
                    .status(ERROR_STATUS.VALIDATION)
                    .json({error: 'No fields to update'});
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
                if (input.photoUrl !== undefined) {
                    updates.push(`photo_u_r_l = $${index++}`);
                    values.push(input.photoUrl);
                }

                updates.push('updated_at = NOW()');
                values.push(parsedTeamId);

                const result = await client.query(
                    `UPDATE public.team SET ${updates.join(', ')} WHERE id = $${index} RETURNING id, name, leader_uid, virtual_currency, description, photo_u_r_l AS "photoUrl", updated_at`,
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

            return res.json({team});
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
    }
);

api.post(
    '/teams/:teamId/members',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
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

            await upsertTeamMembershipInFirestore(
                membership.team_id,
                membership.user_uid,
                membership.role
            );

            // Auto-add new member to "General" group
            const generalGroupResult = await pool.query(
                `SELECT id FROM public."group" WHERE team_id = $1 AND group_name = 'General' LIMIT 1`,
                [parsedTeamId]
            );
            if (generalGroupResult.rowCount) {
                const generalGroupId = generalGroupResult.rows[0].id as string;
                await pool.query(
                    `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [generalGroupId, input.userUid]
                );
                await addChatRoomMemberInFirestore(
                    parsedTeamId,
                    generalGroupId,
                    input.userUid,
                    input.role
                );

                // Fetch display name for system message
                const userResult = await pool.query(
                    `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
                    [input.userUid]
                );
                const displayName =
                    (userResult.rows[0]?.display_name as string | null) ?? input.userUid;
                await insertSystemMessage(
                    parsedTeamId,
                    generalGroupId,
                    `👋 ${displayName} se unió al equipo`
                );
            }

            logEndpointAudit({
                operation: 'teams.members.add',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
                targetUserUid: input.userUid,
            });

            return res.status(SUCCESS_STATUS.CREATED).json({membership});
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
    }
);

api.patch(
    '/teams/:teamId/members/:userUid/role',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        let userUid: string | null = null;
        try {
            ({teamId, userUid} = teamMemberParam.parse(req.params));
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

            await upsertTeamMembershipInFirestore(
                membership.team_id,
                membership.user_uid,
                membership.role
            );

            logEndpointAudit({
                operation: 'teams.members.role.update',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
                targetUserUid: parsedUserUid,
            });

            return res.json({membership});
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

// ── DELETE /teams/:teamId/members/:userUid ── Kick a team member ─────────────
api.delete(
    '/teams/:teamId/members/:userUid',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        let userUid: string | null = null;
        try {
            ({teamId, userUid} = teamMemberParam.parse(req.params));
            const parsedTeamId = teamId;
            const parsedUserUid = userUid;
            const authenticatedActorUid = getActorUid(req);

            // Prevent removing yourself as leader
            if (parsedUserUid === authenticatedActorUid) {
                throw new EqupoError(
                    'You cannot remove yourself from the team',
                    ERROR_STATUS.VALIDATION
                );
            }

            const kickResult = await withTransaction(async client => {
                const {isLeader, role: actorRole} = await assertTeamPermission(
                    client,
                    parsedTeamId,
                    authenticatedActorUid
                );

                // Look up the target member's role
                const targetResult = await client.query(
                    `SELECT tm.role
           FROM public.team_membership tm
           WHERE tm.team_id = $1 AND tm.user_uid = $2
           LIMIT 1`,
                    [parsedTeamId, parsedUserUid]
                );

                if (!targetResult.rowCount) {
                    throw new EqupoError(
                        'Member not found in this team',
                        ERROR_STATUS.NOT_FOUND
                    );
                }

                const targetRole = targetResult.rows[0].role as string;

                // Prevent kicking the leader
                if (targetRole === 'leader') {
                    throw new EqupoError(
                        'The team leader cannot be removed',
                        ERROR_STATUS.FORBIDDEN
                    );
                }

                // Collaborators can only kick members/spectators, not other collaborators
                if (
                    !isLeader &&
                    actorRole === 'collaborator' &&
                    targetRole === 'collaborator'
                ) {
                    throw new EqupoError(
                        'Collaborators cannot remove other collaborators',
                        ERROR_STATUS.FORBIDDEN
                    );
                }

                // Fetch display name for system messages
                const userResult = await client.query(
                    `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
                    [parsedUserUid]
                );
                const displayName =
                    (userResult.rows[0]?.display_name as string | null) ?? parsedUserUid;

                // Fetch all groups this member belongs to in the team
                const groupsResult = await client.query(
                    `SELECT gm.group_id
           FROM public.group_membership gm
           JOIN public."group" g ON g.id = gm.group_id
           WHERE g.team_id = $1 AND gm.user_uid = $2`,
                    [parsedTeamId, parsedUserUid]
                );
                const groupIds = groupsResult.rows.map(r => r.group_id as string);

                // Remove from all group memberships
                if (groupIds.length > 0) {
                    await client.query(
                        `DELETE FROM public.group_membership
             WHERE user_uid = $1 AND group_id = ANY($2::uuid[])`,
                        [parsedUserUid, groupIds]
                    );
                }

                // Remove from team_membership
                await client.query(
                    `DELETE FROM public.team_membership WHERE team_id = $1 AND user_uid = $2`,
                    [parsedTeamId, parsedUserUid]
                );

                return {groupIds, displayName};
            });

            // Firestore cleanup after successful DB transaction
            await deleteTeamMembershipFromFirestore(parsedTeamId, parsedUserUid);
            for (const groupId of kickResult.groupIds) {
                await removeChatRoomMemberFromFirestore(
                    parsedTeamId,
                    groupId,
                    parsedUserUid
                );
                await insertSystemMessage(
                    parsedTeamId,
                    groupId,
                    `👋 ${kickResult.displayName} fue removido del equipo`
                );
            }

            logEndpointAudit({
                operation: 'teams.members.remove',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
                targetUserUid: parsedUserUid,
            });

            return res.status(SUCCESS_STATUS.NO_CONTENT).end();
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.members.remove',
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

// ── DELETE /teams/:teamId ── Delete the entire team ──────────────────────────
api.delete(
    '/teams/:teamId',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);

            await withTransaction(async client => {
                // Only the leader can delete the team
                await assertTeamLeaderPermission(
                    client,
                    parsedTeamId,
                    authenticatedActorUid
                );

                // Cascade: task_category → task → group_membership → group → team_membership → team
                await client.query(
                    `DELETE FROM public.task_category
           WHERE task_id IN (SELECT id FROM public.task WHERE team_id = $1)`,
                    [parsedTeamId]
                );
                await client.query(`DELETE FROM public.task WHERE team_id = $1`, [
                    parsedTeamId,
                ]);
                await client.query(
                    `DELETE FROM public.group_membership
           WHERE group_id IN (SELECT id FROM public."group" WHERE team_id = $1)`,
                    [parsedTeamId]
                );
                await client.query(`DELETE FROM public."group" WHERE team_id = $1`, [
                    parsedTeamId,
                ]);
                await client.query(
                    `DELETE FROM public.team_membership WHERE team_id = $1`,
                    [parsedTeamId]
                );
                await client.query(`DELETE FROM public.team WHERE id = $1`, [
                    parsedTeamId,
                ]);
            });

            // After DB cleanup — Firestore + Storage (best-effort, non-blocking on partial failure)
            await Promise.allSettled([
                deleteTeamFromFirestore(parsedTeamId),
                deleteTeamStorageFiles(parsedTeamId),
            ]);

            logEndpointAudit({
                operation: 'teams.delete',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.status(SUCCESS_STATUS.NO_CONTENT).end();
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.delete',
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
    '/teams/:teamId/rewards',

    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
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

            return res.status(SUCCESS_STATUS.CREATED).json({teamReward});
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
    }
);

api.post(
    '/teams/:teamId/achievements',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
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

            return res.status(201).json({achievement});
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
    }
);

api.post(
    '/teams/:teamId/achievements/unlocks',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
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

            return res.status(201).json({userAchievement});
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

api.get(
    '/teams/:teamId/achievements',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);

            const achievements = await withTransaction(async client => {
                await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

                const result = await client.query(
                    `SELECT a.id,
                  a.name,
                  a.description,
                  a.icon_u_r_l AS "iconUrl",
                  ua.unlocked_at AS "unlockedAt"
           FROM public.achievement a
           LEFT JOIN public.user_achievement ua
             ON ua.achievement_id = a.id AND ua.user_uid = $1
           ORDER BY ua.unlocked_at DESC NULLS LAST, a.name ASC`,
                    [authenticatedActorUid]
                );

                return result.rows.map(row => ({
                    id: row.id as string,
                    name: row.name as string,
                    description: row.description as string | null,
                    iconUrl: (row.iconUrl as string | null) ?? null,
                    unlockedAt: row.unlockedAt
                        ? (row.unlockedAt as Date).toISOString()
                        : null,
                }));
            });

            logEndpointAudit({
                operation: 'teams.achievements.list',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.json({achievements});
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.achievements.list',
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
    '/teams/:teamId/tasks',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
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
                        input.status,
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

                return {
                    ...createdTask,
                    categories: normalizedCategories,
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

            logEndpointAudit({
                operation: 'tasks.create',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
                taskId: task.id as string,
            });

            return res.status(SUCCESS_STATUS.CREATED).json({task});
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
    }
);

api.patch(
    '/teams/:teamId/tasks/:taskId',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        let taskId: string | null = null;
        try {
            ({teamId, taskId} = teamTaskParam.parse(req.params));
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
                    .json({error: 'No fields to update'});
            }

            // Track whether this update transitions the task to 'done'
            let previousStatus: string | null = null;

            const task = await withTransaction(async client => {
                await assertUserBelongsToTeam(
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
                previousStatus = existingTask.status as string;
                const isOverdue =
                    existingTask.status !== 'done' &&
                    new Date(existingTask.due_date) < new Date();

                if (isOverdue) {
                    await assertTeamPermission(
                        client,
                        parsedTeamId,
                        authenticatedActorUid
                    );
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
                const priority = (task.priority as string) ?? 'medium';
                const xpAmount =
                    XP_REWARDS[priority as keyof typeof XP_REWARDS] ?? XP_REWARDS.medium;
                const userCoinAmount =
                    (COIN_REWARDS[priority as keyof typeof COIN_REWARDS] ??
                    COIN_REWARDS.medium)/2;

                const teamCoinAmount =
                    COIN_REWARDS[priority as keyof typeof COIN_REWARDS] ??
                    COIN_REWARDS.medium;

                const xpResult = await withTransaction(async client => {
                    const userResult = await client.query(
                        `UPDATE public."user"
             SET experience_points = COALESCE(experience_points, 0) + $1,
                 virtual_currency = COALESCE(virtual_currency, 0) + $3,
                 updated_at = NOW()
             WHERE uid = $2
             RETURNING experience_points, level, virtual_currency`,
                        [xpAmount, authenticatedActorUid, userCoinAmount]
                    );

                    const newTotalXp = Number(userResult.rows[0]?.experience_points ?? 0);
                    const newLevel = calculateLevel(newTotalXp);
                    const oldLevel = Number(userResult.rows[0]?.level ?? 0);
                    const leveledUp = newLevel > oldLevel;

                    // Update level if changed
                    if (leveledUp) {
                        await client.query(
                            `UPDATE public."user"
               SET level = $1, updated_at = NOW()
               WHERE uid = $2`,
                            [newLevel, authenticatedActorUid]
                        );
                    }

                    // Grant coins to the team
                    await client.query(
                        `UPDATE public.team
             SET virtual_currency = COALESCE(virtual_currency, 0) + $1,
                 updated_at = NOW()
             WHERE id = $2`,
                        [teamCoinAmount, parsedTeamId]
                    );

                    // Check achievements
                    const achievements = await checkAchievementsOnTaskComplete({
                        client,
                        userUid: authenticatedActorUid,
                        teamId: parsedTeamId,
                        taskId: parsedTaskId,
                        newLevel,
                        assignedUserUid: (task.assignedUserUid as string | null) ?? null,
                        assignedGroupId: (task.assignedGroupId as string | null) ?? null,
                    });

                    return {
                        xpGained: xpAmount,
                        coinsGained: teamCoinAmount,
                        newXp: newTotalXp,
                        newLevel,
                        leveledUp,
                        achievements,
                    };
                });

                xpReward = {
                    xpGained: xpResult.xpGained,
                    coinsGained: xpResult.coinsGained,
                    newXp: xpResult.newXp,
                    newLevel: xpResult.newLevel,
                    leveledUp: xpResult.leveledUp,
                };
                unlockedAchievements = xpResult.achievements;
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

            const response: Record<string, unknown> = {task};
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
    }
);

api.get(
    '/teams/:teamId/members',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);

            const members = await withTransaction(async client => {
                await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

                const result = await client.query(
                    `SELECT tm.user_uid AS "uid",
                  u.display_name AS "displayName",
                  u.photo_u_r_l  AS "photoUrl",
                  tm.role
           FROM public.team_membership tm
           JOIN public."user" u ON u.uid = tm.user_uid
           WHERE tm.team_id = $1
           ORDER BY u.display_name ASC`,
                    [parsedTeamId]
                );

                return result.rows;
            });

            logEndpointAudit({
                operation: 'teams.members.list',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.json({members});
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.members.list',
                outcome: 'error',
                actorUid,
                teamId,
                error,
            });
            return next(error);
        }
    }
);

api.get(
    '/teams/:teamId/groups',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);

            const groups = await withTransaction(async client => {
                await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

                const result = await client.query(
                    `SELECT g.id,
                  g.group_name   AS "groupName",
                  g.photo_u_r_l  AS "photoUrl",
                  (SELECT COUNT(*)::int FROM public.group_membership gm2 WHERE gm2.group_id = g.id) AS "memberCount"
           FROM public."group" g
           WHERE g.team_id = $1
             AND (
               EXISTS (SELECT 1 FROM public.group_membership gm WHERE gm.group_id = g.id AND gm.user_uid = $2)
               OR EXISTS (SELECT 1 FROM public.team t WHERE t.id = $1 AND t.leader_uid = $2)
             )
           ORDER BY g.group_name ASC`,
                    [parsedTeamId, authenticatedActorUid]
                );

                return result.rows;
            });

            logEndpointAudit({
                operation: 'teams.groups.list',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.json({groups});
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.groups.list',
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
    '/teams/:teamId/groups',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const input = assertBody(createGroupSchema, req.body);
            const authenticatedActorUid = getActorUid(req);

            const group = await withTransaction(async client => {
                await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

                const memberUids = input.memberUids ?? [];
                for (const uid of memberUids) {
                    await assertUserBelongsToTeam(client, parsedTeamId, uid);
                }

                const groupResult = await client.query(
                    `INSERT INTO public."group" (team_id, group_name) VALUES ($1, $2) RETURNING id, group_name AS "groupName"`,
                    [parsedTeamId, input.name]
                );
                const createdGroup = groupResult.rows[0];

                await client.query(
                    `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [createdGroup.id, authenticatedActorUid]
                );

                for (const uid of memberUids) {
                    if (uid !== authenticatedActorUid) {
                        await client.query(
                            `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                            [createdGroup.id, uid]
                        );
                    }
                }

                return createdGroup;
            });

            await createChatRoomInFirestore(
                parsedTeamId,
                group.id as string,
                input.name,
                authenticatedActorUid
            );
            await addChatRoomMemberInFirestore(
                parsedTeamId,
                group.id as string,
                authenticatedActorUid,
                'creator'
            );

            const memberUids = input.memberUids ?? [];
            for (const uid of memberUids) {
                if (uid !== authenticatedActorUid) {
                    await addChatRoomMemberInFirestore(
                        parsedTeamId,
                        group.id as string,
                        uid,
                        'member'
                    );
                }
            }

            const creatorResult = await pool.query(
                `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
                [authenticatedActorUid]
            );
            const creatorName =
                (creatorResult.rows[0]?.display_name as string | null) ??
                authenticatedActorUid;
            await insertSystemMessage(
                parsedTeamId,
                group.id as string,
                `🎉 Grupo "${input.name}" creado por ${creatorName}`
            );

            logEndpointAudit({
                operation: 'teams.groups.create',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.status(SUCCESS_STATUS.CREATED).json({group});
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.groups.create',
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
    '/teams/:teamId/groups/:groupId/members',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const groupId = String(req.params.groupId ?? '');
            const parsedTeamId = teamId;
            const input = assertBody(addGroupMembersSchema, req.body);
            const authenticatedActorUid = getActorUid(req);

            await withTransaction(async client => {
                await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);
                await assertGroupBelongsToTeam(client, parsedTeamId, groupId);

                const countResult = await client.query(
                    `SELECT COUNT(*)::int AS cnt FROM public.group_membership WHERE group_id = $1`,
                    [groupId]
                );
                const currentCount = Number(countResult.rows[0]?.cnt ?? 0);
                if (currentCount + input.memberUids.length > 40) {
                    throw new EqupoError(
                        'Group cannot exceed 40 members',
                        ERROR_STATUS.VALIDATION
                    );
                }

                for (const uid of input.memberUids) {
                    await assertUserBelongsToTeam(client, parsedTeamId, uid);
                    await client.query(
                        `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [groupId, uid]
                    );
                }
            });

            for (const uid of input.memberUids) {
                await addChatRoomMemberInFirestore(
                    parsedTeamId,
                    groupId,
                    uid,
                    'member'
                );

                const userResult = await pool.query(
                    `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
                    [uid]
                );
                const displayName =
                    (userResult.rows[0]?.display_name as string | null) ?? uid;
                await insertSystemMessage(
                    parsedTeamId,
                    groupId,
                    `👤 ${displayName} fue agregado al grupo`
                );
            }

            logEndpointAudit({
                operation: 'teams.groups.members.add',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res
                .status(SUCCESS_STATUS.CREATED)
                .json({added: input.memberUids.length});
        } catch (error) {
            logEndpointAudit({
                operation: 'teams.groups.members.add',
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
    '/teams/:teamId/rooms/:roomId/zego-token',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            const params = zegoTokenParam.parse(req.params);
            teamId = params.teamId;
            const parsedTeamId = params.teamId;
            const roomId = params.roomId;
            const authenticatedActorUid = getActorUid(req);

            await withTransaction(async client => {
                const groupCheck = await client.query(
                    `SELECT 1 FROM public."group" g
           WHERE g.id = $1 AND g.team_id = $2
           AND (
             EXISTS (SELECT 1 FROM public.group_membership gm WHERE gm.group_id = $1 AND gm.user_uid = $3)
             OR EXISTS (SELECT 1 FROM public.team t WHERE t.id = $2 AND t.leader_uid = $3)
           )
           LIMIT 1`,
                    [roomId, parsedTeamId, authenticatedActorUid]
                );

                if (!groupCheck.rowCount) {
                    throw new EqupoError(
                        'Forbidden: not a member of this group',
                        ERROR_STATUS.FORBIDDEN
                    );
                }
            });

            const payloadString = JSON.stringify({
                room_id: roomId,
                privilege: {'1': 1, '2': 1},
                stream_id_list: null,
            });

            const token = generateZegoToken(
                config.zegoAppId,
                authenticatedActorUid,
                config.zegoServerSecret,
                config.zegoTokenTtlSeconds,
                payloadString
            );

            const expiresAt = new Date(
                Date.now() + config.zegoTokenTtlSeconds * 1000
            ).toISOString();

            const userResult = await pool.query(
                `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
                [authenticatedActorUid]
            );
            const displayName =
                (userResult.rows[0]?.display_name as string | null) ??
                authenticatedActorUid;
            await insertSystemMessage(
                parsedTeamId,
                roomId,
                `📹 ${displayName} inició una videollamada`
            );

            logEndpointAudit({
                operation: 'rooms.zegoToken',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.status(SUCCESS_STATUS.OK).json({
                token,
                appId: config.zegoAppId,
                userId: authenticatedActorUid,
                roomId,
                expiresAt,
            });
        } catch (error) {
            logEndpointAudit({
                operation: 'rooms.zegoToken',
                outcome: 'error',
                actorUid,
                teamId,
                error,
            });
            return next(error);
        }
    }
);

api.get(
    '/teams/:teamId/tasks',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);
            const {page, limit} = taskListPaginationQuery.parse(req.query);
            const offset = (page - 1) * limit;

            const {tasks, total} = await withTransaction(async client => {
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
                pt.recurring_count AS "recurringCount",
                pt.assigned_group_id AS "assignedGroupId",
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
                            {merge: true}
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
    }
);

api.get(
    '/teams/:teamId/reports/kpi',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);
            const {days} = reportOverviewQuery.parse(req.query);
            const {rangeStart, rangeEnd} = getReportDateRange(days);

            const payload = await withTransaction(async client => {
                await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

                const roleResult = await client.query(
                    `SELECT role
           FROM public.team_membership
           WHERE team_id = $1 AND user_uid = $2
           LIMIT 1`,
                    [parsedTeamId, authenticatedActorUid]
                );

                const kpi = await getReportsKpi(
                    client,
                    parsedTeamId,
                    rangeStart,
                    rangeEnd
                );

                return {
                    kpi,
                    meta: {
                        teamId: parsedTeamId,
                        days,
                        rangeStart: rangeStart.toISOString(),
                        rangeEnd: rangeEnd.toISOString(),
                        generatedAt: new Date().toISOString(),
                        actorRole: (roleResult.rows[0]?.role as string | undefined) ?? null,
                    },
                };
            });

            logEndpointAudit({
                operation: 'reports.kpi',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.json(payload);
        } catch (error) {
            logEndpointAudit({
                operation: 'reports.kpi',
                outcome: 'error',
                actorUid,
                teamId,
                error,
            });
            return next(error);
        }
    }
);

api.get(
    '/teams/:teamId/reports/overview',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        try {
            ({teamId} = teamIdParam.parse(req.params));
            const parsedTeamId = teamId;
            const authenticatedActorUid = getActorUid(req);
            const {days, overdueLimit} = reportOverviewQuery.parse(req.query);
            const {rangeStart, rangeEnd} = getReportDateRange(days);

            const payload = await withTransaction(async client => {
                await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

                const roleResult = await client.query(
                    `SELECT role
           FROM public.team_membership
           WHERE team_id = $1 AND user_uid = $2
           LIMIT 1`,
                    [parsedTeamId, authenticatedActorUid]
                );

                const kpi = await getReportsKpi(
                    client,
                    parsedTeamId,
                    rangeStart,
                    rangeEnd
                );
                const members = await getReportsMembers(
                    client,
                    parsedTeamId,
                    rangeStart,
                    rangeEnd
                );
                const overdueTasks = await getReportsOverdueTasks(
                    client,
                    parsedTeamId,
                    rangeStart,
                    rangeEnd,
                    overdueLimit
                );

                return {
                    kpi,
                    members,
                    overdueTasks,
                    meta: {
                        teamId: parsedTeamId,
                        days,
                        overdueLimit,
                        rangeStart: rangeStart.toISOString(),
                        rangeEnd: rangeEnd.toISOString(),
                        generatedAt: new Date().toISOString(),
                        actorRole: (roleResult.rows[0]?.role as string | undefined) ?? null,
                    },
                };
            });

            logEndpointAudit({
                operation: 'reports.overview',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
            });

            return res.json(payload);
        } catch (error) {
            logEndpointAudit({
                operation: 'reports.overview',
                outcome: 'error',
                actorUid,
                teamId,
                error,
            });
            return next(error);
        }
    }
);

api.delete(
    '/teams/:teamId/tasks/:taskId',
    requireUser,
    userRateLimit,
    async (req, res, next) => {
        const actorUid = req.user?.uid ?? null;
        let teamId: string | null = null;
        let taskId: string | null = null;
        try {
            ({teamId, taskId} = teamTaskParam.parse(req.params));
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

            await deleteTaskFromFirestore(parsedTeamId, deletedTaskId);

            logEndpointAudit({
                operation: 'tasks.delete',
                outcome: 'success',
                actorUid: authenticatedActorUid,
                teamId: parsedTeamId,
                taskId: deletedTaskId,
            });

            return res.json({deletedTaskId});
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
            ({teamId} = teamIdParam.parse(req.params));
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

            return res.json({taskIds});
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

            return res.status(201).json({userReward});
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
