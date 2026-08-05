import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AppErrorFilter } from './../src/platform/http/filters/app-error.filter';
import { ResponseEnvelopeInterceptor } from './../src/platform/http/interceptors/response-envelope.interceptor';

describe('Application (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AppErrorFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is outside the api prefix and returns the success envelope', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ success: true, data: { status: 'ok' } });
  });

  it('an unmatched route returns the error envelope, not the Nest default shape', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
      path: '/api/does-not-exist',
    });
  });
});
