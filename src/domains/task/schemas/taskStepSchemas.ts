import { z } from 'zod';

export const createTaskStepSchema = z.object({
  step: z.string().min(1).max(200),
});

export const toggleTaskStepSchema = z.object({
  isDone: z.boolean(),
});

export const updateTaskStepSchema = z.object({
  step: z.string().min(1).max(200),
});

export const taskStepParam = z.object({
  teamId: z.string().uuid(),
  taskId: z.string().uuid(),
  stepId: z.string().min(1).max(200),
});

export type CreateTaskStepInput = z.infer<typeof createTaskStepSchema>;
export type ToggleTaskStepInput = z.infer<typeof toggleTaskStepSchema>;
export type UpdateTaskStepInput = z.infer<typeof updateTaskStepSchema>;
