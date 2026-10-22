#!/usr/bin/env node
/**
 * Generate a PBKDF2 hash for the seeded admin login, or for rotating the
 * password later.
 *
 *   node scripts/hash-password.mjs 'my new password'
 *
 * Copy the printed value into a D1 statement:
 *
 *   npx wrangler d1 execute massage-feedback --remote --command \
 *     "UPDATE admins SET password_hash = '<hash>' WHERE username = 'admin'"
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

// Tuned for the Workers free plan's 10 ms CPU budget: PBKDF2 runs natively, but
// 100k iterations risks an exceeded-CPU error on login. Online guessing is
// already capped by the 10-attempts-per-15-minutes limiter and the password is
// long and random, so 10k is the right trade here.
const ITERATIONS = 10_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}
if (password.length < 12) {
  console.error('Use at least 12 characters — this is the only credential.');
  process.exit(1);
}

const salt = randomBytes(SALT_LENGTH);
const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');

// Format mirrors src/lib/password.ts so the Worker can verify it.
console.log(`pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${key.toString('base64')}`);
