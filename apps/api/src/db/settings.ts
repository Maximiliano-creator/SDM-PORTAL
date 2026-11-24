import { db } from './client.js';
import { config } from '../config.js';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

const stmts = {
  get: db.prepare<[string], SettingRow>('SELECT * FROM app_settings WHERE key = ? LIMIT 1'),
  upsert: db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ),
  all: db.prepare<[], SettingRow>('SELECT * FROM app_settings'),
};

export function getSetting(key: string): string | null {
  const row = stmts.get.get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  stmts.upsert.run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = stmts.all.all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export interface TermAdminConfig {
  url: string;
  username: string;
  password: string;
}

export function getTermAdminConfig(): TermAdminConfig {
  // Precedencia: valor guardado desde la pantalla de Configuración (app_settings)
  // > variables de entorno del despliegue (.env). Antes el .env se ignoraba por
  // completo, lo que hacía imposible reconfigurar el upstream sin tocar la BD.
  return {
    url: getSetting('term_admin.url') ?? config.termAdminUrl,
    username: getSetting('term_admin.username') ?? config.termAdminUsername,
    password: getSetting('term_admin.password') ?? config.termAdminPassword,
  };
}

export interface WebsockifyConfig {
  url: string;
  tokenFile: string;
  vncPort: number;
  idleTimeoutMs: number;
  maxSessionMs: number;
}

export function getWebsockifyConfig(): WebsockifyConfig {
  return {
    url: getSetting('websockify.url') ?? 'ws://localhost:9000/websockify/',
    tokenFile: getSetting('websockify.token_file') ?? 'C:\\sdm\\term_admin\\websockify\\token.conf',
    vncPort: Number(getSetting('vnc.port') ?? '5900') || 5900,
    idleTimeoutMs: Number(getSetting('vnc.idle_timeout_ms') ?? '300000') || 300_000,
    maxSessionMs: Number(getSetting('vnc.max_session_ms') ?? '1800000') || 1_800_000,
  };
}

/**
 * Puerto VNC de una balanza concreta.
 *
 * La balanza expone su servicio de Control Remoto en un puerto configurable desde
 * su propio módulo "Servicios Locales → Control Remoto". El portal no puede
 * adivinarlo, así que se resuelve por orden de precedencia:
 *   1. `vnc.port.<termId>`  → override por balanza (desde Configuración)
 *   2. `vnc.port`          → puerto global por defecto (5900)
 */
export function getVncPortForScale(termId: number): number {
  const perScale = Number(getSetting(`vnc.port.${termId}`) ?? '');
  if (Number.isInteger(perScale) && perScale > 0 && perScale < 65536) return perScale;
  return getWebsockifyConfig().vncPort;
}
