import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';

import { AppModule } from './../src/app.module';
import { collect, FileStorage } from './../src/shared/application';

/**
 * Runs against the MinIO container from `make db-up`.
 *
 * The point of testing against a real store rather than a mocked SDK: what is
 * under test is that the adapter speaks the S3 *API* correctly — path-style
 * addressing, presigned signatures, the shape of a 404 — and a mock would
 * simply agree with whatever the adapter did.
 */
describe('S3 file storage (e2e — requires MinIO, `make db-up`)', () => {
  let app: INestApplication;
  let storage: FileStorage;

  const keysWritten: string[] = [];

  const keyFor = (name: string): string => {
    const key = `e2e/${process.pid}/${name}`;
    keysWritten.push(key);
    return key;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    storage = app.get(FileStorage);
  });

  afterAll(async () => {
    // The bucket outlives the process, exactly as the JetStream stream does.
    // Wrapped because a cleanup failure must not be reported as the suite
    // failing to run, which hides whatever the real failure was.
    for (const key of keysWritten) {
      await storage.delete(key).catch(() => undefined);
    }
    await app.close();
  });

  it('round-trips a buffer', async () => {
    const key = keyFor('buffer.pdf');
    const body = Buffer.from('%PDF-1.7 artwork');

    const stored = await storage.put(key, body, 'application/pdf');

    expect(stored).toEqual({ key, size: body.byteLength, contentType: 'application/pdf' });

    const content = await storage.get(key);
    expect(content.contentType).toBe('application/pdf');
    expect((await collect(content.stream)).toString()).toBe('%PDF-1.7 artwork');
  });

  it('round-trips a stream without ever holding it whole', async () => {
    const key = keyFor('stream.pdf');
    const chunks = ['%PDF-1.7', ' streamed', ' artwork'];

    await storage.put(key, Readable.from(chunks.map((c) => Buffer.from(c))), 'application/pdf');

    const content = await storage.get(key);
    expect((await collect(content.stream)).toString()).toBe(chunks.join(''));
  });

  it('uploads a body past the multipart threshold', async () => {
    const key = keyFor('large.bin');
    // lib-storage switches to multipart above 5 MiB. This proves the switch
    // works rather than assuming it.
    const body = Buffer.alloc(6 * 1024 * 1024, 7);

    const stored = await storage.put(key, Readable.from(body), 'application/octet-stream');

    expect(stored.size).toBe(body.byteLength);
  });

  it('reports metadata without the bytes, and null when absent', async () => {
    const key = keyFor('head.txt');
    await storage.put(key, Buffer.from('xyz'), 'text/plain');

    expect(await storage.head(key)).toEqual({ key, size: 3, contentType: 'text/plain' });
    expect(await storage.head('e2e/definitely/missing.txt')).toBeNull();
  });

  it('raises FILE_NOT_FOUND when reading an object that is not there', async () => {
    await expect(storage.get('e2e/definitely/missing.txt')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('deletes idempotently', async () => {
    const key = keyFor('gone.txt');
    await storage.put(key, Buffer.from('x'), 'text/plain');

    await storage.delete(key);
    await storage.delete(key);

    expect(await storage.head(key)).toBeNull();
  });

  it('is last-write-wins, so a retried upload is one object', async () => {
    const key = keyFor('retried.txt');

    await storage.put(key, Buffer.from('first'), 'text/plain');
    await storage.put(key, Buffer.from('second'), 'text/plain');

    expect((await collect((await storage.get(key)).stream)).toString()).toBe('second');
  });

  it('refuses a traversal key before it reaches the bucket', async () => {
    await expect(
      storage.put('../escaped.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_KEY' });
  });

  describe('presigned URLs', () => {
    it('lets a client upload directly, with no bytes through the API', async () => {
      const key = keyFor('presigned-put.pdf');

      const url = await storage.presignPut(key, 'application/pdf');
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: '%PDF-1.7 direct',
      });

      expect(response.status).toBe(200);
      expect(await storage.head(key)).toMatchObject({ contentType: 'application/pdf' });
    });

    it('lets a client download directly', async () => {
      const key = keyFor('presigned-get.txt');
      await storage.put(key, Buffer.from('downloaded directly'), 'text/plain');

      const response = await fetch(await storage.presignGet(key));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('downloaded directly');
    });

    it('signs a URL that expires, rather than one valid forever', async () => {
      const key = keyFor('expiring.txt');

      const url = await storage.presignGet(key, 60);

      expect(url).toContain('X-Amz-Expires=60');
      expect(url).toContain('X-Amz-Signature=');
    });
  });
});
