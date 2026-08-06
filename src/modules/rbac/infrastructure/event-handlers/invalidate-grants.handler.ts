import { Injectable } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import {
  RoleAssignedToUser,
  RolePermissionGranted,
  RolePermissionRevoked,
  RoleUnassignedFromUser,
} from '../../domain/events';
import { RbacRepository } from '../../domain/ports/rbac-repository.port';
import { RedisAccessControl } from '../cache/redis-access-control';

/**
 * In-process, not durable: the cache is Redis, so one replica evicting a key
 * evicts it for all of them, and the work is a single DEL that is worthless if
 * it arrives late. A `DurableEventHandler` would add at-least-once machinery to
 * an operation whose only failure mode is already bounded by the TTL
 * (AGENTS.md §7).
 *
 * The UnitOfWork dispatches these only after the transaction commits, so a
 * rolled-back grant never evicts a still-valid entry.
 */
@Injectable()
@EventsHandler(RoleAssignedToUser, RoleUnassignedFromUser)
export class InvalidateGrantsOnAssignment implements IEventHandler<
  RoleAssignedToUser | RoleUnassignedFromUser
> {
  constructor(private readonly cache: RedisAccessControl) {}

  async handle(event: RoleAssignedToUser | RoleUnassignedFromUser): Promise<void> {
    await this.cache.invalidate([event.userUuid]);
  }
}

/**
 * A role's permissions changing invalidates every holder of that role, so the
 * role is expanded to its users here rather than carried in the event — a role
 * may be held by more users than belong in an event payload.
 */
@Injectable()
@EventsHandler(RolePermissionGranted, RolePermissionRevoked)
export class InvalidateGrantsOnRoleChange implements IEventHandler<
  RolePermissionGranted | RolePermissionRevoked
> {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly cache: RedisAccessControl,
  ) {}

  async handle(event: RolePermissionGranted | RolePermissionRevoked): Promise<void> {
    await this.cache.invalidate(await this.rbac.findUserUuidsForRole(event.roleUuid));
  }
}
