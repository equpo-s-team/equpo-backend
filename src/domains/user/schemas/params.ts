import { z } from 'zod';

export const userPreviewQuerySchema = z.object({
  uid: z.string().min(1, 'User ID is required'),
});
