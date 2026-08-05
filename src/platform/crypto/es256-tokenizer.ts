import { readFile } from 'node:fs/promises';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { CryptoKey, JWTPayload, SignJWT, importPKCS8, importSPKI, jwtVerify } from 'jose';
import { uuidv7 } from 'uuidv7';

import { AppError } from '../../shared/errors';
import { IssuedToken, TokenClaims, TokenType, Tokenizer } from '../../shared/application';
import { AppConfig } from '../config';

const ALGORITHM = 'ES256';

/**
 * ES256 (ECDSA P-256), never HS256.
 *
 * A shared secret means every service that can verify a token can also mint
 * one. With a keypair the public key ships freely — to another service, to a
 * gateway — without granting the ability to forge. That is the prerequisite for
 * the extraction path (AGENTS.md §6, §13).
 */
@Injectable()
export class Es256Tokenizer extends Tokenizer implements OnModuleInit {
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;

  constructor(private readonly config: AppConfig) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const [privatePem, publicPem] = await Promise.all([
      readFile(this.config.jwt.privateKeyPath, 'utf8'),
      readFile(this.config.jwt.publicKeyPath, 'utf8'),
    ]);

    this.privateKey = await importPKCS8(privatePem, ALGORITHM);
    this.publicKey = await importSPKI(publicPem, ALGORITHM);
  }

  issueAccess(sub: string, sid: string): Promise<IssuedToken> {
    return this.issue(sub, sid, 'access', this.config.jwt.accessTtlSeconds);
  }

  issueRefresh(sub: string, sid: string): Promise<IssuedToken> {
    return this.issue(sub, sid, 'refresh', this.config.jwt.refreshTtlSeconds);
  }

  parseAccess(token: string): Promise<TokenClaims> {
    return this.parse(token, 'access');
  }

  parseRefresh(token: string): Promise<TokenClaims> {
    return this.parse(token, 'refresh');
  }

  private async issue(
    sub: string,
    sid: string,
    typ: TokenType,
    ttlSeconds: number,
  ): Promise<IssuedToken> {
    const jti = uuidv7();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + ttlSeconds;

    const token = await new SignJWT({ sid, typ })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(sub)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.privateKey);

    return { token, jti, expiresAt: new Date(expiresAt * 1000) };
  }

  private async parse(token: string, expected: TokenType): Promise<TokenClaims> {
    let payload: JWTPayload;

    try {
      // The algorithm allowlist is explicit. Without it a token could arrive
      // signed with `none`, or with HMAC over the public key.
      const verified = await jwtVerify(token, this.publicKey, { algorithms: [ALGORITHM] });
      payload = verified.payload;
    } catch {
      throw AppError.unauthorized('INVALID_TOKEN', 'token is invalid or expired');
    }

    const { sub, jti, sid, typ, exp } = payload as Partial<TokenClaims>;

    if (!sub || !jti || !sid || !exp) {
      throw AppError.unauthorized('INVALID_TOKEN', 'token is missing required claims');
    }

    // Both types are signed by the same key, so only this claim separates them.
    // Without the check a long-lived refresh token would authenticate every
    // request for its entire lifetime.
    if (typ !== expected) {
      throw AppError.unauthorized('WRONG_TOKEN_TYPE', `expected a ${expected} token`);
    }

    return { sub, jti, sid, typ, exp };
  }
}
