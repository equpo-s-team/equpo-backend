import type { PoolClient } from 'pg';

import { getFirestoreDb } from '#a/firebaseAdmin.js';

import { ACHIEVEMENT_KEYS } from './achievementConstants.js';

export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  unlockedAt: string;
}

/**
 * Look up the achievement row id for a given key (name).
 * Returns null when the achievement hasn't been seeded yet.
 */
async function getAchievementId(
  client: PoolClient,
  key: string
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT id FROM public.achievement WHERE name = $1 LIMIT 1`,
    [key]
  );
  return (rows[0]?.id as string) ?? null;
}

/**
 * Returns true when the user does NOT already have this achievement.
 */
async function isNotUnlocked(
  client: PoolClient,
  userUid: string,
  achievementId: string
): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM public.user_achievement
     WHERE user_uid = $1 AND achievement_id = $2
     LIMIT 1`,
    [userUid, achievementId]
  );
  return !rowCount;
}

/**
 * Unlock an achievement for a user. Returns the unlocked achievement data
 * or null when it was already unlocked (ON CONFLICT DO NOTHING).
 */
async function unlock(
  client: PoolClient,
  userUid: string,
  achievementId: string
): Promise<UnlockedAchievement | null> {
  const { rowCount } = await client.query(
    `INSERT INTO public.user_achievement (user_uid, achievement_id, unlocked_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_uid, achievement_id) DO NOTHING`,
    [userUid, achievementId]
  );

  if (!rowCount) return null;

  const { rows } = await client.query(
    `SELECT a.id, a.name, a.description, a.icon_u_r_l AS "iconUrl",
            ua.unlocked_at AS "unlockedAt"
     FROM public.achievement a
     JOIN public.user_achievement ua
       ON ua.achievement_id = a.id AND ua.user_uid = $1
     WHERE a.id = $2`,
    [userUid, achievementId]
  );

  if (!rows[0]) return null;

  return {
    id: rows[0].id as string,
    name: rows[0].name as string,
    description: (rows[0].description as string | null) ?? null,
    iconUrl: (rows[0].iconUrl as string | null) ?? null,
    unlockedAt: (rows[0].unlockedAt as Date).toISOString(),
  };
}

// ─── Individual Achievement Checkers ─────────────────────────────────────────

async function checkPrimerPaso(
  client: PoolClient,
  userUid: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.PRIMER_PASO);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  const { rows } = await client.query(
    `SELECT 1 FROM public.task
     WHERE assigned_user_uid = $1 AND status = 'done'
     LIMIT 1`,
    [userUid]
  );

  // Also check via group membership
  if (!rows.length) {
    const { rows: groupRows } = await client.query(
      `SELECT 1 FROM public.task t
       JOIN public.group_membership gm ON gm.group_id = t.assigned_group_id
       WHERE gm.user_uid = $1 AND t.status = 'done'
       LIMIT 1`,
      [userUid]
    );
    if (!groupRows.length) return null;
  }

  return unlock(client, userUid, id);
}

async function checkNuevaAlianza(
  client: PoolClient,
  userUid: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.NUEVA_ALIANZA);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  // Count team members in teams where user is leader (excluding self)
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT tm.user_uid)::int AS cnt
     FROM public.team_membership tm
     JOIN public.team t ON t.id = tm.team_id
     WHERE t.leader_uid = $1 AND tm.user_uid <> $1`,
    [userUid]
  );

  if (Number(rows[0]?.cnt ?? 0) < 3) return null;
  return unlock(client, userUid, id);
}

async function checkSubidaDeNivel(
  client: PoolClient,
  userUid: string,
  newLevel: number
): Promise<UnlockedAchievement | null> {
  if (newLevel < 1) return null;

  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.SUBIDA_DE_NIVEL);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  return unlock(client, userUid, id);
}

async function checkSinergia(
  client: PoolClient,
  userUid: string,
  assignedUserUid: string | null,
  assignedGroupId: string | null
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.SINERGIA);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  if (!assignedGroupId) return null;

  // Count group members
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS cnt
     FROM public.group_membership
     WHERE group_id = $1`,
    [assignedGroupId]
  );
  const groupMemberCount = Number(rows[0]?.cnt ?? 0);

  // If a user is directly assigned + group has 2+ members,
  // or group alone has 3+ members → achievement unlocked
  if (assignedUserUid) {
    // Check if assignedUser is already in the group
    const { rowCount } = await client.query(
      `SELECT 1 FROM public.group_membership
       WHERE group_id = $1 AND user_uid = $2 LIMIT 1`,
      [assignedGroupId, assignedUserUid]
    );
    const totalPeople = rowCount ? groupMemberCount : groupMemberCount + 1;
    if (totalPeople < 3) return null;
  } else {
    if (groupMemberCount < 3) return null;
  }

  return unlock(client, userUid, id);
}

