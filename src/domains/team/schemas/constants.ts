export const TEAM_ALLOWED_ROLES = new Set(['leader', 'collaborator'] as const);
export const TEAM_MEMBER_ROLES = new Set([
  'collaborator',
  'spectator',
  'member',
] as const);
