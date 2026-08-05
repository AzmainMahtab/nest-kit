import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Page, PaginationParams } from '../../../../shared/pagination';
import { RegisterOwnerCommand } from '../../application/commands/register-owner.command';
import {
  DeactivateOwnerCommand,
  UpdateOwnerAddressCommand,
} from '../../application/commands/update-owner.command';
import { GetOwnerQuery, ListOwnersQuery } from '../../application/queries/owner.queries';
import { Owner } from '../../domain/owner';
import {
  DeactivateOwnerDto,
  ListOwnersDto,
  OwnerPageDto,
  OwnerResponseDto,
  RegisterOwnerDto,
  UpdateOwnerAddressDto,
} from './dto/owner.dto';

@ApiTags('Owners')
@ApiBearerAuth()
@Controller('owners')
export class OwnersController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a user as a car owner' })
  @ApiResponse({ status: 201, type: OwnerResponseDto })
  @ApiResponse({ status: 409, description: 'OWNER_ALREADY_REGISTERED' })
  async register(@Body() dto: RegisterOwnerDto): Promise<OwnerResponseDto> {
    const owner = await this.commands.execute<RegisterOwnerCommand, Owner>(
      new RegisterOwnerCommand(dto.userUuid, dto.address, dto.dateOfBirth),
    );
    return OwnerResponseDto.from(owner);
  }

  @Get()
  @ApiOperation({ summary: 'List owners' })
  @ApiResponse({ status: 200, type: OwnerPageDto })
  async list(@Query() dto: ListOwnersDto): Promise<OwnerPageDto> {
    const page = await this.queries.execute<ListOwnersQuery, Page<Owner>>(
      new ListOwnersQuery(new PaginationParams(dto.page, dto.limit)),
    );
    return OwnerPageDto.from(page);
  }

  @Get(':uuid')
  @ApiOperation({ summary: 'Get an owner' })
  @ApiResponse({ status: 200, type: OwnerResponseDto })
  @ApiResponse({ status: 404, description: 'OWNER_NOT_FOUND' })
  async get(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<OwnerResponseDto> {
    const owner = await this.queries.execute<GetOwnerQuery, Owner>(new GetOwnerQuery(uuid));
    return OwnerResponseDto.from(owner);
  }

  @Patch(':uuid/address')
  @ApiOperation({ summary: 'Change an owner address' })
  @ApiResponse({ status: 200, type: OwnerResponseDto })
  @ApiResponse({ status: 409, description: 'OWNER_INACTIVE' })
  async changeAddress(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateOwnerAddressDto,
  ): Promise<OwnerResponseDto> {
    const owner = await this.commands.execute<UpdateOwnerAddressCommand, Owner>(
      new UpdateOwnerAddressCommand(uuid, dto.address),
    );
    return OwnerResponseDto.from(owner);
  }

  @Patch(':uuid/deactivate')
  @ApiOperation({ summary: 'Deactivate an owner; the car context retires their cars' })
  @ApiResponse({ status: 200, type: OwnerResponseDto })
  async deactivate(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: DeactivateOwnerDto,
  ): Promise<OwnerResponseDto> {
    const owner = await this.commands.execute<DeactivateOwnerCommand, Owner>(
      new DeactivateOwnerCommand(uuid, dto.reason ?? 'deactivated by an operator'),
    );
    return OwnerResponseDto.from(owner);
  }
}
