import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config.js';

const SESSION_COOKIE = 'sdm_session';
const CSRF_COOKIE = 'sdm_csrf';
const COOKIE_PATH = '/api';
const CSRF_COOKIE_PATH = '/';

function cookieValue(req: Request, name: string): string | null {
  const header = req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

export function getSessionCookie(req: Request): string | null {
  return cookieValue(req, SESSION_COOKIE);
}

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setSessionCookies(
  res: Response,
  token: string,
  csrfToken: string,
  expiresAt: string,
): void {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const secure = config.cookieSecure ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
  );
  res.append(
    'Set-Cookie',
    `${CSRF_COOKIE}=${csrfToken}; Path=${CSRF_COOKIE_PATH}; SameSite=Strict; Max-Age=${maxAge}${secure}`,
  );
}

export function clearSessionCookies(res: Response): void {
  const secure = config.cookieSecure ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
  res.append(
    'Set-Cookie',
    `${CSRF_COOKIE}=; Path=${CSRF_COOKIE_PATH}; SameSite=Strict; Max-Age=0${secure}`,
  );
}

export function hasValidCsrf(req: Request): boolean {
  const origin = req.header('origin');
  const allowedOrigins = config.corsOrigin.split(',').map((value) => value.trim());
  if (!origin || !allowedOrigins.includes(origin)) return false;

  const cookie = cookieValue(req, CSRF_COOKIE);
  const header = req.header('x-csrf-token');
  if (!cookie || !header) return false;
  const expected = Buffer.from(cookie);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
