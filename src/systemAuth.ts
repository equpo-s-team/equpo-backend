import { config } from './config.js';
import { Request, Response, NextFunction } from 'express';

export function requireSystem(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-system-key'];
  if (!key || key !== config.systemApiKey) {
    return res.status(401).json({ error: 'Invalid system key' });
  }
  return next();
}
