import { Owner, OwnerStatus, isOwnerStatus } from '../../domain/owner';
import { DateOfBirth } from '../../domain/value-objects/date-of-birth';
import { OwnerOrmEntity } from './owner.orm-entity';

export const OwnerMapper = {
  toDomain(row: OwnerOrmEntity): Owner {
    return Owner.fromSnapshot({
      uuid: row.uuid,
      userUuid: row.userUuid,
      address: row.address,
      // Rehydration, not construction: a row written before the age rule
      // existed must still load rather than throw on every read.
      dateOfBirth: DateOfBirth.fromPersistence(new Date(row.dateOfBirth)),
      status: isOwnerStatus(row.status) ? row.status : OwnerStatus.Inactive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toOrm(owner: Owner, internalId?: string): OwnerOrmEntity {
    const row = new OwnerOrmEntity();

    if (internalId !== undefined) {
      row.id = internalId;
    }

    row.uuid = owner.uuid;
    row.userUuid = owner.userUuid;
    row.address = owner.address;
    // A `date` column round-trips as a string; keeping it that way avoids a
    // timezone shift turning a birthday into the previous day.
    row.dateOfBirth = owner.dateOfBirth.toISODate();
    row.status = owner.status;
    row.createdAt = owner.createdAt;
    row.updatedAt = owner.updatedAt;

    return row;
  },
};
