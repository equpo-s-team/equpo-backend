import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { Request } from 'express';
import winston from 'winston';

export function getActorUid(req: Request): string {
  if (!req.user) {
    throw new EqupoError(
      'Missing authenticated user',
      ERROR_STATUS.UNAUTHORIZED
    );
  }
  return req.user.uid;
}

export type AuditOutcome = 'success' | 'error';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

export function logEndpointAudit(params: {
  operation: string;
  outcome: AuditOutcome;
  actorUid: string | null;
  teamId?: string | null;
  taskId?: string | null;
  targetUserUid?: string | null;
  error?: unknown;
}) {
  const payload = {
    operation: params.operation,
    outcome: params.outcome,
    actorUid: params.actorUid,
    teamId: params.teamId ?? null,
    taskId: params.taskId ?? null,
    targetUserUid: params.targetUserUid ?? null,
    at: new Date().toISOString(),
    error: params.error ? getErrorMessage(params.error) : undefined,
  };

  if (params.outcome === 'success') {
    winston.info('task_audit', payload);
    return;
  }

  winston.warn('task_audit', payload);
}
