import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }

  return value;
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 8080),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  allowedOrigins,
  databaseUrl: required('DATABASE_URL'),
  systemApiKey: required('SYSTEM_API_KEY'),
  rateLimit: {
    windowMs: positiveNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    maxRequests: positiveNumber('RATE_LIMIT_MAX_REQUESTS', 120),
    blockMs: positiveNumber('RATE_LIMIT_BLOCK_MS', 60_000),
    maxBlockMs: positiveNumber('RATE_LIMIT_MAX_BLOCK_MS', 900_000),
  },
  zegoAppId: Number(required('ZEGO_APP_ID')),
  zegoServerSecret: required('ZEGO_SERVER_SECRET'),
  zegoTokenTtlSeconds: positiveNumber('ZEGO_TOKEN_TTL_SECONDS', 600),
};
