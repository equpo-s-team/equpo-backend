import { z } from 'zod';

export const createTaskCommentarySchema = z.object({
  commentary: z.string().min(1).max(500),
});

export const updateTaskCommentarySchema = z.object({
  commentary: z.string().min(1).max(500),
});

export const taskCommentaryParam = z.object({
  teamId: z.string().uuid(),
  taskId: z.string().uuid(),
  commentaryId: z.string().min(1).max(500),
});

export type CreateTaskCommentaryInput = z.infer<
  typeof createTaskCommentarySchema
>;
export type UpdateTaskCommentaryInput = z.infer<
  typeof updateTaskCommentarySchema
>;
