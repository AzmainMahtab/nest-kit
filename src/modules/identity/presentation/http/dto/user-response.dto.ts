import { ApiProperty } from '@nestjs/swagger';

import { Page } from '../../../../../shared/pagination';
import { User } from '../../../domain/user';
import { UserStatus } from '../../../domain/user-status';

/**
 * The wire contract. Built explicitly rather than by serialising the entity, so
 * adding a field to the domain cannot leak it — passwordHash above all.
 */
export class UserResponseDto {
  @ApiProperty() uuid!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: Object.values(UserStatus) }) status!: UserStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static from(user: User): UserResponseDto {
    return {
      uuid: user.uuid,
      email: user.email.value,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}

export class UserPageDto {
  @ApiProperty({ type: [UserResponseDto] }) items!: UserResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;

  static from(page: Page<User>): UserPageDto {
    return {
      items: page.items.map((user) => UserResponseDto.from(user)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages: page.totalPages,
    };
  }
}
