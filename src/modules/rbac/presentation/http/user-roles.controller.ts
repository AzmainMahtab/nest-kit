import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../../../platform/http/decorators/authorize.decorator';
import { CurrentUser } from '../../../../platform/http/decorators/current-user.decorator';
import {
  ApiAuthFailures,
  ApiEnvelope,
  ApiEnvelopeArray,
  ApiFailure,
  ApiValidationFailure,
} from '../../../../platform/http/swagger';
import { Grants } from '../../../../shared/application';
import type { CurrentUser as Caller } from '../../../../shared/auth-context';
import { AssignRoleCommand, UnassignRoleCommand } from '../../application/commands/rbac.commands';
import {
  GetUserAssignmentsQuery,
  GetUserGrantsQuery,
} from '../../application/queries/rbac.queries';
import { RoleAssignment } from '../../domain/role-assignment';
import { AssignRoleDto, GrantsResponseDto, RoleAssignmentResponseDto } from './dto/rbac.dto';

@ApiTags('Role assignments')
@ApiBearerAuth()
@ApiAuthFailures()
@Controller('rbac')
export class UserRolesController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  /**
   * Needs no permission: the caller is asking about themselves, and a client
   * that cannot discover its own grants has to guess which UI to render.
   */
  @Get('me/grants')
  @ApiOperation({ summary: "The caller's own roles and effective permissions" })
  @ApiEnvelope(GrantsResponseDto, { status: 200 })
  async myGrants(@CurrentUser() caller: Caller): Promise<GrantsResponseDto> {
    const grants = await this.queries.execute<GetUserGrantsQuery, Grants>(
      new GetUserGrantsQuery(caller.uuid),
    );
    return GrantsResponseDto.from(grants);
  }

  @Get('users/:userUuid/roles')
  @RequirePermissions('rbac:read', 'rbac:admin')
  @ApiOperation({ summary: "A user's role assignments, with who granted each one" })
  @ApiEnvelopeArray(RoleAssignmentResponseDto, { status: 200 })
  @ApiFailure(403, 'FORBIDDEN')
  async assignments(
    @Param('userUuid', ParseUUIDPipe) userUuid: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    const assignments = await this.queries.execute<GetUserAssignmentsQuery, RoleAssignment[]>(
      new GetUserAssignmentsQuery(userUuid),
    );
    return assignments.map((assignment) => RoleAssignmentResponseDto.from(assignment));
  }

  @Get('users/:userUuid/grants')
  @RequirePermissions('rbac:read', 'rbac:admin')
  @ApiOperation({ summary: "A user's effective permissions, resolved through their roles" })
  @ApiEnvelope(GrantsResponseDto, { status: 200 })
  @ApiFailure(403, 'FORBIDDEN')
  async grants(@Param('userUuid', ParseUUIDPipe) userUuid: string): Promise<GrantsResponseDto> {
    const grants = await this.queries.execute<GetUserGrantsQuery, Grants>(
      new GetUserGrantsQuery(userUuid),
    );
    return GrantsResponseDto.from(grants);
  }

  @Post('users/:userUuid/roles')
  @HttpCode(204)
  @RequirePermissions('rbac:admin')
  @ApiOperation({ summary: 'Assign a role to a user', description: 'Idempotent.' })
  @ApiValidationFailure()
  @ApiFailure(400, 'USER_NOT_FOUND')
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(404, 'ROLE_NOT_FOUND')
  async assign(
    @Param('userUuid', ParseUUIDPipe) userUuid: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() caller: Caller,
  ): Promise<void> {
    await this.commands.execute(new AssignRoleCommand(userUuid, dto.roleUuid, caller.uuid));
  }

  @Delete('users/:userUuid/roles/:roleUuid')
  @HttpCode(204)
  @RequirePermissions('rbac:admin')
  @ApiOperation({ summary: 'Take a role away from a user', description: 'Idempotent.' })
  @ApiFailure(403, 'FORBIDDEN')
  @ApiFailure(404, 'ROLE_NOT_FOUND')
  async unassign(
    @Param('userUuid', ParseUUIDPipe) userUuid: string,
    @Param('roleUuid', ParseUUIDPipe) roleUuid: string,
  ): Promise<void> {
    await this.commands.execute(new UnassignRoleCommand(userUuid, roleUuid));
  }
}
