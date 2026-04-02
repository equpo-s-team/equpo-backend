import { z } from 'zod';

export const TEAM_ALLOWED_ROLES = new Set(['leader', 'collaborator']);
export const TEAM_MEMBER_ROLES = new Set(['collaborator', 'spectator', 'member']);

export const teamIdParam = z.object({
  teamId: z.string().uuid(),
});

export const teamMemberParam = z.object({
  teamId: z.string().uuid(),
  userUid: z.string().min(1),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  virtualCurrency: z.number().int().min(0).optional(),
});

export const inviteTeamMemberSchema = z.object({
  userUid: z.string().min(1),
  role: z.enum(['collaborator', 'spectator', 'member']).optional().default('member'),
});

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(['collaborator', 'spectator', 'member']),
});

export const createTeamRewardSchema = z.object({
  rewardId: z.string().uuid(),
  dateObtained: z.string().datetime().optional(),
});

export const createAchievementSchema = z.object({
  userUid: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  iconURL: z.string().url().nullable().optional(),
  unlockedAt: z.string().datetime().optional(),
});

export const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  virtualCurrency: z.number().int().min(0),
  description: z.string().max(2000).nullable().optional(),
});

export const createSystemUserRewardSchema = z.object({
  rewardId: z.string().uuid(),
  dateObtained: z.string().datetime().optional(),
});

export function assertBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    const error = new Error('Invalid request body');
    error.status = 400;
    error.details = details;
    throw error;
  }
  return result.data;
}

export async function assertTeamPermission(client, teamId, actorUid) {
  const teamResult = await client.query(
    'SELECT id, leader_uid FROM public.team WHERE id = $1 LIMIT 1',
    [teamId]
  );

  if (!teamResult.rowCount) {
    const error = new Error('Team not found');
    error.status = 404;
    throw error;
  }

  const team = teamResult.rows[0];
  if (team.leader_uid === actorUid) {
    return { isLeader: true, role: 'leader', teamId: team.id };
  }

  const membershipResult = await client.query(
    'SELECT role FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1',
    [teamId, actorUid]
  );

  if (!membershipResult.rowCount) {
    const error = new Error('Forbidden: not a team member');
    error.status = 403;
    throw error;
  }

  const role = String(membershipResult.rows[0].role || '').toLowerCase();
  if (!TEAM_ALLOWED_ROLES.has(role)) {
    const error = new Error('Forbidden: insufficient role');
    error.status = 403;
    throw error;
  }

  return { isLeader: false, role, teamId: team.id };
}

export async function assertTeamLeaderPermission(client, teamId, actorUid) {
  const teamResult = await client.query(
    'SELECT id, leader_uid FROM public.team WHERE id = $1 LIMIT 1',
    [teamId]
  );

  if (!teamResult.rowCount) {
    const error = new Error('Team not found');
    error.status = 404;
    throw error;
  }

  const team = teamResult.rows[0];
  if (team.leader_uid !== actorUid) {
    const error = new Error('Forbidden: only team leader can perform this action');
    error.status = 403;
    throw error;
  }

  return { isLeader: true, role: 'leader', teamId: team.id };
}

export async function assertUserBelongsToTeam(client, teamId, userUid) {
  const isLeader = await client.query(
    'SELECT 1 FROM public.team WHERE id = $1 AND leader_uid = $2 LIMIT 1',
    [teamId, userUid]
  );
  if (isLeader.rowCount) return;

  const membership = await client.query(
    'SELECT 1 FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1',
    [teamId, userUid]
  );

  if (!membership.rowCount) {
    const error = new Error('Target user is not part of the team');
    error.status = 400;
    throw error;
  }
}
