import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate-limit';

export interface RateLimitBudget {
  /** Requests sharing one counter. Routes with the same scope share a budget. */
  scope: string;
  limit: number;
  windowSeconds: number;
}

/**
 * `default` and `auth` read their numbers from the environment so an operator
 * can tighten them without a deploy; an inline budget is for the rare route
 * whose cost is nothing like the others.
 */
export type RateLimitSetting = 'default' | 'auth' | 'none' | RateLimitBudget;

export const RateLimit = (setting: RateLimitSetting) => SetMetadata(RATE_LIMIT_KEY, setting);

/**
 * The tight budget, for anything that takes a credential and tells you
 * whether it was right. Applied to login and refresh.
 */
export const AuthRateLimit = () => SetMetadata(RATE_LIMIT_KEY, 'auth');

/** For probes and scrapes, which are supposed to be frequent. */
export const NoRateLimit = () => SetMetadata(RATE_LIMIT_KEY, 'none');
