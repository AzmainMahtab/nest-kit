import { Module } from '@nestjs/common';

import { NotificationRepository } from './domain/ports/notification-repository.port';
import { WelcomeOnUserRegistered } from './infrastructure/event-handlers/welcome-on-user-registered.handler';
import { TypeOrmNotificationRepository } from './infrastructure/persistence/typeorm-notification.repository';

@Module({
  providers: [
    { provide: NotificationRepository, useClass: TypeOrmNotificationRepository },
    WelcomeOnUserRegistered,
  ],
  exports: [NotificationRepository],
})
export class NotificationModule {}
