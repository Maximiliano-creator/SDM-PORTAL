import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';

export interface SessionPayload {
  sub: number;
  username: string;
  role: 'admin' | 'operator';
  sid: string;
}

export function signToken(
  payload: Omit<SessionPayload, 'sid'>,
  sessionId: string,
): { token: string; expiresAt: string } {
  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  const token = jwt.sign({ ...payload, sid: sessionId }, config.jwtSecret, {
    ...options,
    algorithm: 'HS256',
  });
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : '';
  return { token, expiresAt };
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') return null;
    const { sub, username, role, sid } = decoded as Partial<SessionPayload>;
    if (
      typeof sub !== 'number' ||
      typeof username !== 'string' ||
      typeof sid !== 'string' ||
      (role !== 'admin' && role !== 'operator')
    ) {
      return null;
    }
    return { sub, username, role, sid };
  } catch {
    return null;
  }
}
