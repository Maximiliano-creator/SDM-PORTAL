import argon2 from 'argon2';
import { db } from './client.js';
import { logger } from '../logger.js';
import type { User } from '@sdm/shared';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string | null;
  role: 'admin' | 'operator';
  enabled: number;
  created_at: string;
  last_login_at: string | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function findUserByUsername(username: string): { user: User; passwordHash: string } | null {
  const row = db
    .prepare<[string], UserRow>('SELECT * FROM users WHERE username = ? LIMIT 1')
    .get(username);
  if (!row) return null;
  return { user: rowToUser(row), passwordHash: row.password_hash };
}

export function findUserById(id: number): User | null {
  const row = db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1').get(id);
  return row ? rowToUser(row) : null;
}

export function recordLogin(id: number): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

export async function createUser(input: {
  username: string;
  password: string;
  fullName?: string | null;
  role?: 'admin' | 'operator';
}): Promise<User> {
  const hash = await argon2.hash(input.password, { type: argon2.argon2id });
  const stmt = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?) RETURNING *',
  );
  const row = stmt.get(
    input.username,
    hash,
    input.fullName ?? null,
    input.role ?? 'operator',
  ) as UserRow;
  return rowToUser(row);
}

export async function updateUserCredentials(
  id: number,
  input: { username?: string; password?: string },
): Promise<User> {
  if (!input.username && !input.password) {
    const user = findUserById(id);
    if (!user) throw new Error('Usuario no encontrado');
    return user;
  }

  let row: UserRow | undefined;
  if (input.username && input.password) {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    row = db
      .prepare<[string, string, number], UserRow>(
        'UPDATE users SET username = ?, password_hash = ? WHERE id = ? RETURNING *',
      )
      .get(input.username, passwordHash, id);
  } else if (input.username) {
    row = db
      .prepare<[string, number], UserRow>(
        'UPDATE users SET username = ? WHERE id = ? RETURNING *',
      )
      .get(input.username, id);
  } else {
    const passwordHash = await argon2.hash(input.password!, { type: argon2.argon2id });
    row = db
      .prepare<[string, number], UserRow>(
        'UPDATE users SET password_hash = ? WHERE id = ? RETURNING *',
      )
      .get(passwordHash, id);
  }
  if (!row) throw new Error('Usuario no encontrado');
  return rowToUser(row);
}

export async function ensureSeedAdmin(): Promise<void> {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  const username = 'admin';
  const password = 'admin';
  await createUser({ username, password, fullName: 'Administrador', role: 'admin' });
  logger.warn(
    { username, password },
    'Usuario admin inicial creado. CAMBIA LA CONTRASEÑA en el primer login.',
  );
}
