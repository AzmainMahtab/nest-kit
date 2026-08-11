import { RequestContextStore } from './request-context';
import { StructuredLogger } from './structured-logger';

interface Sink {
  stream: NodeJS.WriteStream;
  lines: () => string[];
}

function sink(): Sink {
  const written: string[] = [];

  return {
    stream: {
      write: (chunk: string) => {
        written.push(chunk.trimEnd());
        return true;
      },
    } as unknown as NodeJS.WriteStream,
    lines: () => written,
  };
}

describe('StructuredLogger', () => {
  it('emits one JSON object per line', () => {
    const out = sink();
    new StructuredLogger('log', 'json', out.stream).log('connected', 'NatsClient');

    const record = JSON.parse(out.lines()[0]!) as Record<string, unknown>;

    expect(record).toMatchObject({
      level: 'log',
      context: 'NatsClient',
      message: 'connected',
    });
    expect(typeof record.timestamp).toBe('string');
  });

  it('attaches the correlation id of the request being served', () => {
    const out = sink();
    const logger = new StructuredLogger('log', 'json', out.stream);

    RequestContextStore.run({ correlationId: 'trace-1' }, () => {
      logger.log('handled', 'UsersController');
    });

    // The call site did not pass it. That is the point: the id reaches every
    // existing log statement without any of them changing.
    expect(JSON.parse(out.lines()[0]!)).toMatchObject({ correlationId: 'trace-1' });
  });

  it('omits the correlation id outside a request', () => {
    const out = sink();
    new StructuredLogger('log', 'json', out.stream).log('booting', 'Bootstrap');

    expect(out.lines()[0]).not.toContain('correlationId');
  });

  it("splits Nest's (message, stack, context) convention", () => {
    const err = sink();
    new StructuredLogger('log', 'json', err.stream, err.stream).error(
      'publish failed',
      'Error: boom\n  at x',
      'OutboxRelay',
    );

    expect(JSON.parse(err.lines()[0]!)).toMatchObject({
      message: 'publish failed',
      stack: 'Error: boom\n  at x',
      context: 'OutboxRelay',
    });
  });

  it('sends errors to stderr and everything else to stdout', () => {
    const out = sink();
    const err = sink();
    const logger = new StructuredLogger('log', 'json', out.stream, err.stream);

    logger.log('fine', 'A');
    logger.error('broken', 'B');

    expect(out.lines()).toHaveLength(1);
    expect(err.lines()).toHaveLength(1);
  });

  it('drops anything below the configured level', () => {
    const out = sink();
    const logger = new StructuredLogger('warn', 'json', out.stream, out.stream);

    logger.debug('noise', 'A');
    logger.log('also noise', 'A');
    logger.warn('kept', 'A');

    expect(out.lines()).toHaveLength(1);
  });

  it('serialises a non-string message rather than printing [object Object]', () => {
    const out = sink();
    new StructuredLogger('log', 'json', out.stream).log({ rows: 3 }, 'OutboxRelay');

    expect(JSON.parse(out.lines()[0]!)).toMatchObject({ message: '{"rows":3}' });
  });

  it('writes a readable line in pretty mode', () => {
    const out = sink();
    new StructuredLogger('log', 'pretty', out.stream).log('listening', 'Bootstrap');

    expect(out.lines()[0]).toContain('[Bootstrap]');
    expect(out.lines()[0]).toContain('listening');
    expect(out.lines()[0]).not.toContain('{"');
  });
});
