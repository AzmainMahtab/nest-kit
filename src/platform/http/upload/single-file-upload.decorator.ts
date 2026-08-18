import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

/**
 * One multipart field, parsed into memory and bounded by `UPLOAD_MAX_BYTES`.
 *
 * The size limit is deliberately *not* an argument here. It is registered once
 * on `MulterModule` from configuration, so a route cannot quietly grant itself
 * a larger budget than the deployment allows, and raising the ceiling is an
 * environment change rather than a code change on twelve controllers.
 *
 * The Swagger half matters as much as the interceptor: without `ApiConsumes`
 * the generated document describes a JSON body, and *Try it out* sends one,
 * which is a 400 that looks like a server bug.
 */
export function SingleFileUpload(field = 'file'): MethodDecorator {
  return applyDecorators(
    UseInterceptors(FileInterceptor(field)),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [field],
        properties: { [field]: { type: 'string', format: 'binary' } },
      },
    }),
  );
}
