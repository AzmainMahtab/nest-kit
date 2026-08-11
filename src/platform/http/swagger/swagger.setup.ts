import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { AppConfig } from '../../config';
import { ErrorEnvelopeDto, SuccessEnvelopeDto } from './envelope.schema';

const DESCRIPTION = `
Modular monolith: Clean Architecture, DDD and CQRS, sliced by bounded context.

**Every response is enveloped.** Success is \`{ "success": true, "data": … }\`;
failure is \`{ "success": false, "error": { "code", "message", "details" }, "path", "timestamp" }\`.
Match on \`error.code\` — it is stable. The message is for humans and may change.

**Access is denied by default.** Only registration, login, refresh, the health
probes and the metrics scrape are public. Everything else needs a bearer token:
call \`POST /api/v1/auth/login\`, then paste the \`accessToken\` into
**Authorize** above.

**Routes are versioned in the path** — \`/api/v1/…\`. \`/health\`, \`/health/ready\`
and \`/metrics\` are deliberately outside both the prefix and the version, so a
deployment manifest never has to follow an API version.

**Every route is rate limited** per client IP, and credential endpoints
(register, login, refresh) get a tighter budget. Responses carry
\`X-RateLimit-Remaining\`; a rejection is \`429 RATE_LIMITED\` with \`Retry-After\`.
`.trim();

export function buildOpenApiDocument(app: INestApplication, config: AppConfig): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('nest-kit API')
    .setDescription(DESCRIPTION)
    .setVersion(config.version)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'ES256 access token' },
      'bearer',
    )
    .addServer(`http://localhost:${config.port}`, 'Local')
    .addTag('Auth', 'Sessions and tokens')
    .addTag('Users', 'Identity: accounts and their lifecycle')
    .addTag('Owners', 'Car owners, linked to a user')
    .addTag('Cars', 'Cars, linked to an owner')
    .addTag('Messaging admin', 'Outbox backlog, consumer lag, dead letters')
    .addTag('Health', 'Liveness and readiness probes, outside the API prefix')
    .addTag('Observability', 'Prometheus scrape endpoint');

  return SwaggerModule.createDocument(app, builder.build(), {
    // Referenced only through allOf in the response decorators, so Nest cannot
    // discover them from a controller signature.
    extraModels: [SuccessEnvelopeDto, ErrorEnvelopeDto],
  });
}

export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.swagger.enabled) {
    return;
  }

  SwaggerModule.setup(config.swagger.path, app, buildOpenApiDocument(app, config), {
    customSiteTitle: 'nest-kit API',
    jsonDocumentUrl: `${config.swagger.path}-json`,
    swaggerOptions: {
      // Survives a page reload, so a token pasted once keeps working.
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      docExpansion: 'list',
    },
  });

  new Logger('Swagger').log(`docs at /${config.swagger.path}`);
}
