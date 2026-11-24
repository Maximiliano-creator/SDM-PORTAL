import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import net from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
import { consumeTicket, type VncTicket } from '../routes/vnc.js';
import { getWebsockifyConfig } from '../db/settings.js';

const wss = new WebSocketServer({ noServer: true });

const insertSession = db.prepare(`
  INSERT INTO vnc_sessions (user_id, username, term_id, ip, client_ip, request_id, started_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`);
const endSession = db.prepare(`
  UPDATE vnc_sessions
  SET ended_at = datetime('now'), ended_reason = ?, bytes_up = ?, bytes_down = ?
  WHERE id = ?
`);

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const reason = message.replace(/[\r\n]/g, ' ');
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    const first = fwd.split(',')[0];
    return first ? first.trim() : '';
  }
  return req.socket.remoteAddress ?? '';
}

export function handleVncUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const url = req.url ?? '';
  if (!url.startsWith('/api/vnc/ws')) return false;

  const parsed = new URL(url, 'http://localhost');
  const ticketParam = parsed.searchParams.get('ticket');
  if (!ticketParam) {
    rejectUpgrade(socket, 400, 'Missing ticket');
    return true;
  }
  const ticket = consumeTicket(ticketParam);
  if (!ticket) {
    rejectUpgrade(socket, 401, 'Ticket inválido o expirado');
    return true;
  }

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    startProxy(clientWs, ticket, getClientIp(req), (req.headers['x-request-id'] as string) ?? null);
  });
  return true;
}

function startProxy(
  clientWs: WebSocket,
  ticket: VncTicket,
  clientIp: string,
  requestId: string | null,
): void {
  const cfg = getWebsockifyConfig();
  // El puerto viene resuelto en el ticket (override por balanza o valor global).
  const vncPort = ticket.port || cfg.vncPort || 5900;

  const sessionRow = insertSession.run(
    ticket.userId,
    ticket.username,
    ticket.termId,
    ticket.ip,
    clientIp,
    requestId,
  );
  const sessionId = Number(sessionRow.lastInsertRowid);
  const logBase = { sessionId, termId: ticket.termId, ip: ticket.ip, vncPort, user: ticket.username };
  logger.info(logBase, 'VNC: abriendo túnel TCP directo');

  const tcpSocket = net.connect({ host: ticket.ip, port: vncPort });
  tcpSocket.setNoDelay(true);
  tcpSocket.setTimeout(10_000);

  let bytesUp = 0;
  let bytesDown = 0;
  let closedReason: string | null = null;
  let lastActivity = Date.now();
  const startedAt = Date.now();
  const pendingFromClient: Buffer[] = [];
  let tcpReady = false;

  function finish(reason: string): void {
    if (closedReason) return;
    closedReason = reason;
    try {
      endSession.run(reason, bytesUp, bytesDown, sessionId);
    } catch (err) {
      logger.warn({ ...logBase, err }, 'VNC: no se pudo cerrar sesión en DB');
    }
    logger.info({ ...logBase, reason, bytesUp, bytesDown }, 'VNC: sesión cerrada');
    try {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, reason);
    } catch {
      /* ignore */
    }
    try {
      if (!tcpSocket.destroyed) tcpSocket.destroy();
    } catch {
      /* ignore */
    }
    clearInterval(watchdog);
  }

  tcpSocket.on('connect', () => {
    tcpReady = true;
    tcpSocket.setTimeout(0);
    logger.info(logBase, 'VNC: conectado a balanza por TCP');
    while (pendingFromClient.length > 0) {
      const chunk = pendingFromClient.shift();
      if (chunk && !tcpSocket.destroyed) {
        bytesUp += chunk.length;
        tcpSocket.write(chunk);
      }
    }
  });

  tcpSocket.on('timeout', () => {
    logger.warn(logBase, 'VNC: timeout conectando al puerto 5900 de la balanza');
    finish('tcp_connect_timeout');
  });

  tcpSocket.on('data', (chunk: Buffer) => {
    lastActivity = Date.now();
    if (clientWs.readyState !== WebSocket.OPEN) return;
    bytesDown += chunk.length;
    clientWs.send(chunk, { binary: true });
  });

  tcpSocket.on('close', (hadError) => {
    finish(hadError ? 'tcp_close_error' : 'tcp_close');
  });

  tcpSocket.on('error', (err) => {
    logger.warn({ ...logBase, err: err.message }, 'VNC: error TCP hacia balanza');
    // El motivo viaja en el close frame para que el frontend pueda explicar
    // por qué falló (p. ej. la balanza no tiene el servicio VNC encendido).
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      code === 'ECONNREFUSED'
        ? 'vnc_refused: la balanza rechazó la conexión (no hay servicio VNC en ese puerto)'
        : code === 'ETIMEDOUT'
          ? 'vnc_timeout: la balanza no respondió en el puerto configurado'
          : `tcp_error:${err.message.slice(0, 60)}`;
    finish(reason);
  });

  clientWs.on('message', (data) => {
    lastActivity = Date.now();
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
    if (!tcpReady) {
      pendingFromClient.push(buf);
      return;
    }
    if (!tcpSocket.destroyed) {
      bytesUp += buf.length;
      tcpSocket.write(buf);
    }
  });

  clientWs.on('close', (code, reason) => {
    finish(`client_close:${code}:${reason.toString().slice(0, 60)}`);
  });

  clientWs.on('error', (err) => {
    logger.warn({ ...logBase, err: err.message }, 'VNC: error cliente');
    finish('client_error');
  });

  const watchdog = setInterval(() => {
    const now = Date.now();
    if (now - lastActivity > cfg.idleTimeoutMs) {
      finish('idle_timeout');
      return;
    }
    if (now - startedAt > cfg.maxSessionMs) {
      finish('max_session');
    }
  }, 5_000);
}
