import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

import { Page } from '../../../../../shared/pagination';
import { Car, CarStatus } from '../../../domain/car';

/** Decimal string, never a number — see AGENTS.md §7. */
const DECIMAL = /^\d{1,10}(\.\d{1,2})?$/;

export class RegisterCarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerUuid!: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @MaxLength(64)
  make!: string;

  @ApiProperty({ example: 'Corolla' })
  @IsString()
  @MaxLength(64)
  model!: string;

  @ApiProperty({ example: 2021 })
  @Type(() => Number)
  @IsInt()
  year!: number;

  @ApiProperty({ example: 'silver' })
  @IsString()
  @MaxLength(32)
  colour!: string;

  @ApiProperty({ example: 'AB-12 CD', description: 'Normalised to uppercase alphanumerics' })
  @IsString()
  @MaxLength(16)
  licensePlate!: string;

  @ApiProperty({ example: '18500.00', description: 'Decimal string, never a float' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount must be a decimal string with at most two places' })
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a three-letter ISO 4217 code' })
  currency!: string;
}

export class TransferCarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toOwnerUuid!: string;
}

export class RepriceCarDto {
  @ApiProperty({ example: '17250.50' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount must be a decimal string with at most two places' })
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a three-letter ISO 4217 code' })
  currency!: string;
}

export class RetireCarDto {
  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

export class ListCarsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerUuid?: string;

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

export class CarResponseDto {
  @ApiProperty() uuid!: string;
  @ApiProperty() ownerUuid!: string;
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty() colour!: string;
  @ApiProperty() licensePlate!: string;
  @ApiProperty({ example: '18500.00' }) amount!: string;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ enum: Object.values(CarStatus) }) status!: CarStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static from(car: Car): CarResponseDto {
    return {
      uuid: car.uuid,
      ownerUuid: car.ownerUuid,
      make: car.make,
      model: car.model,
      year: car.year,
      colour: car.colour,
      licensePlate: car.licensePlate.value,
      amount: car.price.amount,
      currency: car.price.currency,
      status: car.status,
      createdAt: car.createdAt.toISOString(),
      updatedAt: car.updatedAt.toISOString(),
    };
  }
}

export class CarPageDto {
  @ApiProperty({ type: [CarResponseDto] }) items!: CarResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;

  static from(page: Page<Car>): CarPageDto {
    return {
      items: page.items.map((car) => CarResponseDto.from(car)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages: page.totalPages,
    };
  }
}
