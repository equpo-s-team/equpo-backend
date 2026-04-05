import { z } from 'zod';

const prioritySchema = z.enum(['high', 'medium', 'low']);
const taskStatusSchema = z.enum(['todo', 'in-progress', 'in-qa', 'done']);
const recurringIntervalSchema = z.enum(['days', 'weeks', 'months', 'years']);
const categoriesSchema = z.array(z.string().min(1).max(12)).max(50);

export const updateTaskSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  dueDate: z.string().datetime().optional(),
  priority: prioritySchema.optional(),
  status: taskStatusSchema.optional(),
  categories: categoriesSchema.optional(),
  isRecurring: z.boolean().optional(),
  recurringInterval: recurringIntervalSchema.nullable().optional(),
  recurringCount: z.number().int().min(1).max(365).nullable().optional(),
  assignedUserUid: z.string().min(1).nullable().optional(),
  assignedGroupId: z.string().uuid().nullable().optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
