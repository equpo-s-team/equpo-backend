import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { getFirebaseAuth } from '#a/firebaseAdmin.js';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import winston from 'winston';

export const requireUser: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res
        .status(ERROR_STATUS.UNAUTHORIZED)
        .json({ error: 'Missing or invalid Authorization header' });
    }

    const decoded = await getFirebaseAuth().verifyIdToken(token);

    // Reject password-provider accounts that haven't verified their email yet.
    // Google and other federated providers are exempt — their identity is already
    // confirmed by the external provider.
    const provider = decoded.firebase?.sign_in_provider;
    if (provider === 'password' && decoded.email_verified !== true) {
      return res
        .status(ERROR_STATUS.FORBIDDEN)
        .json({ error: 'Email not verified', code: 'auth/email-not-verified' });
    }

    req.user = { uid: decoded.uid, claims: decoded };
    return next();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown auth error';
    winston.error('Auth error:', message);
    return res
      .status(ERROR_STATUS.UNAUTHORIZED)
      .json({ error: 'Invalid auth token' });
  }
};
