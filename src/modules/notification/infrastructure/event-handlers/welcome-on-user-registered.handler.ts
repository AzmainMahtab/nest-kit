import { Injectable } from '@nestjs/common';

import { Clock } from '../../../../shared/application';
import { DurableEventHandler, EventMessage } from '../../../../platform/messaging';
import { Notification } from '../../domain/notification';
import { NotificationRepository } from '../../domain/ports/notification-repository.port';

/**
 * Reacts to identity's event off the durable stream — not by importing
 * identity. The only coupling is the event name and the shape of its payload,
 * which is what lets either context be extracted without the other noticing.
 */
@Injectable()
export class WelcomeOnUserRegistered extends DurableEventHandler {
  readonly consumerName = 'notification_welcome';
  readonly subjects = ['identity.user.registered'];

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {
    super();
  }

  async handle(event: EventMessage): Promise<void> {
    const { userUuid, email } = event.payload as { userUuid: string; email: string };

    await this.notifications.save(
      Notification.queue(
        userUuid,
        'email',
        'Welcome',
        `Welcome, ${email}. Your account is pending activation.`,
        this.clock.now(),
      ),
    );
  }
}
