import { z } from 'zod';

export const createRewardSchema = z.object({
  name: z.string().min(1).max(120),
  cost: z.number().int().min(0),
  experienceGranted: z.number().int().min(0),
  type: z.enum(['team', 'member']),
  description: z.string().max(2000).optional(),
  iconURL: z.string().optional(),
});
