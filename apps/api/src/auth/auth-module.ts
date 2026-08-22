import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiConfig } from '../config';
import { AuthRequiredError, PermissionDeniedError } from '../db/errors';
import type { AuthService } from './auth.service';
import type { AuthenticatedUser } from './types';

type SessionCookieConfig = ApiConfig['sessionCookie'];

export class AuthModule {
  constructor(
    private readonly service: AuthService,
    private readonly sessionCookie: SessionCookieConfig,
  ) {}

  async optionalUser(request: FastifyRequest): Promise<AuthenticatedUser | null> {
    const token = request.cookies[this.sessionCookie.name];
    return token ? this.service.findSessionUser(token) : null;
  }

  async requireUser(request: FastifyRequest) {
    const user = await this.optionalUser(request);
    if (!user) throw new AuthRequiredError();
    return user;
  }

  async logout(request: FastifyRequest) {
    const token = request.cookies[this.sessionCookie.name];
    if (token) await this.service.deleteSession(token);
  }

  setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
    reply.setCookie(this.sessionCookie.name, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.sessionCookie.secure,
      path: '/',
      expires,
    });
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(this.sessionCookie.name, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.sessionCookie.secure,
      path: '/',
    });
  }

  async requireRole(request: FastifyRequest, role: AuthenticatedUser['role']) {
    const user = await this.requireUser(request);
    if (user.role !== role) throw new PermissionDeniedError();
    return user;
  }

  requireAdmin(request: FastifyRequest) {
    return this.requireRole(request, 'admin');
  }
}
