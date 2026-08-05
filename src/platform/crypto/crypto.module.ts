import { Global, Module } from '@nestjs/common';

import { Clock, Hasher, Tokenizer } from '../../shared/application';
import { Argon2Hasher } from './argon2-hasher';
import { Es256Tokenizer } from './es256-tokenizer';
import { SystemClock } from './system-clock';

@Global()
@Module({
  providers: [
    { provide: Hasher, useClass: Argon2Hasher },
    { provide: Clock, useClass: SystemClock },
    { provide: Tokenizer, useClass: Es256Tokenizer },
  ],
  exports: [Hasher, Clock, Tokenizer],
})
export class CryptoModule {}
