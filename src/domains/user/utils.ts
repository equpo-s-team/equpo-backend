import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { URL } from 'node:url';

export const ALLOWED_EXTERNAL_AVATAR_HOSTS = new Set([
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
]);

export const MAX_USER_AVATAR_BYTES = 5 * 1024 * 1024;

export function assertAllowedExternalAvatarUrl(sourceUrl: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new EqupoError('Invalid avatar source URL', ERROR_STATUS.VALIDATION);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new EqupoError(
      'Only HTTPS avatar URLs are allowed',
      ERROR_STATUS.VALIDATION
    );
  }

  if (!ALLOWED_EXTERNAL_AVATAR_HOSTS.has(parsedUrl.hostname)) {
    throw new EqupoError('Avatar host is not allowed', ERROR_STATUS.VALIDATION);
  }

  return parsedUrl;
}
