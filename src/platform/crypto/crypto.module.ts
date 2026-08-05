import { Global, Module } from '@nestjs/common';

import { Clock, Hasher } from '../../shared/application';
import { Argon2Hasher } from './argon2-hasher';
import { SystemClock } from './system-clock';

@Global()
@Module({
  providers: [
    { provide: Hasher, useClass: Argon2Hasher },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [Hasher, Clock],
})
export class CryptoModule {}
