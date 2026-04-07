import crypto from 'node:crypto';

/**
 * ZEGOCLOUD token generation (token04 format).
 *
 * Based on the official zego_server_assistant algorithm:
 * https://github.com/ZEGOCLOUD/zego_server_assistant
 *
 * The token structure is: "04" + base64(expiredTime + iv + encrypted(body))
 * where body = { app_id, user_id, nonce, ctime, expire, payload }
 */

interface TokenBody {
  app_id: number;
  user_id: string;
  nonce: number;
  ctime: number;
  expire: number;
  payload: string;
}

function makeNonce(): number {
  return crypto.randomInt(0, 2_147_483_647);
}

function encryptAesCbc(
  plainText: string,
  secretKey: string,
  iv: Buffer
): Buffer {
  const key = Buffer.from(secretKey, 'utf-8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key.subarray(0, 16), iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf-8'),
    cipher.final(),
  ]);
  return encrypted;
}

/**
 * Generate a ZEGOCLOUD token04 for a given user.
 *
 * @param appId - ZEGOCLOUD application ID
 * @param userId - Unique user identifier
 * @param serverSecret - 32-character server secret (hex)
 * @param effectiveTimeInSeconds - Token validity duration in seconds
 * @param payload - Optional payload string (empty for standard auth)
 * @returns The generated token string prefixed with "04"
 */
export function generateZegoToken(
  appId: number,
  userId: string,
  serverSecret: string,
  effectiveTimeInSeconds: number,
  payload: string = ''
): string {
  if (!appId || typeof appId !== 'number') {
    throw new Error('appId is required and must be a number');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId is required and must be a string');
  }
  if (!serverSecret || serverSecret.length !== 32) {
    throw new Error('serverSecret must be a 32-character string');
  }
  if (
    !effectiveTimeInSeconds ||
    typeof effectiveTimeInSeconds !== 'number' ||
    effectiveTimeInSeconds <= 0
  ) {
    throw new Error('effectiveTimeInSeconds must be a positive number');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expireTime = nowSeconds + effectiveTimeInSeconds;

  const body: TokenBody = {
    app_id: appId,
    user_id: userId,
    nonce: makeNonce(),
    ctime: nowSeconds,
    expire: expireTime,
    payload,
  };

  const bodyJson = JSON.stringify(body);
  const iv = crypto.randomBytes(16);
  const encrypted = encryptAesCbc(bodyJson, serverSecret, iv);

  // Token binary layout:
  // [8 bytes: expiredTime (BigInt64BE)] [2 bytes: ivLength (UInt16BE)] [iv] [2 bytes: encryptedLength (UInt16BE)] [encrypted]
  const expiredTimeBuf = Buffer.alloc(8);
  expiredTimeBuf.writeBigInt64BE(BigInt(expireTime));

  const ivLenBuf = Buffer.alloc(2);
  ivLenBuf.writeUInt16BE(iv.length);

  const encLenBuf = Buffer.alloc(2);
  encLenBuf.writeUInt16BE(encrypted.length);

  const tokenBin = Buffer.concat([
    expiredTimeBuf,
    ivLenBuf,
    iv,
    encLenBuf,
    encrypted,
  ]);

  return '04' + tokenBin.toString('base64');
}
