import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { SuccessEnvelope } from '../responses/envelope';

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T>> {
    return next.handle().pipe(map((data) => ({ success: true as const, data })));
  }
}
