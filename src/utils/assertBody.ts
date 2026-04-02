import { type ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { EqupoError } from '#a/types/EqupoError.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';

export function assertBody<T extends ZodType<unknown, ZodTypeDef, unknown>>(
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
