import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

import { Grants } from '../../../../../shared/application';
import { Page } from '../../../../../shared/pagination';
import { Permission } from '../../../domain/permission';
import { Role } from '../../../domain/role';
import { RoleAssignment } from '../../../domain/role-assignment';

export class CreatePermissionDto {
  @ApiProperty({ example: 'billing:refund', description: 'lowercase resource:action' })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'support-agent', description: 'lowercase letters, digits and hyphens' })
  @IsString()
  @MaxLength(64)
  name!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class GrantPermissionDto {
  @ApiProperty({ example: 'billing:refund' })
  @IsString()
  @MaxLength(128)
  permission!: string;
}

export class AssignRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleUuid!: string;
}

export class ListRbacDto {
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

export class PermissionResponseDto {
  @ApiProperty() uuid!: string;
  @ApiProperty({ example: 'billing:refund' }) name!: string;
  @ApiProperty({ example: 'billing' }) resource!: string;
  @ApiProperty({ example: 'refund' }) action!: string;
  @ApiProperty() description!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static from(permission: Permission): PermissionResponseDto {
    return {
      uuid: permission.uuid,
      name: permission.name.value,
      resource: permission.name.resource,
      action: permission.name.action,
      description: permission.description,
      createdAt: permission.createdAt.toISOString(),
      updatedAt: permission.updatedAt.toISOString(),
    };
  }
}

export class PermissionPageDto {
  @ApiProperty({ type: [PermissionResponseDto] }) items!: PermissionResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;

  static from(page: Page<Permission>): PermissionPageDto {
    return {
      items: page.items.map((permission) => PermissionResponseDto.from(permission)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages: page.totalPages,
    };
  }
}

export class RoleResponseDto {
  @ApiProperty() uuid!: string;
  @ApiProperty({ example: 'support-agent' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ description: 'A protected role cannot have its permissions changed' })
  isProtected!: boolean;
  @ApiProperty({ type: [String], example: ['rbac:read'] }) permissions!: string[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static from(role: Role): RoleResponseDto {
    return {
      uuid: role.uuid,
      name: role.name.value,
      description: role.description,
      isProtected: role.isProtected,
      permissions: [...role.permissionNames],
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}

export class RolePageDto {
  @ApiProperty({ type: [RoleResponseDto] }) items!: RoleResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;

  static from(page: Page<Role>): RolePageDto {
    return {
      items: page.items.map((role) => RoleResponseDto.from(role)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages: page.totalPages,
    };
  }
}

export class RoleAssignmentResponseDto {
  @ApiProperty({ type: RoleResponseDto }) role!: RoleResponseDto;
  @ApiProperty({ nullable: true, description: 'The administrator who granted it' })
  assignedBy!: string | null;
  @ApiProperty() assignedAt!: string;

  static from(assignment: RoleAssignment): RoleAssignmentResponseDto {
    return {
      role: RoleResponseDto.from(assignment.role),
      assignedBy: assignment.assignedBy,
      assignedAt: assignment.assignedAt.toISOString(),
    };
  }
}

/** The flattened view the guard decides on, for a client that wants to hide UI it cannot use. */
export class GrantsResponseDto {
  @ApiProperty({ type: [String], example: ['admin'] }) roles!: string[];
  @ApiProperty({ type: [String], example: ['rbac:admin'] }) permissions!: string[];

  static from(grants: Grants): GrantsResponseDto {
    return { roles: [...grants.roles], permissions: [...grants.permissions] };
  }
}
