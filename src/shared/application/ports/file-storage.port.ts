import { Readable } from 'node:stream';

import { AppError, ErrorKind } from '../../errors';

/** What a stored object is, independent of which bucket or provider holds it. */
export interface StoredFile {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
}

export interface FileContent {
  readonly stream: Readable;
  readonly size: number;
  readonly contentType: string;
}

export const FileNotFound = (key: string): AppError =>
  AppError.notFound('FILE_NOT_FOUND', `no stored file at '${key}'`);

export const StorageUnavailable = (cause?: unknown): AppError =>
  new AppError(
    ErrorKind.Internal,
    'STORAGE_UNAVAILABLE',
    'object storage could not be reached',
    [],
    cause,
  );

/**
 * A key no object store should be asked to address.
 *
 * Validated by the port rather than by each adapter so that the same key is
 * accepted or refused identically everywhere — one backend being stricter than
 * another is how an upload works in test and fails in production.
 */
export const InvalidFileKey = (key: string, why: string): AppError =>
  AppError.invalid('INVALID_FILE_KEY', `'${key}' is not a usable storage key: ${why}`);

/**
 * `jobs/<uuid>/artwork.pdf` — slash-separated segments of word characters,
 * dots and dashes.
 *
 * Deliberately narrower than what S3 permits. Keys are generated, not typed by
 * a person, and a narrow alphabet keeps them safe in a URL, a path and a log
 * line without escaping. Preserving a customer's original filename means
 * sanitising it into this shape, not widening the pattern — `Business Cards
 * (final).pdf` has no business being a key.
 */
const KEY_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function assertUsableFileKey(key: string): void {
  if (key.length === 0) {
    throw InvalidFileKey(key, 'it is empty');
  }
  if (key.length > 512) {
    throw InvalidFileKey(key, 'it is longer than 512 characters');
  }
  if (!KEY_PATTERN.test(key)) {
    throw InvalidFileKey(
      key,
      'it must be slash-separated segments of letters, digits, dot, dash or underscore',
    );
  }
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw InvalidFileKey(key, 'it contains a traversal segment');
  }
}

/**
 * Reads a whole object into memory.
 *
 * Provided so that the callers who genuinely need every byte — reading a PDF's
 * page count, hashing an upload — do not each write their own stream
 * collector. It is the exception: anything that only moves bytes from one
 * place to another should stay on the stream.
 */
export async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

/**
 * Bytes at rest, addressed by an opaque key.
 *
 * Deliberately not a filesystem: no listing, no rename, no directories. Those
 * are the operations where object stores differ most from each other and from
 * a disk, and a port that promises them is a port that cannot be implemented
 * twice.
 *
 * Bodies are streams because the files this exists for are print-ready
 * artwork. A `Buffer` signature quietly caps the product at whatever the
 * process can hold, and the cap is discovered in production.
 *
 * `put` is last-write-wins by design — an upload retried after a timeout must
 * not become two objects, and the caller already owns the key.
 */
export abstract class FileStorage {
  abstract put(key: string, body: Readable | Buffer, contentType: string): Promise<StoredFile>;

  /** Throws `FileNotFound` rather than returning null: reading bytes that are not there is a fault, not an answer. */
  abstract get(key: string): Promise<FileContent>;

  /** Metadata without the bytes. Null when absent, because "is it there?" is a question. */
  abstract head(key: string): Promise<StoredFile | null>;

  /** Idempotent: deleting what is not there succeeds. */
  abstract delete(key: string): Promise<void>;

  /**
   * A URL the browser may upload to directly.
   *
   * The reason this is on the port and not an afterthought: without it every
   * byte of every artwork file transits the API, and an API that proxies
   * hundreds of megabytes is an API that falls over on a busy morning. The
   * signature commits the caller to a content type so the stored object is not
   * whatever the browser felt like claiming.
   */
  abstract presignPut(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;

  /** A URL the browser may download from directly, for the same reason. */
  abstract presignGet(key: string, expiresInSeconds?: number): Promise<string>;
}
