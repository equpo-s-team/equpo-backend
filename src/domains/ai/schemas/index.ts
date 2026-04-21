import { z } from 'zod';

export const generateDescriptionSchema = z.object({
  description: z
    .string()
    .min(1, 'Description is required')
    .max(5000, 'Description must not exceed 5000 characters'),
});
