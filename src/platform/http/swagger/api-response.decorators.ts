import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { ErrorEnvelopeDto, SuccessEnvelopeDto } from './envelope.schema';

interface EnvelopeOptions {
  status: number;
  description?: string;
}

/**
 * Documents a route's success response as it is actually sent: the DTO nested
 * under `data` inside the success envelope.
 *
 * Use this instead of `@ApiResponse({ type: Dto })`, which describes only the
 * inner object and is therefore wrong for every route in this application.
 */
export function ApiEnvelope<T extends Type<unknown>>(
  model: T,
  { status, description }: EnvelopeOptions,
) {
  return applyDecorators(
    ApiExtraModels(SuccessEnvelopeDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(SuccessEnvelopeDto) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
    }),
  );
}

/** Same, for a route whose `data` is an array. */
export function ApiEnvelopeArray<T extends Type<unknown>>(
  model: T,
  { status, description }: EnvelopeOptions,
) {
  return applyDecorators(
    ApiExtraModels(SuccessEnvelopeDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(SuccessEnvelopeDto) },
          { properties: { data: { type: 'array', items: { $ref: getSchemaPath(model) } } } },
        ],
      },
    }),
  );
}

/**
 * Documents a failure with the error code the client will actually match on.
 *
 * `@ApiResponse({ status: 409, description: 'EMAIL_ALREADY_REGISTERED' })` puts
 * the code in prose where nothing can read it; this puts it in the schema as
 * the example value of `error.code`.
 */
export function ApiFailure(status: number, code: string, description?: string) {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiResponse({
      status,
      description: description ?? code,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ErrorEnvelopeDto) },
          { properties: { error: { properties: { code: { example: code } } } } },
        ],
      },
    }),
  );
}

/** The failures every authenticated route can return, applied once at the class. */
export function ApiAuthFailures() {
  return applyDecorators(
    ApiFailure(401, 'MISSING_TOKEN', 'No or malformed bearer token, or the token was revoked'),
  );
}

/** The failure every body-taking route can return. */
export function ApiValidationFailure() {
  return ApiFailure(400, 'VALIDATION_FAILED', 'The body or query failed validation');
}
