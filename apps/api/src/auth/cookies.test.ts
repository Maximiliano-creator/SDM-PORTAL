import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let cookies: typeof import('./cookies.js');
const previousJwtSecret = process.env.JWT_SECRET;
const previousCorsOrigin = process.env.CORS_ORIGIN;
const previousCookieSecure = process.env.COOKIE_SECURE;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.COOKIE_SECURE = 'false';
  cookies = await import('./cookies.js');
});

afterAll(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (previousCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = previousCorsOrigin;
  if (previousCookieSecure === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = previousCookieSecure;
});

function requestWithHeaders(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe('session cookies and CSRF validation', () => {
  it('makes the CSRF cookie readable on app pages while keeping the session HttpOnly', () => {
    const append = vi.fn();
    const response = { append } as unknown as Response;
    cookies.setSessionCookies(response, 'session-token', 'csrf-token', new Date(Date.now() + 60_000).toISOString());

    expect(append).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('sdm_session=session-token; Path=/api; HttpOnly; SameSite=Strict'),
    );
    expect(append).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('sdm_csrf=csrf-token; Path=/; SameSite=Strict'),
    );
  });

  it('requires an allowed origin and matching CSRF cookie/header values', () => {
    expect(
      cookies.hasValidCsrf(
        requestWithHeaders({
          origin: 'http://localhost:5173',
          cookie: 'sdm_csrf=token',
          'x-csrf-token': 'token',
        }),
      ),
    ).toBe(true);
    expect(
      cookies.hasValidCsrf(
        requestWithHeaders({
          origin: 'http://untrusted.local',
          cookie: 'sdm_csrf=token',
          'x-csrf-token': 'token',
        }),
      ),
    ).toBe(false);
    expect(
      cookies.hasValidCsrf(
        requestWithHeaders({
          origin: 'http://localhost:5173',
          cookie: 'sdm_csrf=token',
          'x-csrf-token': 'other',
        }),
      ),
    ).toBe(false);
  });
});
