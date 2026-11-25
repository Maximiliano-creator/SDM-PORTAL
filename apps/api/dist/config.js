import 'dotenv/config';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const ConfigSchema = z.object({
    port: z.coerce.number().int().positive().default(8080),
    host: z.string().default('127.0.0.1'),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    jwtSecret: z.string().min(32),
    jwtExpiresIn: z.string().default('4h'),
    dbPath: z.string().default('./data/app.db'),
    termAdminUrl: z.string().url().default('http://localhost:19697'),
    termAdminUsername: z.string().default('admin'),
    termAdminPassword: z.string().min(1).optional(),
    initialAdminPassword: z.string().min(12).optional(),
    cookieSecure: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    corsOrigin: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
});
function resolveJwtSecret(dbPath) {
    const configuredSecret = process.env.JWT_SECRET?.trim();
    if (configuredSecret) {
        const envSecret = configuredSecret;
        if (envSecret.length < 32) {
            throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
        }
        return envSecret;
    }
    const secretFile = join(dirname(dbPath), '.jwt-secret');
    if (existsSync(secretFile)) {
        const cached = readFileSync(secretFile, 'utf-8').trim();
        if (cached.length >= 32)
            return cached;
    }
    const generated = randomBytes(48).toString('hex');
    mkdirSync(dirname(secretFile), { recursive: true });
    writeFileSync(secretFile, generated, { mode: 0o600 });
    return generated;
}
export function loadConfig() {
    const dbPath = process.env.DB_PATH ?? './data/app.db';
    const jwtSecret = resolveJwtSecret(dbPath);
    const parsed = ConfigSchema.safeParse({
        port: process.env.PORT,
        host: process.env.HOST,
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL,
        jwtSecret,
        jwtExpiresIn: process.env.JWT_EXPIRES_IN,
        dbPath,
        termAdminUrl: process.env.TERM_ADMIN_URL,
        termAdminUsername: process.env.TERM_ADMIN_USERNAME,
        termAdminPassword: process.env.TERM_ADMIN_PASSWORD,
        initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD,
        cookieSecure: process.env.COOKIE_SECURE,
        corsOrigin: process.env.CORS_ORIGIN,
    });
    if (!parsed.success) {
        console.error('Configuración inválida:', parsed.error.flatten().fieldErrors);
        process.exit(1);
    }
    if (parsed.data.nodeEnv === 'production' && !parsed.data.cookieSecure) {
        console.error('Configuración inválida: COOKIE_SECURE=true es obligatorio en producción (requiere HTTPS).');
        process.exit(1);
    }
    return parsed.data;
}
export const config = loadConfig();
//# sourceMappingURL=config.js.map