import { Injectable, Logger } from '@nestjs/common';

import { Mailer, OutboundMessage } from '../../shared/application';
import { AppConfig } from '../config';

/**
 * Writes the message to the structured log instead of sending it.
 *
 * The default adapter on purpose: a clone runs, the dispatcher exercises the
 * whole path, and nothing is delivered to a real address from a developer's
 * machine — which is the accident this replaces. An SMTP or provider adapter
 * is a second class implementing `Mailer` and one line in `MailModule`.
 *
 * It reports itself unconfigured until `MAIL_ENABLED` is set, so an
 * environment that has not chosen a transport records `UNCONFIGURED` rather
 * than a fictional success.
 */
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger(LogMailer.name);

  constructor(private readonly config: AppConfig) {
    super();
  }

  isConfigured(): boolean {
    return this.config.mail.enabled;
  }

  send(message: OutboundMessage): Promise<void> {
    this.logger.log(
      `mail from=${this.config.mail.from} to=${message.to} subject=${JSON.stringify(message.subject)}`,
    );
    return Promise.resolve();
  }
}
