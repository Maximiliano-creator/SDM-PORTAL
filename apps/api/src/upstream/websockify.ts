import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';
import { getWebsockifyConfig } from '../db/settings.js';

const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;

export function isValidIp(ip: string): boolean {
  if (!ipPattern.test(ip)) return false;
  return ip.split('.').every((p) => {
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

let writeLock: Promise<void> = Promise.resolve();

/**
 * Registra la balanza en el token file de websockify.
 *
 * Formato (idéntico al que escribe term_admin en
 * `SysConfigServiceImpl.getNovncAddress`):
 *
 *     <token>: <destino-ip>:<destino-puerto>
 *
 * El token es la IP de la balanza y el destino es la misma balanza en el puerto
 * VNC configurado. `websockify` resuelve el destino al recibir el token.
 *
 * Nota: term_admin también escribe este archivo (es el fuente de verdad) por lo
 * que esta función actúa como red de seguridad cuando la llamada upstream no
 * está disponible.
 */
export async function ensureTokenForIp(ip: string, port?: number): Promise<void> {
  if (!isValidIp(ip)) {
    throw new Error(`IP inválida: ${ip}`);
  }
  const cfg = getWebsockifyConfig();
  const vncPort = port && port > 0 ? port : cfg.vncPort;
  const expected = `${ip}: ${ip}:${vncPort}`;

  // Serialize concurrent writers to avoid lost-update on token.conf
  const prev = writeLock;
  let release: () => void = () => {};
  writeLock = new Promise<void>((res) => {
    release = res;
  });
  try {
    await prev;
    let lines: string[] = [];
    if (existsSync(cfg.tokenFile)) {
      const raw = readFileSync(cfg.tokenFile, 'utf-8');
      lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } else {
      mkdirSync(dirname(cfg.tokenFile), { recursive: true });
    }

    const expectedPrefix = `${ip}:`;
    const existingIdx = lines.findIndex((l) => l.startsWith(expectedPrefix));
    if (existingIdx >= 0 && lines[existingIdx] === expected) {
      return;
    }
    if (existingIdx >= 0) {
      lines[existingIdx] = expected;
    } else {
      lines.push(expected);
    }
    writeFileSync(cfg.tokenFile, lines.join('\r\n') + '\r\n', { encoding: 'ascii' });
    logger.info({ ip, port: vncPort, tokenFile: cfg.tokenFile }, 'websockify token.conf actualizado');
  } finally {
    release();
  }
}

/**
 * Indica si una balanza ya está registrada en el token file.
 */
export function isTokenRegistered(ip: string): boolean {
  const cfg = getWebsockifyConfig();
  if (!existsSync(cfg.tokenFile)) return false;
  const raw = readFileSync(cfg.tokenFile, 'utf-8');
  return raw.split(/\r?\n/).some((l) => l.trim().startsWith(`${ip}:`));
}

export function buildUpstreamWsUrl(ip: string): string {
  const cfg = getWebsockifyConfig();
  const sep = cfg.url.includes('?') ? '&' : '?';
  return `${cfg.url}${sep}token=${encodeURIComponent(ip)}`;
}
