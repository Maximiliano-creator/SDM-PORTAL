import { request } from 'undici';
import { logger } from '../logger.js';
import { getTermAdminConfig } from '../db/settings.js';

const TIMEOUT_MS = 10_000;

/**
 * El JWT que emite term_admin vive 4 h (`jwt.token-validity-in-seconds: 14400000`).
 * Lo renovamos con margen para no operar al borde de la expiración.
 */
const TOKEN_REFRESH_MS = 3 * 60 * 60 * 1000;

/**
 * `POST /api/open/auth/login` está anotado con `@Limit(period = 60, count = 1)`
 * en term-admin: **un solo login por minuto y por IP**. Si agotamos ese cupo
 * el backend responde `{"code":1,"msg":"Access restricted"}` y el portal queda
 * sin poder hablar con term_admin. Por eso el login se serializa con un
 * cooldown local: nunca se dispara un login por segundo, sólo uno por minuto.
 */
const LOGIN_COOLDOWN_MS = 60_000;

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly upstreamBody?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

interface CachedToken {
  token: string;
  fetchedAt: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;
let lastLoginAttemptAt = 0;

function clearCache(): void {
  cached = null;
}

function cooldownRemainingMs(): number {
  return Math.max(0, LOGIN_COOLDOWN_MS - (Date.now() - lastLoginAttemptAt));
}

async function fetchToken(): Promise<string> {
  const cfg = getTermAdminConfig();
  const url = `${cfg.url}/service/api/open/auth/login`;
  let res;
  try {
    res = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });
  } catch (err) {
    throw new UpstreamError(
      `No se pudo contactar a term_admin en ${cfg.url}`,
      503,
      'UPSTREAM_UNREACHABLE',
      err instanceof Error ? err.message : err,
    );
  }
  const body = (await res.body.json()) as {
    code: number;
    data?: { accessToken: string; roleList?: string[] };
    msg?: string;
  };
  if (res.statusCode !== 200 || body.code !== 0 || !body.data?.accessToken) {
    const msg = body.msg ?? 'sin detalle';
    // Cupo de login agotado: es transitorio y se resuelve solo al vencer el minuto.
    if (/access restricted|访问次数/i.test(msg)) {
      throw new UpstreamError(
        'term_admin limitó el login a 1 por minuto por IP (Access restricted). ' +
          'Reintentá en unos segundos; el portal reintentará automáticamente.',
        503,
        'UPSTREAM_LOGIN_RATE_LIMITED',
        body,
      );
    }
    throw new UpstreamError(`Login a term_admin falló: ${msg}`, 502, 'UPSTREAM_LOGIN_FAILED', body);
  }
  logger.info('Token term_admin obtenido');
  return body.data.accessToken;
}

/**
 * Devuelve un token válido,abriendo sesión contra term_admin como máximo una
 * vez por minuto y reutilizándolo mientras no expire.
 */
async function getToken(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < TOKEN_REFRESH_MS) return cached.token;
  // Single-flight: si ya hay un login en curso, todos los callers esperan el mismo
  if (inFlight) return inFlight;

  const remaining = cooldownRemainingMs();
  if (remaining > 0) {
    throw new UpstreamError(
      `term_admin limita el login a 1 por minuto por IP. Reintentá en ${Math.ceil(remaining / 1000)} s.`,
      503,
      'UPSTREAM_LOGIN_RATE_LIMITED',
    );
  }

  lastLoginAttemptAt = Date.now();
  inFlight = (async () => {
    try {
      const token = await fetchToken();
      cached = { token, fetchedAt: Date.now() };
      return token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const cfg = getTermAdminConfig();
  // `path` es relative al context `/service` de nginx (nginx lo reescribe a `/`).
  const u = new URL(`${cfg.url}/service${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export async function termRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, opts.query);
  const method = opts.method ?? 'GET';

  const doCall = async (token: string) => {
    const headers: Record<string, string> = { authorization: token };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return request(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });
  };

  let token = await getToken();
  let res;
  try {
    res = await doCall(token);
  } catch (err) {
    throw new UpstreamError(
      'term_admin no respondió',
      503,
      'UPSTREAM_UNREACHABLE',
      err instanceof Error ? err.message : err,
    );
  }

  if (res.statusCode === 401) {
    clearCache();
    token = await getToken();
    try {
      res = await doCall(token);
    } catch (err) {
      throw new UpstreamError(
        'term_admin no respondió (retry)',
        503,
        'UPSTREAM_UNREACHABLE',
        err instanceof Error ? err.message : err,
      );
    }
    if (res.statusCode === 401) {
      throw new UpstreamError(
        'term_admin rechazó las credenciales',
        502,
        'UPSTREAM_AUTH_FAILED',
      );
    }
  }

  if (res.statusCode >= 500) {
    const text = await res.body.text();
    throw new UpstreamError(
      `term_admin error ${res.statusCode}`,
      503,
      'UPSTREAM_5XX',
      text,
    );
  }
  if (res.statusCode === 404) {
    throw new UpstreamError(
      `term_admin no expone ${method} ${path}`,
      404,
      'UPSTREAM_NOT_FOUND',
    );
  }
  if (res.statusCode >= 400) {
    const data = (await res.body.json().catch(() => ({}))) as Record<string, unknown>;
    throw new UpstreamError(
      typeof data.message === 'string' ? data.message : `term_admin ${res.statusCode}`,
      res.statusCode,
      'UPSTREAM_4XX',
      data,
    );
  }

  // term_admin a veces devuelve 200 con body vacío en mutaciones — toleramos.
  const text = await res.body.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(
      `Respuesta upstream no es JSON válido`,
      502,
      'UPSTREAM_BAD_JSON',
      text.slice(0, 500),
    );
  }
}

export async function pingTermAdmin(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const cfg = getTermAdminConfig();
  try {
    const res = await request(`${cfg.url}/service/api/openApi/version`, {
      method: 'GET',
      headersTimeout: 4000,
      bodyTimeout: 4000,
    });
    if (res.statusCode !== 200) {
      return { ok: false, error: `HTTP ${res.statusCode}` };
    }
    const body = (await res.body.json()) as { code: number; data?: string };
    if (body.code !== 0) return { ok: false, error: 'unexpected body' };
    return { ok: true, version: body.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fuerza un nuevo login en la próxima llamada. Se usa cuando el operador cambia
 * las credenciales o la URL de term_admin desde la pantalla de configuración.
 */
export function invalidateUpstreamToken(): void {
  clearCache();
  lastLoginAttemptAt = 0;
}
