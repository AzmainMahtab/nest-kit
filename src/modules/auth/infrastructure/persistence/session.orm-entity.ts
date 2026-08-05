import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'auth', name: 'sessions' })
export class SessionOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  // An id, not a foreign key: identity owns its table (AGENTS.md §13).
  @Column({ type: 'uuid', name: 'user_uuid' })
  userUuid!: string;

  @Column({ type: 'uuid', name: 'refresh_jti' })
  refreshJti!: string;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt!: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;
}
