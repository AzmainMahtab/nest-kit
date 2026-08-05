import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

import { Page } from '../../../../../shared/pagination';
import { Owner, OwnerStatus } from '../../../domain/owner';

export class RegisterOwnerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userUuid!: string;

  @ApiProperty({ maxLength: 512 })
  @IsString()
  @MaxLength(512)
  address!: string;

  @ApiProperty({ example: '1990-04-12', description: 'ISO date; owner must be 18 or older' })
  @IsISO8601()
  dateOfBirth!: string;
}

export class UpdateOwnerAddressDto {
  @ApiProperty({ maxLength: 512 })
  @IsString()
  @MaxLength(512)
  address!: string;
}

export class DeactivateOwnerDto {
  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

export class ListOwnersDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class OwnerResponseDto {
  @ApiProperty() uuid!: string;
  @ApiProperty() userUuid!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ example: '1990-04-12' }) dateOfBirth!: string;
  @ApiProperty({ enum: Object.values(OwnerStatus) }) status!: OwnerStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static from(owner: Owner): OwnerResponseDto {
    return {
      uuid: owner.uuid,
      userUuid: owner.userUuid,
      address: owner.address,
      dateOfBirth: owner.dateOfBirth.toISODate(),
      status: owner.status,
      createdAt: owner.createdAt.toISOString(),
      updatedAt: owner.updatedAt.toISOString(),
    };
  }
}

export class OwnerPageDto {
  @ApiProperty({ type: [OwnerResponseDto] }) items!: OwnerResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;

  static from(page: Page<Owner>): OwnerPageDto {
    return {
      items: page.items.map((owner) => OwnerResponseDto.from(owner)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages: page.totalPages,
    };
  }
}
