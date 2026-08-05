import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

import { Hasher } from '../../shared/application';

/**
 * Argon2id, matching fast-kit and go-kit. Parameters follow the OWASP baseline
 * (19 MiB, 2 iterations, parallelism 1); `@node-rs/argon2` ships prebuilt
 * binaries including musl, so the alpine image needs no build toolchain.
 */
@Injectable()
export class Argon2Hasher extends Hasher {
  private readonly options = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, this.options);
  }

  async verify(hashed: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(hashed, plaintext, this.options);
    } catch {
      // A malformed or truncated stored hash must be indistinguishable from a
      // wrong password, so it cannot be probed as an oracle.
      return false;
    }
  }
}
