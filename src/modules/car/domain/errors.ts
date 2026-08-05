import { AppError } from '../../../shared/errors';

export const CarNotFound = (): AppError => AppError.notFound('CAR_NOT_FOUND', 'car not found');

export const PlateAlreadyRegistered = (): AppError =>
  AppError.conflict('PLATE_ALREADY_REGISTERED', 'that plate is already registered').withField(
    'licensePlate',
    'already registered',
  );

export const CarRetiredError = (): AppError =>
  AppError.conflict('CAR_RETIRED', 'a retired car cannot be modified');

export const SameOwnerTransfer = (): AppError =>
  AppError.invalid('SAME_OWNER_TRANSFER', 'the car already belongs to that owner').withField(
    'ownerUuid',
    'is already the owner',
  );

export const OwnerNotAcceptingCars = (): AppError =>
  AppError.invalid('OWNER_NOT_ACCEPTING_CARS', 'owner does not exist or is inactive').withField(
    'ownerUuid',
    'must be an active owner',
  );
