import { z } from 'zod';

export const createSystemUserRewardSchema = z.object({
  rewardId: z.string().uuid(),
  dateObtained: z.string().datetime().optional(),
});
