import { z } from 'zod';

const prioritySchema = z.enum(['high', 'medium', 'low']);
const taskStatusSchema = z.enum(['todo', 'in-progress', 'in-qa', 'done']);
const recurringIntervalSchema = z.enum(['days', 'weeks', 'months']);
const categoriesSchema = z.array(z.string().min(1).max(12)).max(50);

export const createTaskSchema = z.object({
  dueDate: z.string().datetime(),
  priority: prioritySchema,
  status: taskStatusSchema,
  categories: categoriesSchema.optional(),
  isRecurring: z.boolean().optional(),
  recurringInterval: recurringIntervalSchema.optional(),
  assignedUserUid: z.string().min(1).nullable().optional(),
  assignedGroupId: z.string().uuid().nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
