import { z } from 'zod';

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
  photoUrl: z.string().url().nullable().optional(),
});

export const inviteTeamMemberSchema = z
  .object({
    userUid: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z
      .enum(['collaborator', 'spectator', 'member'])
      .optional()
      .default('member'),
  })
  .refine(data => Boolean(data.userUid) !== Boolean(data.email), {
    message: 'Provide exactly one of userUid or email',
  });

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(['collaborator', 'spectator', 'member']),
});

export const mirrorMyAvatarSchema = z.object({
  sourceUrl: z.string().url(),
});

export const joinTeamWithInviteCodeSchema = z.object({
  code: z.string().min(1),
});

export const invitePreviewQuerySchema = z.object({
  code: z.string().min(1),
});

export const createInvitationCodeSchema = z.object({
  role: z
    .enum(['collaborator', 'spectator', 'member'])
    .optional()
    .default('member'),
  expiresInHours: z.number().int().min(1).max(720).optional().default(24),
  maxUses: z.number().int().min(1).max(1000).optional().default(10),
});
