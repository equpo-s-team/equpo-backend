import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
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
};
