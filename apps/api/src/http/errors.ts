import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { SessionNotFoundError } from '@chalk/agent-runtime';

import {
  AuthRequiredError,
  OwnershipError,
  ToolApprovalAlreadyDecidedError,
  ToolApprovalNotActiveError,
} from '../db/errors';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
    if (errorCode?.startsWith('FST_ERR_CTP_')) {
      return reply.code(400).send({ error: 'Invalid request body', code: 'INVALID_REQUEST' });
    }
    if (error instanceof AuthRequiredError) {
      return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    if (error instanceof OwnershipError) {
      return reply.code(404).send({ error: 'Resource not found', code: 'NOT_FOUND' });
    }
    if (error instanceof ToolApprovalAlreadyDecidedError) {
      return reply.code(409).send({
        error: 'Tool approval has already been decided',
        code: 'TOOL_APPROVAL_ALREADY_DECIDED',
      });
    }
    if (error instanceof ToolApprovalNotActiveError) {
      return reply.code(409).send({
        error: 'No active approval is waiting for a decision',
        code: 'NO_ACTIVE_APPROVAL',
      });
    }
    if (error instanceof SessionNotFoundError) {
      return reply.code(404).send({ error: 'Conversation session not found', code: 'SESSION_NOT_FOUND' });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        code: 'INVALID_REQUEST',
        issues: error.issues,
      });
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    }

    request.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });
}
