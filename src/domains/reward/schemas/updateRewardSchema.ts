import { z } from 'zod';

export const updateRewardSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cost: z.number().int().min(0).optional(),
  experienceGranted: z.number().int().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
  iconURL: z.string().nullable().optional(),
});
