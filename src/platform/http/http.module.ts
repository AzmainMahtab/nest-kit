import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from './guards/rate-limit.guard';

/**
 * Global HTTP-level policy that is not tied to a bounded context.
 *
 * Nest runs global guards in the order their providers are registered, so
 * **this module must be imported before `AuthModule`** in `app.module.ts`:
 * the limiter has to reject a flood before `JwtAuthGuard` spends a signature
 * verification on it, and login has no token for `JwtAuthGuard` to check in
 * the first place. `app.e2e-spec.ts` asserts that order by hammering a
 * protected route with no credentials and expecting 429, not 401.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class HttpModule {}
