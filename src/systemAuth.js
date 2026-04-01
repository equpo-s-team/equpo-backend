import { config } from './config.js';

export function requireSystem(req, res, next) {
  const key = req.headers['x-system-key'];
  if (!key || key !== config.systemApiKey) {
    return res.status(401).json({ error: 'Invalid system key' });
  }
  return next();
}

