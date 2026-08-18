import { Clock } from '../../../shared/application';
import { AppConfig } from '../../../platform/config';
import { DeliveryStatus, Notification } from '../domain/notification';
import { NotificationRepository } from '../domain/ports/notification-repository.port';
import { NotificationDispatcher } from './notification-dispatcher.task';

describe('NotificationDispatcher', () => {
  const NOW = new Date('2026-08-18T10:00:00Z');
  const clock: Clock = { now: () => NOW };

  let queue: Notification[];
  let saved: Notification[];
  let mailer: { isConfigured: jest.Mock; send: jest.Mock };

  const config = (maxAttempts = 3): AppConfig =>
    ({ notifications: { intervalMs: 5000, batch: 50, maxAttempts } }) as AppConfig;

  const repository = (): NotificationRepository => ({
    save: (notification: Notification) => {
      saved.push(notification);
      return Promise.resolve();
    },
    listQueued: () => Promise.resolve(queue),
    listForRecipient: () => Promise.resolve([]),
  });

  const dispatcherWith = (maxAttempts = 3): NotificationDispatcher =>
    new NotificationDispatcher(repository(), mailer, clock, config(maxAttempts));

  const queued = (channel = 'email'): Notification =>
    Notification.queue('user-uuid', 'a@b.test', channel, 'Welcome', 'Hello', NOW);

  beforeEach(() => {
    queue = [];
    saved = [];
    mailer = {
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('sends a queued notification to the address it carries', async () => {
    const notification = queued();
    queue = [notification];

    await dispatcherWith().run();

    expect(mailer.send).toHaveBeenCalledWith({
      to: 'a@b.test',
      subject: 'Welcome',
      body: 'Hello',
    });
    expect(notification.status).toBe(DeliveryStatus.Sent);
  });

  it('persists the attempt before the send, not only the outcome', async () => {
    const notification = queued();
    queue = [notification];
    const attemptsWhenSent: number[] = [];
    mailer.send.mockImplementation(() => {
      // Whatever the transport does next, the row already says one attempt.
      attemptsWhenSent.push(saved.length);
      return Promise.resolve();
    });

    await dispatcherWith().run();

    expect(attemptsWhenSent).toEqual([1]);
    expect(saved).toHaveLength(2);
  });

  it('leaves a failed notification queued for the next sweep', async () => {
    const notification = queued();
    queue = [notification];
    mailer.send.mockRejectedValue(new Error('smtp refused'));

    await dispatcherWith().run();

    expect(notification.status).toBe(DeliveryStatus.Queued);
    expect(notification.attempts).toBe(1);
    expect(notification.lastError).toBe('smtp refused');
  });

  it('stops retrying once the cap is reached', async () => {
    const notification = queued();
    queue = [notification];
    mailer.send.mockRejectedValue(new Error('smtp refused'));
    const dispatcher = dispatcherWith(2);

    await dispatcher.run();
    await dispatcher.run();

    expect(notification.status).toBe(DeliveryStatus.Failed);
    expect(notification.attempts).toBe(2);
  });

  it('records UNCONFIGURED without attempting when no transport is set up', async () => {
    const notification = queued();
    queue = [notification];
    mailer.isConfigured.mockReturnValue(false);

    await dispatcherWith().run();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(notification.status).toBe(DeliveryStatus.Unconfigured);
    expect(notification.attempts).toBe(0);
  });

  it('fails a channel it has no transport for, immediately rather than five times', async () => {
    const notification = queued('sms');
    queue = [notification];

    await dispatcherWith().run();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(notification.status).toBe(DeliveryStatus.Failed);
    expect(notification.lastError).toBe("unsupported channel 'sms'");
  });

  it('keeps going after one notification fails', async () => {
    const first = queued();
    const second = queued();
    queue = [first, second];
    mailer.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    await dispatcherWith().run();

    expect(first.status).toBe(DeliveryStatus.Queued);
    expect(second.status).toBe(DeliveryStatus.Sent);
  });

  it('does nothing when the queue is empty', async () => {
    await dispatcherWith().run();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});
