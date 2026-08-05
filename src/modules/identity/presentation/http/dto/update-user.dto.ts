import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';

import { UserStatus } from '../../../domain/user-status';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'ada@example.com', maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ enum: Object.values(UserStatus) })
  @IsOptional()
  @IsIn(Object.values(UserStatus))
  status?: UserStatus;
}
