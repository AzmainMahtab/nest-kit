import { Injectable, Logger } from '@nestjs/common';

import { Clock, Mailer } from '../../../shared/application';
import { AppConfig } from '../../../platform/config';
import { ScheduledTask } from '../../../platform/scheduling/scheduled-task';
import { Notification } from '../domain/notification';
import { NotificationRepository } from '../domain/ports/notification-repository.port';

/**
 * Sweeps queued notifications and tries to deliver them.
 *
 * It is a `ScheduledTask`, so exactly one replica sweeps per tick and the
 * others do nothing — without that, three replicas would send three copies of
 * the same welcome mail, which is the defect a queue in a table invites.
 */
@Injectable()
export class NotificationDispatcher extends ScheduledTask {
  readonly name = 'notification-dispatch';
  readonly intervalMs: number;

  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {
    super();
    this.intervalMs = this.config.notifications.intervalMs;
  }

  async run(): Promise<void> {
    const batch = await this.notifications.listQueued(this.config.notifications.batch);

    for (const notification of batch) {
      await this.deliver(notification);
    }
  }

  private async deliver(notification: Notification): Promise<void> {
    const { maxAttempts } = this.config.notifications;

    if (!this.mailer.isConfigured()) {
      // Not a failure and not an attempt: nothing was refused, because nothing
      // was tried. Recording it as failed would send someone hunting for an
      // outage that is really a missing credential.
      notification.markUnconfigured(this.clock.now());
      await this.notifications.save(notification);
      return;
    }

    if (notification.channel !== 'email') {
      notification.markFailed(`unsupported channel '${notification.channel}'`, 0, this.clock.now());
      await this.notifications.save(notification);
      return;
    }

    // Written before the send, so a crash mid-send still leaves a row saying
    // an attempt was made — see Notification.beginAttempt.
    notification.beginAttempt(this.clock.now());
    await this.notifications.save(notification);

    try {
      await this.mailer.send({
        to: notification.recipientAddress,
        subject: notification.subject,
        body: notification.body,
      });
      notification.markSent(this.clock.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.markFailed(message, maxAttempts, this.clock.now());
      this.logger.warn(
        `delivery of ${notification.uuid} failed on attempt ${notification.attempts}: ${message}`,
      );
    }

    await this.notifications.save(notification);
  }
}
