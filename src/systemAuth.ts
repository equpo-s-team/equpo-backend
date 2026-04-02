import { config } from '#a/config.js';
import { Request, Response, NextFunction } from 'express';
import {ERROR_STATUS} from "#a/constants/httpStatusCodes.js";

export function requireSystem(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-system-key'];
  if (!key || key !== config.systemApiKey) {
    return res.status(ERROR_STATUS.UNAUTHORIZED).json({ error: 'Invalid system key' });
  }
  return next();
}
