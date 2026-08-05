/**
 * Transport out of the process. The outbox relay is its only caller — nothing
 * in a use case publishes to a broker directly.
 */
export abstract class MessagePublisher {
  /** Must resolve only once the broker has acknowledged persistence. */
  abstract publish(subject: string, payload: Uint8Array, messageId: string): Promise<void>;

  abstract isReady(): boolean;
}
