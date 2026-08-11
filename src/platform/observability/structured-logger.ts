import { LoggerService } from '@nestjs/common';

import { RequestContextStore } from './request-context';

export type LogLevel = 'debug' | 'log' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';

const SEVERITY: Record<LogLevel, number> = { debug: 10, log: 20, warn: 30, error: 40 };

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  correlationId?: string;
  stack?: string;
}

/**
 * The application's only log sink, installed in `main.ts` so that every
 * `new Logger(X)` in the codebase — framework included — goes through it.
 *
 * `json` is not a style preference: Loki, CloudWatch and every other collector
 * index fields, not sentences. `[Nest] 4242 - 08/11/2026, 3:04:11 PM LOG
 * [NatsClient] connected` is one opaque string, so "every 500 for this
 * request" is a substring search rather than a query. The correlation id is
 * attached here rather than at each call site, which is what makes that query
 * possible without changing a single existing log statement.
 */
export class StructuredLogger implements LoggerService {
  constructor(
    private readonly level: LogLevel = 'log',
    private readonly format: LogFormat = 'json',
    private readonly out: NodeJS.WriteStream = process.stdout,
    private readonly err: NodeJS.WriteStream = process.stderr,
  ) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (SEVERITY[level] < SEVERITY[this.level]) {
      return;
    }

    const { context, stack } = this.split(params);

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: this.stringify(message),
      correlationId: RequestContextStore.correlationId(),
      stack,
    };

    const stream = level === 'error' ? this.err : this.out;
    stream.write(`${this.format === 'json' ? this.asJson(record) : this.asText(record)}\n`);
  }

  /**
   * Nest's convention is `logger.error(message, stack, context)` with both
   * trailing arguments optional, so the last string is the context and
   * anything before it is a stack.
   */
  private split(params: unknown[]): { context: string; stack?: string } {
    const parts = params.filter((p) => p !== undefined && p !== null).map((p) => this.stringify(p));

    if (parts.length === 0) {
      return { context: 'Application' };
    }

    const context = parts[parts.length - 1] ?? 'Application';
    const rest = parts.slice(0, -1);

    return { context, stack: rest.length > 0 ? rest.join('\n') : undefined };
  }

  private stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? value.message;

    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }

  private asJson(record: LogRecord): string {
    // Undefined members are dropped by JSON.stringify, so an unrelated log
    // line does not carry an empty correlationId field.
    return JSON.stringify(record);
  }

  private asText(record: LogRecord): string {
    const correlation = record.correlationId ? ` (${record.correlationId})` : '';
    const stack = record.stack ? `\n${record.stack}` : '';

    return (
      `${record.timestamp} ${record.level.toUpperCase().padEnd(5)} ` +
      `[${record.context}]${correlation} ${record.message}${stack}`
    );
  }
}