async function checkVelocidadLuz(
  client: PoolClient,
  userUid: string,
  teamId: string,
  taskId: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.VELOCIDAD_LUZ);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  // createdAt lives in Firestore, not PostgreSQL
  const taskDoc = await getFirestoreDb().collection(teamId).doc(taskId).get();

  if (!taskDoc.exists) return null;

  const data = taskDoc.data();
  const createdAt = data?.createdAt;
  if (!createdAt) return null;

  // Firestore Timestamps have a toDate() method; plain Date objects do not
  const createdDate =
    typeof createdAt.toDate === 'function'
      ? (createdAt.toDate() as Date)
      : new Date(createdAt as string);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (createdDate < oneHourAgo) return null;

  return unlock(client, userUid, id);
}

async function checkRedDeTrabajo(
  client: PoolClient,
  userUid: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.RED_DE_TRABAJO);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  // Count distinct groups the user created (user is member and is leader of the team)
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT g.id)::int AS cnt
     FROM public."group" g
     JOIN public.group_membership gm ON gm.group_id = g.id
     JOIN public.team t ON t.id = g.team_id
     WHERE gm.user_uid = $1 AND t.leader_uid = $1`,
    [userUid]
  );

  if (Number(rows[0]?.cnt ?? 0) < 3) return null;
  return unlock(client, userUid, id);
}

async function checkMentorVirtual(
  client: PoolClient,
  userUid: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.MENTOR_VIRTUAL);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT tm.team_id)::int AS cnt
     FROM public.team_membership tm
     WHERE tm.user_uid = $1 AND tm.role = 'spectator'`,
    [userUid]
  );

  if (Number(rows[0]?.cnt ?? 0) < 3) return null;
  return unlock(client, userUid, id);
}

// ─── Health-based achievements (computed from KPI) ───────────────────────────

/**
 * Compute environment health from task KPIs.
 * Formula: clamp(60 + completedPercent - overduePercent * 2, 0, 100)
 */
export function computeEnvironmentHealth(
  totalTasks: number,
  doneTasks: number,
  overdueTasks: number
): number {
  if (totalTasks <= 0) return 60;
  const completedPercent = (doneTasks / totalTasks) * 100;
  const overduePercent = (overdueTasks / totalTasks) * 100;
  const hp = 60 + completedPercent - overduePercent * 2;
  return Math.max(0, Math.min(100, Math.round(hp)));
}

async function checkVidaNueva(
  client: PoolClient,
  userUid: string,
  teamId: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(client, ACHIEVEMENT_KEYS.VIDA_NUEVA);
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE status <> 'done' AND due_date < NOW())::int AS overdue
     FROM public.task
     WHERE team_id = $1`,
    [teamId]
  );

  const total = Number(rows[0]?.total ?? 0);
  const done = Number(rows[0]?.done ?? 0);
  const overdue = Number(rows[0]?.overdue ?? 0);
  const health = computeEnvironmentHealth(total, done, overdue);

  if (health < 100) return null;
  return unlock(client, userUid, id);
}

async function checkTiempoDeResurgir(
  client: PoolClient,
  userUid: string,
  teamId: string
): Promise<UnlockedAchievement | null> {
  const id = await getAchievementId(
    client,
    ACHIEVEMENT_KEYS.TIEMPO_DE_RESURGIR
  );
  if (!id || !(await isNotUnlocked(client, userUid, id))) return null;

  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE status <> 'done' AND due_date < NOW())::int AS overdue
     FROM public.task
     WHERE team_id = $1`,
    [teamId]
  );

  const total = Number(rows[0]?.total ?? 0);
  const done = Number(rows[0]?.done ?? 0);
  const overdue = Number(rows[0]?.overdue ?? 0);
  const health = computeEnvironmentHealth(total, done, overdue);

  if (health > 20) return null;
  return unlock(client, userUid, id);
}

// ─── Main Checker ────────────────────────────────────────────────────────────

export interface AchievementCheckContext {
  client: PoolClient;
  userUid: string;
  teamId: string;
  taskId: string;
  newLevel: number;
  assignedUserUid: string | null;
  assignedGroupId: string | null;
}

/**
 * Run all applicable achievement checks after a task is completed.
 * Returns the list of newly unlocked achievements.
 */
export async function checkAchievementsOnTaskComplete(
  ctx: AchievementCheckContext
): Promise<UnlockedAchievement[]> {
  const results = await Promise.all([
    checkPrimerPaso(ctx.client, ctx.userUid),
    checkNuevaAlianza(ctx.client, ctx.userUid),
    checkSubidaDeNivel(ctx.client, ctx.userUid, ctx.newLevel),
    checkSinergia(
      ctx.client,
      ctx.userUid,
      ctx.assignedUserUid,
      ctx.assignedGroupId
    ),
    checkVelocidadLuz(ctx.client, ctx.userUid, ctx.teamId, ctx.taskId),
    checkRedDeTrabajo(ctx.client, ctx.userUid),
    checkMentorVirtual(ctx.client, ctx.userUid),
    checkVidaNueva(ctx.client, ctx.userUid, ctx.teamId),
    checkTiempoDeResurgir(ctx.client, ctx.userUid, ctx.teamId),
  ]);

  return results.filter((r): r is UnlockedAchievement => r !== null);
}
