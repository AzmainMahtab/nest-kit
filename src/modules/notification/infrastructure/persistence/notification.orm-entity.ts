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

  @Column({ type: 'varchar', length: 32 })
  channel!: string;

  @Column({ type: 'varchar', length: 256 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
