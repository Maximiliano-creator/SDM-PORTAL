import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../db/client.js';
const stmts = {
    list: db.prepare('SELECT * FROM erp_api_keys ORDER BY created_at DESC'),
    getById: db.prepare('SELECT * FROM erp_api_keys WHERE id = ?'),
    getByHash: db.prepare('SELECT * FROM erp_api_keys WHERE key_hash = ? AND enabled = 1'),
    insert: db.prepare('INSERT INTO erp_api_keys (name, key_hash, key_prefix, created_by, can_distribute) VALUES (?, ?, ?, ?, ?)'),
    setEnabled: db.prepare('UPDATE erp_api_keys SET enabled = ? WHERE id = ?'),
    setCanDistribute: db.prepare('UPDATE erp_api_keys SET can_distribute = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM erp_api_keys WHERE id = ?'),
    touch: db.prepare("UPDATE erp_api_keys SET last_used_at = datetime('now') WHERE id = ?"),
};
export function hashKey(raw) {
    return createHash('sha256').update(raw).digest('hex');
}
export function createApiKey(name, createdBy, canDistribute = false) {
    // 32 bytes base64url ≈ 43 chars; prefijo `sdm_` para que sea reconocible
    const raw = `sdm_${randomBytes(32).toString('base64url')}`;
    const prefix = raw.slice(0, 12);
    const keyHash = hashKey(raw);
    const info = stmts.insert.run(name, keyHash, prefix, createdBy, canDistribute ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    const row = stmts.getById.get(id);
    if (!row)
        throw new Error('Failed to persist API key');
    return { id, name: row.name, key: raw, prefix, createdAt: row.created_at };
}
export function listApiKeys() {
    return stmts.list.all().map(({ key_hash: _kh, ...rest }) => rest);
}
export function setApiKeyEnabled(id, enabled) {
    const r = stmts.setEnabled.run(enabled ? 1 : 0, id);
    return r.changes > 0;
}
export function setApiKeyCanDistribute(id, canDistribute) {
    const r = stmts.setCanDistribute.run(canDistribute ? 1 : 0, id);
    return r.changes > 0;
}
export function deleteApiKey(id) {
    const r = stmts.remove.run(id);
    return r.changes > 0;
}
export function authenticateApiKey(rawKey) {
    if (!rawKey || rawKey.length < 16)
        return null;
    const candidateHash = hashKey(rawKey);
    // Buscamos por hash directo (igual indexable); luego timing-safe compare por las dudas
    const row = stmts.getByHash.get(candidateHash);
    if (!row)
        return null;
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(row.key_hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b))
        return null;
    stmts.touch.run(row.id);
    return row;
}
//# sourceMappingURL=apiKeys.js.map