import { z } from 'zod';

export const rewardIdParam = z.object({
  teamId: z.string().uuid(),
  rewardId: z.string().uuid(),
});

export const redeemMemberRewardParam = z.object({
  teamId: z.string().uuid(),
  userUid: z.string().min(1),
  rewardId: z.string().uuid(),
});
