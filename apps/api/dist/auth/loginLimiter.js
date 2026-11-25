import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
const WINDOW_MS = 15 * 60 * 1000;
const USER_IP_LIMIT = 5;
const IP_LIMIT = 20;
let writesSinceCleanup = 0;
const getAttempt = db.prepare('SELECT failures, window_started_at, blocked_until FROM login_attempts WHERE subject_hash = ?');
const upsertAttempt = db.prepare(`
  INSERT INTO login_attempts (subject_hash, failures, window_started_at, blocked_until)
  VALUES (?, 1, ?, 0)
  ON CONFLICT(subject_hash) DO UPDATE SET
    failures = CASE
      WHEN excluded.window_started_at - login_attempts.window_started_at >= ? THEN 1
      ELSE login_attempts.failures + 1
    END,
    window_started_at = CASE
      WHEN excluded.window_started_at - login_attempts.window_started_at >= ?
        THEN excluded.window_started_at
      ELSE login_attempts.window_started_at
    END,
    blocked_until = CASE
      WHEN (CASE
        WHEN excluded.window_started_at - login_attempts.window_started_at >= ? THEN 1
        ELSE login_attempts.failures + 1
      END) >= ?
        THEN excluded.window_started_at + ?
      ELSE 0
    END
`);
const deleteAttempts = db.prepare('DELETE FROM login_attempts WHERE subject_hash IN (?, ?)');
function subjectHash(value) {
    return createHash('sha256').update(value).digest('hex');
}
function subjectKeys(ip, username) {
    return [
        subjectHash(`ip:${ip}`),
        subjectHash(`user-ip:${ip}:${username.trim().toLowerCase()}`),
    ];
}
export function loginRetryAfterSeconds(ip, username, now = Date.now()) {
    const [ipKey, userIpKey] = subjectKeys(ip, username);
    const blockedUntil = Math.max(getAttempt.get(ipKey)?.blocked_until ?? 0, getAttempt.get(userIpKey)?.blocked_until ?? 0);
    return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : null;
}
export function recordFailedLogin(ip, username, now = Date.now()) {
    const [ipKey, userIpKey] = subjectKeys(ip, username);
    const write = db.transaction(() => {
        for (const [key, limit] of [
            [ipKey, IP_LIMIT],
            [userIpKey, USER_IP_LIMIT],
        ]) {
            upsertAttempt.run(key, now, WINDOW_MS, WINDOW_MS, WINDOW_MS, limit, WINDOW_MS);
        }
    });
    write();
    writesSinceCleanup++;
    if (writesSinceCleanup >= 100) {
        db.prepare('DELETE FROM login_attempts WHERE window_started_at < ?').run(now - 24 * 60 * 60 * 1000);
        writesSinceCleanup = 0;
    }
}
export function clearLoginFailures(ip, username) {
    deleteAttempts.run(...subjectKeys(ip, username));
}
//# sourceMappingURL=loginLimiter.js.map