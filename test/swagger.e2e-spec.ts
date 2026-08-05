import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { AppConfig } from './../src/platform/config';
import { configureApp } from './../src/platform/http/configure-app';
import { buildOpenApiDocument, setupSwagger } from './../src/platform/http/swagger';

const PASSWORD = 'correct-horse-battery';

interface Schema {
  $ref?: string;
  allOf?: Schema[];
  type?: string;
  items?: Schema;
  properties?: Record<string, Schema>;
  example?: unknown;
}

interface Spec {
  info: { title: string; version: string; description: string };
  tags: { name: string }[];
  components: { schemas: Record<string, Schema>; securitySchemes: Record<string, unknown> };
  paths: Record<
    string,
    Record<
      string,
      {
        security?: unknown[];
        responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
      }
    >
  >;
}

describe('OpenAPI (e2e — requires Postgres, Redis, NATS)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let spec: Spec;

  const http = () => request(app.getHttpServer());

  /** Follows a $ref to its schema. */
  const deref = (schema: Schema): Schema => {
    const name = schema.$ref?.split('/').pop();
    return name ? (spec.components.schemas[name] ?? {}) : schema;
  };

  const jsonSchema = (path: string, method: string, status: string): Schema =>
    spec.paths[path]![method]!.responses[status]!.content!['application/json']!.schema;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    setupSwagger(app, app.get(AppConfig));
    await app.init();

    dataSource = app.get(DataSource);
    spec = buildOpenApiDocument(app, app.get(AppConfig)) as unknown as Spec;
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY');
    await dataSource.query('TRUNCATE auth.sessions RESTART IDENTITY');
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the UI and the raw document', async () => {
    await http().get('/docs').expect(200).expect('Content-Type', /html/);
    await http().get('/docs-json').expect(200).expect('Content-Type', /json/);
  });

  it('describes the service rather than leaving the defaults', () => {
    expect(spec.info.title).toBe('nest-kit API');
    expect(spec.info.description).toContain('Every response is enveloped');
    expect(spec.tags.map((t) => t.name)).toEqual(
      expect.arrayContaining(['Auth', 'Users', 'Owners', 'Cars', 'Health']),
    );
    expect(Object.keys(spec.components.securitySchemes)).toContain('bearer');
  });

  it('documents every JSON success response as the envelope, not the bare DTO', () => {
    const offenders: string[] = [];

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          const schema = response.content?.['application/json']?.schema;
          if (!schema || !status.startsWith('2')) continue;

          const wrapsEnvelope = schema.allOf?.some(
            (part) => part.$ref === '#/components/schemas/SuccessEnvelopeDto',
          );

          if (!wrapsEnvelope) {
            offenders.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }

    // A bare DTO here means a generated client would fail to unwrap `data`.
    expect(offenders).toEqual([]);
  });

  it('documents failures as the error envelope with the matchable code', () => {
    const conflict = jsonSchema('/api/users', 'post', '409');

    expect(conflict.allOf?.[0]?.$ref).toBe('#/components/schemas/ErrorEnvelopeDto');
    expect(conflict.allOf?.[1]?.properties?.error?.properties?.code?.example).toBe(
      'EMAIL_ALREADY_REGISTERED',
    );
  });

  it('declares bearer auth on exactly the routes the guard protects', () => {
    // The four @Public() routes, and nothing else, may be documented as open.
    const PUBLIC = new Set([
      'POST /api/users',
      'POST /api/auth/login',
      'POST /api/auth/refresh',
      'GET /health',
    ]);

    const wrong: string[] = [];

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const route = `${method.toUpperCase()} ${path}`;
        const declaresBearer = operation.security !== undefined;

        if (PUBLIC.has(route) === declaresBearer) {
          wrong.push(`${route} (documented as ${declaresBearer ? 'protected' : 'public'})`);
        }
      }
    }

    // Getting this wrong is worse than omitting it: a class-level
    // @ApiBearerAuth() on a controller with a @Public() route tells every
    // reader and generated client that registration needs a token.
    expect(wrong).toEqual([]);
  });

  it('matches what the API actually returns, field for field', async () => {
    const documented = jsonSchema('/api/users', 'post', '201');
    const dataRef = documented.allOf?.[1]?.properties?.data;
    const documentedFields = Object.keys(deref(dataRef!).properties ?? {}).sort();

    const response = await http()
      .post('/api/users')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(201);

    const body = response.body as { success: boolean; data: Record<string, unknown> };

    // The assertion that stops the spec drifting: the documented envelope and
    // the real one have to agree, not merely both exist.
    expect(Object.keys(body).sort()).toEqual(['data', 'success']);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(documentedFields);
  });

  it('matches a real error response too', async () => {
    await http().post('/api/users').send({ email: 'ada@example.com', password: PASSWORD });

    const response = await http()
      .post('/api/users')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(409);

    const documented = Object.keys(
      deref({ $ref: '#/components/schemas/ErrorEnvelopeDto' }).properties ?? {},
    ).sort();
    const body = response.body as { error: { code: string } };

    expect(Object.keys(body).sort()).toEqual(documented);
    expect(body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('can be turned off without touching code', () => {
    const config = app.get(AppConfig);
    const disabled = {
      ...config,
      swagger: { enabled: false, path: 'docs' },
    } as unknown as AppConfig;

    // No throw, no route registered — the guard is the config, not an if in main.
    expect(() => setupSwagger(app, disabled)).not.toThrow();
  });
});
