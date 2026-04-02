import { NextFunction, RequestHandler, Request, Response } from 'express';
import winston from 'winston';
import { AuthenticatedRequest } from '@/types/AuthenticatedRequest';
import admin from 'firebase-admin';
import { ERROR_STATUS } from '@/constants/httpStatusCodes';

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

    const decoded = await admin.auth().verifyIdToken(token);
    (req as AuthenticatedRequest).user = { uid: decoded.uid, claims: decoded };
    return next();
  } catch (error: any) {
    winston.error('Auth error:', error.message);
    return res.status(401).json({ error: 'Invalid auth token' });
  }
};
