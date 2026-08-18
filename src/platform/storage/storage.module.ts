import { Global, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

import { FileStorage } from '../../shared/application';
import { AppConfig } from '../config';
import { S3FileStorage } from './s3-file-storage';

/**
 * One adapter, speaking the S3 API. `S3_ENDPOINT` decides whether that is
 * MinIO on a laptop, R2, Wasabi or AWS itself — see `S3FileStorage`.
 *
 * A second implementation of `FileStorage` swaps in on the provider line
 * below, and nothing that stores a file learns about it. That is why the port
 * is declared in `shared/` rather than in whichever context uploaded first.
 */
@Global()
@Module({
  imports: [
    // Registered once, from configuration. multer refuses an oversized part
    // while it is still streaming, so the process never holds the whole of a
    // hostile upload — a check inside the handler would already be too late.
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.storage.uploadMaxBytes, files: 1 },
      }),
    }),
  ],
  providers: [{ provide: FileStorage, useClass: S3FileStorage }],
  exports: [FileStorage, MulterModule],
})
export class StorageModule {}
