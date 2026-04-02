import { type ZodType, type ZodError } from 'zod';
import { EqupoError } from '@/types/EqupoError';
import { ERROR_STATUS } from '@/constants/httpStatusCodes';

export function assertBody<T extends ZodType<any, any, any>>(
  schema: T,
  body: unknown
): T['_output'] {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = (result.error as ZodError).issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    const error = new EqupoError('Invalid request body');
    error.status = ERROR_STATUS.VALIDATION;
    error.details = details;
    throw error;
  }
  return result.data;
}
