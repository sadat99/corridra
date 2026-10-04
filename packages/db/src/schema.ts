import { pgSchema, text, timestamp, boolean, integer, bigint, uuid } from 'drizzle-orm/pg-core';
export const identity = pgSchema('identity');
const times = {
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
};
export const user = identity.table('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text(),
  ...times,
  twoFactorEnabled: boolean('twoFactorEnabled').notNull().default(false),
});
export const session = identity.table('session', {
  id: text().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text().notNull().unique(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  ...times,
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
});
export const account = identity.table('account', {
  id: text().primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text(),
  password: text(),
  ...times,
});
export const verification = identity.table('verification', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  ...times,
});
export const twoFactor = identity.table('twoFactor', {
  id: text().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  secret: text().notNull(),
  backupCodes: text('backupCodes').notNull(),
  verified: boolean().default(true),
  failedVerificationCount: integer('failedVerificationCount').default(0),
  lockedUntil: timestamp('lockedUntil', { withTimezone: true }),
});
export const rateLimit = identity.table('rateLimit', {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
});
export const app = pgSchema('app');
export const tenant = app.table('tenant', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  synthetic: boolean().notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const organisation = app.table('organisation', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  country: text().notNull(),
  synthetic: boolean().notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
