import { Readable } from 'node:stream';

import { assertUsableFileKey, collect } from './file-storage.port';

describe('assertUsableFileKey', () => {
  it.each(['a.pdf', 'jobs/1/artwork.pdf', 'a-b_c.1.pdf', 'A/B/C'])('accepts %s', (key) => {
    expect(() => assertUsableFileKey(key)).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['traversal', '../x'],
    ['nested traversal', 'a/../../x'],
    ['single dot segment', 'a/./x'],
    ['absolute', '/x'],
    ['trailing slash', 'a/'],
    ['double slash', 'a//b'],
    ['backslash', 'a\\b'],
    // Rejected on purpose: a customer's filename is sanitised into a key, it
    // is not used as one.
    ['space', 'Business Cards.pdf'],
    ['null byte', 'a\u0000b'],
    ['too long', 'a'.repeat(513)],
  ])('refuses %s', (_name, key) => {
    expect(() => assertUsableFileKey(key)).toThrow(
      expect.objectContaining({ code: 'INVALID_FILE_KEY' }) as Error,
    );
  });
});

describe('collect', () => {
  it('reassembles a chunked stream in order', async () => {
    const stream = Readable.from([Buffer.from('%PDF'), Buffer.from('-1.7'), Buffer.from(' body')]);

    expect((await collect(stream)).toString()).toBe('%PDF-1.7 body');
  });

  it('handles a stream that yields strings', async () => {
    expect((await collect(Readable.from(['a', 'b']))).toString()).toBe('ab');
  });

  it('returns an empty buffer for an empty stream', async () => {
    expect(await collect(Readable.from([]))).toHaveLength(0);
  });
});
