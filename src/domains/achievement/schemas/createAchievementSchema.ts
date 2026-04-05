import { z } from 'zod';

export const createAchievementSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  iconURL: z.string().url().nullable().optional(),
});

export const unlockAchievementSchema = z.object({
  userUid: z.string().min(1),
  achievementId: z.string().uuid(),
  unlockedAt: z.string().datetime().optional(),
});
