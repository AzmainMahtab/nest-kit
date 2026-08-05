import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { TokenBlacklist, Tokenizer } from '../../../shared/application';
import { CURRENT_USER_KEY, CurrentUser } from '../../../shared/auth-context';
import { AppError } from '../../../shared/errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenizer: Tokenizer,
    private readonly blacklist: TokenBlacklist,
  ) {}

  /**
   * Order matters (AGENTS.md §6): extract, verify the signature, verify the
   * token type, check the blacklist, then attach the caller. Checking the
   * blacklist before the signature would let an attacker probe it with forged
   * ids; skipping the type check would let a refresh token authenticate every
   * request for its whole lifetime.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.bearerToken(request);

    if (!token) {
      throw AppError.unauthorized('MISSING_TOKEN', 'authentication required');
    }

    const claims = await this.tokenizer.parseAccess(token);

    if (await this.blacklist.isRevoked(claims.jti)) {
      throw AppError.unauthorized('TOKEN_REVOKED', 'token has been revoked');
    }

    const currentUser: CurrentUser = {
      uuid: claims.sub,
      sessionUuid: claims.sid,
      jti: claims.jti,
      expiresAt: new Date(claims.exp * 1000),
    };

    (request as Request & Record<string, CurrentUser>)[CURRENT_USER_KEY] = currentUser;

    return true;
  }

  private bearerToken(request: Request): string | null {
    const header = request.headers.authorization;

    if (!header) {
      return null;
    }

    const [scheme, value] = header.split(' ');

    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
