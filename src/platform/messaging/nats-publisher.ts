import { Injectable } from '@nestjs/common';

import { MessagePublisher } from '../../shared/application';
import { NatsClient, SUBJECT_PREFIX } from './nats-client';

@Injectable()
export class NatsPublisher extends MessagePublisher {
  constructor(private readonly client: NatsClient) {
    super();
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  async publish(subject: string, payload: Uint8Array, messageId: string): Promise<void> {
    // Resolves only after the server has persisted the message, so the relay
    // never marks a row published on a best-effort send.
    await this.client
      .jetstream()
      .publish(`${SUBJECT_PREFIX}.${subject}`, payload, { msgID: messageId });
  }
}
