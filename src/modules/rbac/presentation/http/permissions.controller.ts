import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../../../platform/http/decorators/authorize.decorator';
import {
  ApiAuthFailures,
  ApiEnvelope,
  ApiFailure,
  ApiValidationFailure,
} from '../../../../platform/http/swagger';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { CreatePermissionCommand } from '../../application/commands/rbac.commands';
import { ListPermissionsQuery } from '../../application/queries/rbac.queries';
import { Permission } from '../../domain/permission';
import {
  CreatePermissionDto,
  ListRbacDto,
  PermissionPageDto,
  PermissionResponseDto,
} from './dto/rbac.dto';

@ApiTags('Permissions')
@ApiBearerAuth()
@ApiAuthFailures()
@Controller('rbac/permissions')
export class PermissionsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @RequirePermissions('rbac:admin')
  @ApiOperation({
    summary: 'Add a permission to the catalogue',
    description:
      'Creating a permission grants nothing on its own — a route has to require it and a role has to hold it.',
  })
  @ApiEnvelope(PermissionResponseDto, { status: 201, description: 'Created' })
  @ApiValidationFailure()
  @ApiFailure(400, 'INVALID_PERMISSION_NAME')
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(409, 'PERMISSION_ALREADY_EXISTS')
  async create(@Body() dto: CreatePermissionDto): Promise<PermissionResponseDto> {
    const permission = await this.commands.execute<CreatePermissionCommand, Permission>(
      new CreatePermissionCommand(dto.name, dto.description ?? ''),
    );
    return PermissionResponseDto.from(permission);
  }

  @Get()
  @RequirePermissions('rbac:read', 'rbac:admin')
  @ApiOperation({ summary: 'List the permission catalogue' })
  @ApiEnvelope(PermissionPageDto, { status: 200, description: 'A page of permissions' })
  @ApiFailure(403, 'FORBIDDEN')
  async list(@Query() dto: ListRbacDto): Promise<PermissionPageDto> {
    const page = await this.queries.execute<ListPermissionsQuery, Page<Permission>>(
      new ListPermissionsQuery(new PaginationParams(dto.page, dto.limit)),
    );
    return PermissionPageDto.from(page);
  }
}
