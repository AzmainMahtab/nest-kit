import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Readable } from 'node:stream';

import {
  assertUsableFileKey,
  FileContent,
  FileNotFound,
  FileStorage,
  StorageUnavailable,
  StoredFile,
} from '../../shared/application';
import { AppConfig } from '../config';

/** What S3 and its imitators call "the object is not there". */
const NOT_FOUND = new Set(['NoSuchKey', 'NotFound', '404']);

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (name !== undefined && NOT_FOUND.has(name)) || $metadata?.httpStatusCode === 404;
}

/**
 * Object storage over the S3 API.
 *
 * Written against the API rather than against AWS: with `S3_ENDPOINT` and
 * path-style addressing this is MinIO on a laptop, Cloudflare R2, Backblaze or
 * Wasabi, and with the endpoint left empty it is AWS itself. Nothing above
 * this class knows which, and that is the point of `FileStorage` being a port.
 *
 * Uploads go through `lib-storage`'s `Upload`, which switches to multipart on
 * its own once a body is large enough. A plain `PutObject` would need the
 * whole file in memory and a known length, which is exactly the ceiling this
 * adapter exists to remove.
 */
@Injectable()
export class S3FileStorage extends FileStorage implements OnApplicationShutdown {
  private readonly logger = new Logger(S3FileStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: AppConfig) {
    super();
    const s3 = this.config.s3;
    this.bucket = s3.bucket;

    this.client = new S3Client({
      region: s3.region,
      // Empty means AWS. Anything else is MinIO or another implementation.
      ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
      // Required by MinIO and most self-hosted stores, which cannot do
      // virtual-host addressing without wildcard DNS.
      forcePathStyle: s3.forcePathStyle,
      /**
       * Omitted entirely when no key is configured, so the SDK falls back to
       * its own chain — an instance role, IRSA, a shared profile. Passing
       * empty strings instead would defeat that and fail with a confusing
       * "missing credentials" against a correctly configured production role.
       */
      ...(s3.accessKeyId
        ? {
            credentials: {
              accessKeyId: s3.accessKeyId,
              secretAccessKey: s3.secretAccessKey,
            },
          }
        : {}),
    });
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  async put(key: string, body: Readable | Buffer, contentType: string): Promise<StoredFile> {
    assertUsableFileKey(key);

    try {
      const upload = new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      });
      await upload.done();
    } catch (error) {
      throw this.translate(error, key);
    }

    // `Upload` does not report the length it wrote, and asking the caller to
    // measure a stream would defeat streaming. One HEAD is cheap and makes the
    // returned size the store's answer rather than ours.
    const stored = await this.head(key);
    return stored ?? { key, size: 0, contentType };
  }

  async get(key: string): Promise<FileContent> {
    assertUsableFileKey(key);

    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        stream: result.Body as Readable,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      throw this.translate(error, key);
    }
  }

  async head(key: string): Promise<StoredFile | null> {
    assertUsableFileKey(key);

    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        key,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw this.translate(error, key);
    }
  }

  async delete(key: string): Promise<void> {
    assertUsableFileKey(key);

    try {
      // S3 answers 204 whether or not the key was there, so this is already
      // idempotent without a preceding existence check.
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      throw this.translate(error, key);
    }
  }

  presignPut(key: string, contentType: string, expiresInSeconds?: number): Promise<string> {
    assertUsableFileKey(key);

    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds ?? this.config.s3.presignExpirySeconds },
    );
  }

  presignGet(key: string, expiresInSeconds?: number): Promise<string> {
    assertUsableFileKey(key);

    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds ?? this.config.s3.presignExpirySeconds,
    });
  }

  private translate(error: unknown, key: string): Error {
    if (isNotFound(error)) {
      return FileNotFound(key);
    }
    this.logger.error(
      `s3 ${this.bucket} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return StorageUnavailable(error);
  }
}
