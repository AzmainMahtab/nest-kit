import { uuidv7 } from 'uuidv7';

import { DomainEvent } from '../../../shared/domain';
import { PermissionCreated } from './events';
import { PermissionName } from './value-objects/permission-name';

export interface PermissionSnapshot {
  uuid: string;
  name: PermissionName;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A single granular capability. Permissions are the stable vocabulary the code
 * is written against — a route names a permission, never a role, so that
 * reorganising roles never means editing a controller.
 */
export class Permission {
  private readonly events: DomainEvent[] = [];

  private constructor(
    readonly uuid: string,
    readonly name: PermissionName,
    private _description: string,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(name: PermissionName, description: string, now: Date): Permission {
    const permission = new Permission(uuidv7(), name, description, now, now);
    permission.record(new PermissionCreated(permission.uuid, name.value));
    return permission;
  }

  /** Rehydration from persistence. Records no events. */
  static fromSnapshot(snapshot: PermissionSnapshot): Permission {
    return new Permission(
      snapshot.uuid,
      snapshot.name,
      snapshot.description,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get description(): string {
    return this._description;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  describe(description: string, now: Date): void {
    if (this._description === description) {
      return;
    }

    this._description = description;
    this._updatedAt = now;
  }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
