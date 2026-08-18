import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'notification', name: 'notifications' })
export class NotificationOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  // An id, not a foreign key. identity owns its table, and a cross-context FK
  // is the thing that makes extraction impossible (AGENTS.md §13).
  @Column({ type: 'uuid', name: 'recipient_uuid' })
  recipientUuid!: string;

  // Copied at queue time, not joined from identity at send time.
  @Column({ type: 'varchar', length: 320, name: 'recipient_address' })
  recipientAddress!: string;

  @Column({ type: 'varchar', length: 32 })
  channel!: string;

  @Column({ type: 'varchar', length: 256 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'int' })
  attempts!: number;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
