import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

import { CURRENT_USER_KEY, CurrentUser as CurrentUserType } from '../../../shared/auth-context';
import { AppError } from '../../../shared/errors';

type AuthenticatedRequest = Request & { [CURRENT_USER_KEY]?: CurrentUserType };

/**
 * The decorator lives here rather than in `shared/auth-context` because it
 * needs `@nestjs/common`, and `shared/` is framework-free (AGENTS.md §1). The
 * type it returns is the shared one, so any context can depend on the shape
 * without depending on the framework.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserType => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[CURRENT_USER_KEY];

    if (!user) {
      // Only reachable if the decorator is used on a @Public() route, where no
      // guard ran. Failing loudly beats handing a route an undefined caller.
      throw AppError.internal(new Error('@CurrentUser() used on an unauthenticated route'));
    }

    return user;
  },
);
