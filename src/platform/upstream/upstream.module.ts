import { Global, Module } from '@nestjs/common';

import { HttpClient } from '../../shared/application';
import { FetchHttpClient, UPSTREAM_FETCH } from './fetch-http-client';

/**
 * `fetch` is provided rather than referenced so a test can hand the adapter a
 * stub without a network, a global mock, or a library that intercepts sockets.
 */
@Global()
@Module({
  providers: [
    { provide: UPSTREAM_FETCH, useValue: globalThis.fetch.bind(globalThis) },
    { provide: HttpClient, useClass: FetchHttpClient },
  ],
  exports: [HttpClient],
})
export class UpstreamModule {}
