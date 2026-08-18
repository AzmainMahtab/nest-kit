export interface OutboundMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * A transport for one message.
 *
 * `isConfigured` exists because "we never sent it" has two causes that need
 * two different fixes: no credentials, which an operator repairs once, and a
 * provider that refused, which a resend repairs. Counting them together hides
 * an outage behind a configuration gap — the distinction is borrowed from a
 * production system that learned it the hard way.
 *
 * The port says nothing about retries or records. Those belong to whoever is
 * dispatching, because a transport that quietly retried would make the attempt
 * count on the record a lie.
 */
export abstract class Mailer {
  abstract isConfigured(): boolean;

  abstract send(message: OutboundMessage): Promise<void>;
}
