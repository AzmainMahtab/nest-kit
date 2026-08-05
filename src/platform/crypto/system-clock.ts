import { Injectable } from '@nestjs/common';

import { Clock } from '../../shared/application';

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
