import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of authentication. The guard is global, so access is denied
 * by default and every exception is visible at the route that grants it.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
