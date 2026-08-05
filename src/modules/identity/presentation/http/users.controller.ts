import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../platform/http/decorators/public.decorator';
import {
  ApiAuthFailures,
  ApiEnvelope,
  ApiFailure,
  ApiValidationFailure,
} from '../../../../platform/http/swagger';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { DeleteUserCommand } from '../../application/commands/delete-user.command';
import { RegisterUserCommand } from '../../application/commands/register-user.command';
import { UpdateUserCommand } from '../../application/commands/update-user.command';
import { GetUserQuery } from '../../application/queries/get-user.query';
import { ListUsersQuery } from '../../application/queries/list-users.query';
import { User } from '../../domain/user';
import { ListUsersDto } from './dto/list-users.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPageDto, UserResponseDto } from './dto/user-response.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Register a user' })
  @ApiEnvelope(UserResponseDto, { status: 201, description: 'Registered' })
  @ApiValidationFailure()
  @ApiFailure(409, 'EMAIL_ALREADY_REGISTERED')
  async register(@Body() dto: RegisterUserDto): Promise<UserResponseDto> {
    const user = await this.commands.execute<RegisterUserCommand, User>(
      new RegisterUserCommand(dto.email, dto.password),
    );
    return UserResponseDto.from(user);
  }

  @Get()
  @ApiBearerAuth()
  @ApiAuthFailures()
  @ApiOperation({ summary: 'List users' })
  @ApiEnvelope(UserPageDto, { status: 200, description: 'A page of users' })
  async list(@Query() dto: ListUsersDto): Promise<UserPageDto> {
    const page = await this.queries.execute<ListUsersQuery, Page<User>>(
      new ListUsersQuery(new PaginationParams(dto.page, dto.limit)),
    );
    return UserPageDto.from(page);
  }

  @Get(':uuid')
  @ApiBearerAuth()
  @ApiAuthFailures()
  @ApiOperation({ summary: 'Get a user' })
  @ApiEnvelope(UserResponseDto, { status: 200 })
  @ApiFailure(404, 'USER_NOT_FOUND')
  async get(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<UserResponseDto> {
    const user = await this.queries.execute<GetUserQuery, User>(new GetUserQuery(uuid));
    return UserResponseDto.from(user);
  }

  @Patch(':uuid')
  @ApiBearerAuth()
  @ApiAuthFailures()
  @ApiOperation({ summary: 'Update a user' })
  @ApiEnvelope(UserResponseDto, { status: 200 })
  @ApiValidationFailure()
  @ApiFailure(404, 'USER_NOT_FOUND')
  async update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.commands.execute<UpdateUserCommand, User>(
      new UpdateUserCommand(uuid, dto.email, dto.status),
    );
    return UserResponseDto.from(user);
  }

  @Delete(':uuid')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiAuthFailures()
  @ApiOperation({ summary: 'Soft-delete a user' })
  @ApiResponse({ status: 204, description: 'Deleted; no body' })
  @ApiFailure(404, 'USER_NOT_FOUND')
  async remove(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<void> {
    await this.commands.execute(new DeleteUserCommand(uuid));
  }
}
