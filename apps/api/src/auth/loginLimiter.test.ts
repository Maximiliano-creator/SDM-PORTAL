import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

let db: Database.Database;
let limiter: typeof import('./loginLimiter.js');
const previousDbPath = process.env.DB_PATH;
const previousJwtSecret = process.env.JWT_SECRET;
const previousNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
  process.env.NODE_ENV = 'test';
  ({ db } = await import('../db/client.js'));
  limiter = await import('./loginLimiter.js');
});

afterAll(() => {
  db.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe('persistent login limiter', () => {
  it('blocks a user and IP after repeated failures, then clears after the window', () => {
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      limiter.recordFailedLogin('127.0.0.1', 'admin', now + attempt);
    }

    expect(limiter.loginRetryAfterSeconds('127.0.0.1', 'admin', now + 5)).toBeGreaterThan(0);
    expect(
      limiter.loginRetryAfterSeconds('127.0.0.1', 'admin', now + 15 * 60 * 1000 + 5),
    ).toBeNull();
  });

  it('applies an IP-wide limit across different usernames and clears it after a valid login', () => {
    const now = Date.now();
    for (let attempt = 0; attempt < 20; attempt++) {
      limiter.recordFailedLogin('127.0.0.2', `user-${attempt}`, now + attempt);
    }

    expect(limiter.loginRetryAfterSeconds('127.0.0.2', 'another-user', now + 20)).toBeGreaterThan(0);
    limiter.clearLoginFailures('127.0.0.2', 'user-19');
    expect(limiter.loginRetryAfterSeconds('127.0.0.2', 'another-user', now + 21)).toBeNull();
  });
});
