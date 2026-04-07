import { z } from 'zod';

export const zegoTokenParam = z.object({
  teamId: z.string().uuid(),
  roomId: z.string().min(1).max(128),
});

export type ZegoTokenParam = z.infer<typeof zegoTokenParam>;

export const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  memberUids: z.array(z.string()).max(40).optional(),
});

export type CreateGroupBody = z.infer<typeof createGroupSchema>;

export const addGroupMembersSchema = z.object({
  memberUids: z.array(z.string().min(1)).min(1).max(40),
});

export type AddGroupMembersBody = z.infer<typeof addGroupMembersSchema>;

export const groupIdParam = z.object({
  teamId: z.string().uuid(),
  groupId: z.string().uuid(),
});

export type GroupIdParam = z.infer<typeof groupIdParam>;
