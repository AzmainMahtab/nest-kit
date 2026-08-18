import { DeliveryStatus, Notification } from './notification';

describe('Notification', () => {
  const NOW = new Date('2026-08-18T10:00:00Z');
  const LATER = new Date('2026-08-18T10:00:05Z');

  const queued = (): Notification =>
    Notification.queue('user-uuid', 'a@b.test', 'email', 'Welcome', 'Hello', NOW);

  it('starts queued, unattempted and unsent', () => {
    const notification = queued();

    expect(notification.status).toBe(DeliveryStatus.Queued);
    expect(notification.attempts).toBe(0);
    expect(notification.sentAt).toBeNull();
    expect(notification.lastError).toBeNull();
  });

  it('carries the address it was queued with rather than a reference to one', () => {
    expect(queued().recipientAddress).toBe('a@b.test');
  });

  it('counts an attempt before anything is sent', () => {
    const notification = queued();

    notification.beginAttempt(LATER);

    expect(notification.attempts).toBe(1);
    expect(notification.status).toBe(DeliveryStatus.Queued);
  });

  it('stays queued between attempts, so the next sweep retries it', () => {
    const notification = queued();

    notification.beginAttempt(LATER);
    notification.markFailed('smtp refused', 3, LATER);

    expect(notification.status).toBe(DeliveryStatus.Queued);
    expect(notification.lastError).toBe('smtp refused');
  });

  it('gives up at the attempt cap, which is a state a human looks at', () => {
    const notification = queued();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      notification.beginAttempt(LATER);
      notification.markFailed('smtp refused', 3, LATER);
    }

    expect(notification.attempts).toBe(3);
    expect(notification.status).toBe(DeliveryStatus.Failed);
  });

  it('records unconfigured without consuming an attempt', () => {
    const notification = queued();

    notification.markUnconfigured(LATER);

    expect(notification.status).toBe(DeliveryStatus.Unconfigured);
    expect(notification.attempts).toBe(0);
  });

  it('clears the last error when it finally sends', () => {
    const notification = queued();
    notification.beginAttempt(LATER);
    notification.markFailed('transient', 3, LATER);

    notification.beginAttempt(LATER);
    notification.markSent(LATER);

    expect(notification.status).toBe(DeliveryStatus.Sent);
    expect(notification.sentAt).toEqual(LATER);
    expect(notification.lastError).toBeNull();
  });

  describe('sent is terminal', () => {
    // Every one of these is a redelivered event or a duplicate sweep.
    it.each([
      ['a second send', (n: Notification) => n.markSent(LATER)],
      ['a late failure', (n: Notification) => n.markFailed('too late', 3, LATER)],
      ['an attempt', (n: Notification) => n.beginAttempt(LATER)],
      ['an unconfigured mark', (n: Notification) => n.markUnconfigured(LATER)],
    ])('%s does not disturb it', (_name, act) => {
      const notification = queued();
      notification.beginAttempt(NOW);
      notification.markSent(NOW);

      act(notification);

      expect(notification.status).toBe(DeliveryStatus.Sent);
      expect(notification.sentAt).toEqual(NOW);
      expect(notification.attempts).toBe(1);
      expect(notification.isDeliverable).toBe(false);
    });
  });

  it('truncates a runaway error rather than storing a stack trace', () => {
    const notification = queued();

    notification.markFailed('x'.repeat(2000), 3, LATER);

    expect(notification.lastError).toHaveLength(512);
  });
});
