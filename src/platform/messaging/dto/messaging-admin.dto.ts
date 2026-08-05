import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ReplayOutboxDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Outbox row ids. Omit to replay every dead-lettered row.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @Matches(/^\d+$/, { each: true, message: 'each id must be a numeric outbox row id' })
  ids?: string[];
}

export class DiscardDeadLetterDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  consumerName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;
}
