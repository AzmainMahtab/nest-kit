import { Global, Module } from '@nestjs/common';

import { MessagePublisher } from '../../shared/application';
import { NatsPublisher } from './nats-publisher';

@Global()
@Module({
  providers: [{ provide: MessagePublisher, useClass: NatsPublisher }],
  exports: [MessagePublisher],
})
export class MessagingModule {}
