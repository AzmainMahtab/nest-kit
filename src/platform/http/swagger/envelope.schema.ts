import { ApiProperty } from '@nestjs/swagger';

/**
 * Documentation-only mirrors of what `ResponseEnvelopeInterceptor` and
 * `AppErrorFilter` actually put on the wire.
 *
 * Without these the spec describes the *inner* DTO, because that is what the
 * controller returns — and a generated client would then unwrap nothing and
 * break on every call.
 */
export class SuccessEnvelopeDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ description: 'The payload. Replaced by the concrete type per route.' })
  data!: unknown;
}

export class ErrorItemDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'isEmail' })
  code!: string;

  @ApiProperty({ example: 'email must be an email' })
  message!: string;
}

export class ErrorDetailDto {
  @ApiProperty({ example: 'USER_NOT_FOUND', description: 'Machine-readable. Match on this.' })
  code!: string;

  @ApiProperty({ example: 'user not found', description: 'Safe to show a client.' })
  message!: string;

  @ApiProperty({ type: [ErrorItemDto], description: 'Field-level detail; empty unless relevant.' })
  details!: ErrorItemDto[];
}

export class ErrorEnvelopeDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ErrorDetailDto })
  error!: ErrorDetailDto;

  @ApiProperty({ example: '/api/users/019fd1…' })
  path!: string;

  @ApiProperty({ example: '2026-08-05T12:25:13.333Z' })
  timestamp!: string;
}
