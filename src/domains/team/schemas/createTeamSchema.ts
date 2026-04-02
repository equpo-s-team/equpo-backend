import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  virtualCurrency: z.number().int().min(0),
  description: z.string().max(2000).nullable().optional(),
});
