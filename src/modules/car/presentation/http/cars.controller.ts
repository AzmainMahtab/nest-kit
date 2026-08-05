import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Page, PaginationParams } from '../../../../shared/pagination';
import {
  RegisterCarCommand,
  RepriceCarCommand,
  RetireCarCommand,
  TransferCarCommand,
} from '../../application/commands/car.commands';
import { GetCarQuery, ListCarsQuery } from '../../application/queries/car.queries';
import { Car } from '../../domain/car';
import {
  CarPageDto,
  CarResponseDto,
  ListCarsDto,
  RegisterCarDto,
  RepriceCarDto,
  RetireCarDto,
  TransferCarDto,
} from './dto/car.dto';

@ApiTags('Cars')
@ApiBearerAuth()
@Controller('cars')
export class CarsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a car to an active owner' })
  @ApiResponse({ status: 201, type: CarResponseDto })
  @ApiResponse({ status: 409, description: 'PLATE_ALREADY_REGISTERED' })
  @ApiResponse({ status: 400, description: 'OWNER_NOT_ACCEPTING_CARS' })
  async register(@Body() dto: RegisterCarDto): Promise<CarResponseDto> {
    const car = await this.commands.execute<RegisterCarCommand, Car>(
      new RegisterCarCommand(
        dto.ownerUuid,
        dto.make,
        dto.model,
        dto.year,
        dto.colour,
        dto.licensePlate,
        dto.amount,
        dto.currency,
      ),
    );
    return CarResponseDto.from(car);
  }

  @Get()
  @ApiOperation({ summary: 'List cars, optionally filtered by owner' })
  @ApiResponse({ status: 200, type: CarPageDto })
  async list(@Query() dto: ListCarsDto): Promise<CarPageDto> {
    const page = await this.queries.execute<ListCarsQuery, Page<Car>>(
      new ListCarsQuery(new PaginationParams(dto.page, dto.limit), dto.ownerUuid),
    );
    return CarPageDto.from(page);
  }

  @Get(':uuid')
  @ApiOperation({ summary: 'Get a car' })
  @ApiResponse({ status: 200, type: CarResponseDto })
  @ApiResponse({ status: 404, description: 'CAR_NOT_FOUND' })
  async get(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<CarResponseDto> {
    const car = await this.queries.execute<GetCarQuery, Car>(new GetCarQuery(uuid));
    return CarResponseDto.from(car);
  }

  @Patch(':uuid/transfer')
  @ApiOperation({ summary: 'Transfer a car to another active owner' })
  @ApiResponse({ status: 200, type: CarResponseDto })
  @ApiResponse({ status: 409, description: 'CAR_RETIRED' })
  async transfer(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: TransferCarDto,
  ): Promise<CarResponseDto> {
    const car = await this.commands.execute<TransferCarCommand, Car>(
      new TransferCarCommand(uuid, dto.toOwnerUuid),
    );
    return CarResponseDto.from(car);
  }

  @Patch(':uuid/price')
  @ApiOperation({ summary: 'Reprice a car' })
  @ApiResponse({ status: 200, type: CarResponseDto })
  async reprice(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: RepriceCarDto,
  ): Promise<CarResponseDto> {
    const car = await this.commands.execute<RepriceCarCommand, Car>(
      new RepriceCarCommand(uuid, dto.amount, dto.currency),
    );
    return CarResponseDto.from(car);
  }

  @Patch(':uuid/retire')
  @ApiOperation({ summary: 'Retire a car' })
  @ApiResponse({ status: 200, type: CarResponseDto })
  async retire(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: RetireCarDto,
  ): Promise<CarResponseDto> {
    const car = await this.commands.execute<RetireCarCommand, Car>(
      new RetireCarCommand(uuid, dto.reason ?? 'retired by an operator'),
    );
    return CarResponseDto.from(car);
  }
}
