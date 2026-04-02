import { z } from 'zod';

export const createTeamRewardSchema = z.object({
  rewardId: z.string().uuid(),
  dateObtained: z.string().datetime().optional(),
});
