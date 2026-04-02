import type { AuthenticatedUser } from '#a/types/auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
