import type { AuthenticatedUser } from '#a/types/auth.js';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
