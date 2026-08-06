import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../../../platform/http/decorators/authorize.decorator';
import { CurrentUser } from '../../../../platform/http/decorators/current-user.decorator';
import {
  ApiAuthFailures,
  ApiEnvelope,
  ApiFailure,
  ApiValidationFailure,
} from '../../../../platform/http/swagger';
import type { CurrentUser as Caller } from '../../../../shared/auth-context';
import { Page, PaginationParams } from '../../../../shared/pagination';
import {
  CreateRoleCommand,
  GrantPermissionCommand,
  RevokePermissionCommand,
} from '../../application/commands/rbac.commands';
import { GetRoleQuery, ListRolesQuery } from '../../application/queries/rbac.queries';
import { Role } from '../../domain/role';
import {
  CreateRoleDto,
  GrantPermissionDto,
  ListRbacDto,
  RolePageDto,
  RoleResponseDto,
} from './dto/rbac.dto';

@ApiTags('Roles')
@ApiBearerAuth()
@ApiAuthFailures()
@Controller('rbac/roles')
export class RolesController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @RequirePermissions('rbac:admin')
  @ApiOperation({ summary: 'Create a role' })
  @ApiEnvelope(RoleResponseDto, { status: 201, description: 'Created' })
  @ApiValidationFailure()
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(409, 'ROLE_ALREADY_EXISTS')
  async create(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    const role = await this.commands.execute<CreateRoleCommand, Role>(
      new CreateRoleCommand(dto.name, dto.description ?? ''),
    );
    return RoleResponseDto.from(role);
  }

  @Get()
  @RequirePermissions('rbac:read', 'rbac:admin')
  @ApiOperation({ summary: 'List roles' })
  @ApiEnvelope(RolePageDto, { status: 200, description: 'A page of roles' })
  @ApiFailure(403, 'FORBIDDEN')
  async list(@Query() dto: ListRbacDto): Promise<RolePageDto> {
    const page = await this.queries.execute<ListRolesQuery, Page<Role>>(
      new ListRolesQuery(new PaginationParams(dto.page, dto.limit)),
    );
    return RolePageDto.from(page);
  }

  @Get(':uuid')
  @RequirePermissions('rbac:read', 'rbac:admin')
  @ApiOperation({ summary: 'Get a role and the permissions it grants' })
  @ApiEnvelope(RoleResponseDto, { status: 200 })
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(404, 'ROLE_NOT_FOUND')
  async get(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<RoleResponseDto> {
    const role = await this.queries.execute<GetRoleQuery, Role>(new GetRoleQuery(uuid));
    return RoleResponseDto.from(role);
  }

  @Post(':uuid/permissions')
  @RequirePermissions('rbac:admin')
  @ApiOperation({
    summary: 'Grant a permission to a role',
    description:
      'Idempotent. Every holder of the role gains it as soon as their cached grants are evicted.',
  })
  @ApiEnvelope(RoleResponseDto, { status: 201, description: 'Granted' })
  @ApiValidationFailure()
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(404, 'ROLE_NOT_FOUND')
  @ApiFailure(409, 'ROLE_IS_PROTECTED')
  async grant(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: GrantPermissionDto,
    @CurrentUser() caller: Caller,
  ): Promise<RoleResponseDto> {
    const role = await this.commands.execute<GrantPermissionCommand, Role>(
      new GrantPermissionCommand(uuid, dto.permission, caller.uuid),
    );
    return RoleResponseDto.from(role);
  }

  @Delete(':uuid/permissions/:permission')
  @HttpCode(204)
  @RequirePermissions('rbac:admin')
  @ApiOperation({ summary: 'Revoke a permission from a role', description: 'Idempotent.' })
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(404, 'ROLE_NOT_FOUND')
  @ApiFailure(409, 'ROLE_IS_PROTECTED')
  async revoke(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Param('permission') permission: string,
  ): Promise<void> {
    await this.commands.execute(new RevokePermissionCommand(uuid, permission));
  }
}
