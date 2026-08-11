export const ErrorKind = {
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  Invalid: 'INVALID',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  RateLimited: 'RATE_LIMITED',
  Internal: 'INTERNAL',
} as const;

export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

export const ERROR_KIND_STATUS: Record<ErrorKind, number> = {
  [ErrorKind.NotFound]: 404,
  [ErrorKind.Conflict]: 409,
  [ErrorKind.Invalid]: 400,
  [ErrorKind.Unauthorized]: 401,
  [ErrorKind.Forbidden]: 403,
  [ErrorKind.RateLimited]: 429,
  [ErrorKind.Internal]: 500,
};
