import { NextFunction, RequestHandler, Request, Response } from 'express';
import winston from 'winston';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { getFirebaseAuth } from '#a/firebaseAdmin.js';

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
