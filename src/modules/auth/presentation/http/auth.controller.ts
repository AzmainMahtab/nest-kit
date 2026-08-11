import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../../platform/http/decorators/current-user.decorator';
import { ApiEnvelope, ApiFailure, ApiValidationFailure } from '../../../../platform/http/swagger';
import { Public } from '../../../../platform/http/decorators/public.decorator';
import { AuthRateLimit } from '../../../../platform/http/decorators/rate-limit.decorator';
import type { CurrentUser as CurrentUserType } from '../../../../shared/auth-context';
import { LoginCommand, TokenPair } from '../../application/commands/login.command';
import { LogoutCommand } from '../../application/commands/logout.command';
import { RefreshTokenCommand } from '../../application/commands/refresh-token.command';
import { LoginDto, RefreshDto, TokenPairDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly commands: CommandBus) {}

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  @ApiEnvelope(TokenPairDto, { status: 200, description: 'A fresh token pair' })
  @ApiValidationFailure()
  @ApiFailure(429, 'RATE_LIMITED', 'Tighter budget than the rest of the API')
  @ApiFailure(
    401,
    'INVALID_CREDENTIALS',
    'Deliberately identical for an unknown address and a wrong password',
  )
  @ApiFailure(403, 'ACCOUNT_SUSPENDED')
  async login(@Body() dto: LoginDto): Promise<TokenPairDto> {
    const pair = await this.commands.execute<LoginCommand, TokenPair>(
      new LoginCommand(dto.email, dto.password),
    );
    return toDto(pair);
  }

  @Public()
  @AuthRateLimit()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a refresh token for a new pair' })
  @ApiEnvelope(TokenPairDto, { status: 200, description: 'A rotated token pair' })
  @ApiFailure(429, 'RATE_LIMITED', 'Tighter budget than the rest of the API')
  @ApiFailure(
    401,
    'REFRESH_TOKEN_REPLAYED',
    'A superseded token was presented; the whole session is revoked',
  )
  async refresh(@Body() dto: RefreshDto): Promise<TokenPairDto> {
    const pair = await this.commands.execute<RefreshTokenCommand, TokenPair>(
      new RefreshTokenCommand(dto.refreshToken),
    );
    return toDto(pair);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session and access token' })
  @ApiResponse({ status: 204, description: 'Logged out; no body' })
  @ApiFailure(401, 'MISSING_TOKEN')
  async logout(@CurrentUser() user: CurrentUserType): Promise<void> {
    // The token's own `exp` bounds the blacklist entry, so an entry can never
    // outlive the token it revokes.
    await this.commands.execute(new LogoutCommand(user.sessionUuid, user.jti, user.expiresAt));
  }
}

function toDto(pair: TokenPair): TokenPairDto {
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresAt: pair.expiresAt.toISOString(),
  };
}
