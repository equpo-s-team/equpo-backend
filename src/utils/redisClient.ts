import { config } from '#a/config.js';
import { Redis } from 'ioredis';
import winston from 'winston';

export const redisClient = new Redis({
  host: config.redisHost,
  port: config.redisPort,
  retryStrategy(times) {
    winston.warn(`Retrying Redis connection (attempt ${times})`);
    return Math.min(times * 50, 2000);
  },
});

export const pubClient = redisClient.duplicate();
export const subClient = redisClient.duplicate();

redisClient.on('error', err => {
  winston.error('Redis Client Error', err);
});

redisClient.on('connect', () => {
  winston.info(`Connected to Redis at ${config.redisHost}:${config.redisPort}`);
});
