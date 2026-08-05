import { Global, Module } from '@nestjs/common';

import { OutboxRelay } from './outbox.relay';
import { OutboxRepository } from './outbox.repository';

@Global()
@Module({
  providers: [OutboxRepository, OutboxRelay],
  exports: [OutboxRepository, OutboxRelay],
})
export class OutboxModule {}
