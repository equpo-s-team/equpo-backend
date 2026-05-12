import { z } from 'zod';

export const environmentInteractSchema = z.object({
  eventType: z.enum(['feed-ducks', 'water-garden']),
});

export type EnvironmentInteractInput = z.infer<
  typeof environmentInteractSchema
>;
