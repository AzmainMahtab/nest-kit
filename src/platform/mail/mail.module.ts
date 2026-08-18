import { Global, Module } from '@nestjs/common';

import { Mailer } from '../../shared/application';
import { LogMailer } from './log-mailer';

@Global()
@Module({
  providers: [{ provide: Mailer, useClass: LogMailer }],
  exports: [Mailer],
})
export class MailModule {}
