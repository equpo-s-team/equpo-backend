import { Request } from 'express';
import type { AuthenticatedUser } from '#a/types/auth.js';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
