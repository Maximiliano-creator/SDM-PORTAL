import argon2 from 'argon2';
import { db } from './client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
function rowToUser(row) {
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
export function findUserByUsername(username) {
    const row = db
        .prepare('SELECT * FROM users WHERE username = ? LIMIT 1')
        .get(username);
    if (!row)
        return null;
    return { user: rowToUser(row), passwordHash: row.password_hash };
}
export function findUserById(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id);
    return row ? rowToUser(row) : null;
}
export function recordLogin(id) {
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}
export async function createUser(input) {
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const stmt = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?) RETURNING *');
    const row = stmt.get(input.username, hash, input.fullName ?? null, input.role ?? 'operator');
    return rowToUser(row);
}
export async function updateUserCredentials(id, input) {
    if (!input.username && !input.password) {
        const user = findUserById(id);
        if (!user)
            throw new Error('Usuario no encontrado');
        return user;
    }
    let row;
    if (input.username && input.password) {
        const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
        row = db
            .prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ? RETURNING *')
            .get(input.username, passwordHash, id);
    }
    else if (input.username) {
        row = db
            .prepare('UPDATE users SET username = ? WHERE id = ? RETURNING *')
            .get(input.username, id);
    }
    else {
        const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
        row = db
            .prepare('UPDATE users SET password_hash = ? WHERE id = ? RETURNING *')
            .get(passwordHash, id);
    }
    if (!row)
        throw new Error('Usuario no encontrado');
    db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(Date.now(), id);
    return rowToUser(row);
}
export async function ensureSeedAdmin() {
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (count > 0)
        return;
    if (!config.initialAdminPassword) {
        throw new Error('No hay usuarios configurados. Define INITIAL_ADMIN_PASSWORD (mínimo 12 caracteres) para crear el primer administrador.');
    }
    const username = 'admin';
    await createUser({
        username,
        password: config.initialAdminPassword,
        fullName: 'Administrador',
        role: 'admin',
    });
    logger.warn({ username }, 'Cuenta inicial de administrador creada; elimina INITIAL_ADMIN_PASSWORD del entorno.');
}
//# sourceMappingURL=users.js.map