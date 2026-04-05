import { z } from 'zod';

const prioritySchema = z.enum(['high', 'medium', 'low']);
const taskStatusSchema = z.enum(['todo', 'in-progress', 'in-qa', 'done']);
const recurringIntervalSchema = z.enum(['days', 'weeks', 'months', 'years']);
const categoriesSchema = z.array(z.string().min(1).max(12)).max(50);

export const createTaskSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  dueDate: z.string().datetime(),
  priority: prioritySchema,
  status: taskStatusSchema,
  categories: categoriesSchema.optional(),
  isRecurring: z.boolean().optional(),
  recurringInterval: recurringIntervalSchema.optional(),
  recurringCount: z.number().int().min(1).max(365).optional(),
  assignedUserUid: z.string().min(1).nullable().optional(),
  assignedGroupId: z.string().uuid().nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
