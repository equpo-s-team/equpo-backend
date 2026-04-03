import { z } from 'zod';

export const teamTaskParam = z.object({
  teamId: z.string().uuid(),
  taskId: z.string().uuid(),
});

export const taskListPaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
