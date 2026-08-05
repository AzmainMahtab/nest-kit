export const UserStatus = {
  Pending: 'PENDING',
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export function isUserStatus(value: string): value is UserStatus {
  return Object.values(UserStatus).includes(value as UserStatus);
}
