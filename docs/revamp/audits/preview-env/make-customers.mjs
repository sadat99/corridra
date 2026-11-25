import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const roles = [
  'customer',
  'organiser',
  'participant',
  'seller',
  'admin',
  'operator',
  'reviewer',
  'viewer',
  'helper',
];
writeFileSync(
  process.argv[2],
  JSON.stringify({
    base: 'https://ep-audit-preview.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    cookieSecret: randomBytes(32).toString('hex'),
    users: roles.map((role) => ({
      role,
      subject: `audit-${role}-${randomBytes(5).toString('hex')}`,
      email: `audit-${role}@example.invalid`,
      name: `Synthetic Audit ${role[0].toUpperCase()}${role.slice(1)}`,
      token: randomBytes(32).toString('base64url'),
    })),
  }),
  { mode: 0o600 },
);
