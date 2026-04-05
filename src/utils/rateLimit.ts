import { NextFunction, Request, RequestHandler, Response } from 'express';
import winston from 'winston';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';

export type UserRateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  blockMs: number;
  maxBlockMs: number;
};

type RateLimitEntry = {
  windowStart: number;
  requestCount: number;
  blockedUntil: number;
  violations: number;
  lastSeenAt: number;
};

function getUserKey(req: Request): string | null {
  return req.user?.uid ?? null;
}

function sendRateLimitExceeded(
  res: Response,
  retryAfterMs: number,
  options: UserRateLimitOptions
): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));

  return res.status(ERROR_STATUS.TOO_MANY_REQUESTS).json({
    error: 'Too many requests',
    details: {
      retryAfterSeconds,
      windowMs: options.windowMs,
      maxRequests: options.maxRequests,
    },
  });
}

export function createUserRateLimitMiddleware(
  options: UserRateLimitOptions
): RequestHandler {
  const entries = new Map<string, RateLimitEntry>();
  const staleEntryTtlMs = Math.max(options.windowMs, options.maxBlockMs) * 2;
  let requestCounter = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const userKey = getUserKey(req);

    if (!userKey) {
      return res
        .status(ERROR_STATUS.UNAUTHORIZED)
        .json({ error: 'Missing authenticated user' });
    }

    if (requestCounter++ % 250 === 0) {
      for (const [key, entry] of entries.entries()) {
        const expired = now - entry.lastSeenAt > staleEntryTtlMs;
        const notBlocked = entry.blockedUntil <= now;
        if (expired && notBlocked) {
          entries.delete(key);
        }
      }
    }

    const existingEntry = entries.get(userKey);
    const entry: RateLimitEntry = existingEntry ?? {
      windowStart: now,
      requestCount: 0,
      blockedUntil: 0,
      violations: 0,
      lastSeenAt: now,
    };

    entry.lastSeenAt = now;

    if (entry.blockedUntil > now) {
      winston.warn('rate_limit_blocked_request', {
        uid: userKey,
        retryAfterMs: entry.blockedUntil - now,
      });
      entries.set(userKey, entry);
      return sendRateLimitExceeded(res, entry.blockedUntil - now, options);
    }

    if (now - entry.windowStart >= options.windowMs) {
      entry.windowStart = now;
      entry.requestCount = 0;
    }

    entry.requestCount += 1;

    if (entry.requestCount > options.maxRequests) {
      entry.violations += 1;
      const calculatedBlockMs = options.blockMs * 2 ** (entry.violations - 1);
      const blockDurationMs = Math.min(calculatedBlockMs, options.maxBlockMs);
      entry.blockedUntil = now + blockDurationMs;
      entry.windowStart = now;
      entry.requestCount = 0;

      winston.warn('rate_limit_triggered', {
        uid: userKey,
        violations: entry.violations,
        blockDurationMs,
      });

      entries.set(userKey, entry);
      return sendRateLimitExceeded(res, blockDurationMs, options);
    }

    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, options.maxRequests - entry.requestCount))
    );
    res.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil((entry.windowStart + options.windowMs) / 1000))
    );

    entries.set(userKey, entry);
    return next();
  };
}
