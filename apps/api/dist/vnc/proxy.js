import net from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
import { config } from '../config.js';
import { consumeTicket } from '../routes/vnc.js';
import { getWebsockifyConfig } from '../db/settings.js';
const MAX_CONCURRENT_VNC_SESSIONS = 4;
const MAX_PENDING_CLIENT_BYTES = 1024 * 1024;
const WS_BACKPRESSURE_HIGH_WATER = 8 * 1024 * 1024;
const WS_BACKPRESSURE_LOW_WATER = 2 * 1024 * 1024;
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
const tcpSockets = new Set();
const closeSessionHandlers = new Set();
export function closeVncConnections() {
    for (const closeSession of closeSessionHandlers)
        closeSession();
    for (const client of wss.clients)
        client.close(1001, 'Servidor apagándose');
    for (const socket of tcpSockets)
        socket.destroy();
}
const insertSession = db.prepare(`
  INSERT INTO vnc_sessions (user_id, username, term_id, ip, client_ip, request_id, started_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`);
const endSession = db.prepare(`
  UPDATE vnc_sessions
  SET ended_at = datetime('now'), ended_reason = ?, bytes_up = ?, bytes_down = ?
  WHERE id = ?
`);
function rejectUpgrade(socket, status, message) {
    const reason = message.replace(/[\r\n]/g, ' ');
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
}
function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        const first = fwd.split(',')[0];
        return first ? first.trim() : '';
    }
    return req.socket.remoteAddress ?? '';
}
export function handleVncUpgrade(req, socket, head) {
    const url = req.url ?? '';
    if (!url.startsWith('/api/vnc/ws'))
        return false;
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname !== '/api/vnc/ws')
        return false;
    const origin = req.headers.origin;
    const allowedOrigins = config.corsOrigin.split(',').map((value) => value.trim());
    if (!origin || !allowedOrigins.includes(origin)) {
        rejectUpgrade(socket, 403, 'Origin not allowed');
        return true;
    }
    if (wss.clients.size >= MAX_CONCURRENT_VNC_SESSIONS) {
        rejectUpgrade(socket, 503, 'VNC session limit reached');
        return true;
    }
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
        startProxy(clientWs, ticket, getClientIp(req), req.headers['x-request-id'] ?? null);
    });
    return true;
}
function startProxy(clientWs, ticket, clientIp, requestId) {
    const cfg = getWebsockifyConfig();
    // El puerto viene resuelto en el ticket (override por balanza o valor global).
    const vncPort = ticket.port || cfg.vncPort || 5900;
    const sessionRow = insertSession.run(ticket.userId, ticket.username, ticket.termId, ticket.ip, clientIp, requestId);
    const sessionId = Number(sessionRow.lastInsertRowid);
    const logBase = { sessionId, termId: ticket.termId, ip: ticket.ip, vncPort, user: ticket.username };
    logger.info(logBase, 'VNC: abriendo túnel TCP directo');
    const tcpSocket = net.connect({ host: ticket.ip, port: vncPort });
    tcpSockets.add(tcpSocket);
    tcpSocket.setNoDelay(true);
    tcpSocket.setTimeout(10_000);
    let bytesUp = 0;
    let bytesDown = 0;
    let closedReason = null;
    let lastActivity = Date.now();
    const startedAt = Date.now();
    const pendingFromClient = [];
    let pendingClientBytes = 0;
    let tcpReady = false;
    function finish(reason) {
        if (closedReason)
            return;
        closedReason = reason;
        closeSessionHandlers.delete(onServerShutdown);
        try {
            endSession.run(reason, bytesUp, bytesDown, sessionId);
        }
        catch (err) {
            logger.warn({ ...logBase, err }, 'VNC: no se pudo cerrar sesión en DB');
        }
        logger.info({ ...logBase, reason, bytesUp, bytesDown }, 'VNC: sesión cerrada');
        try {
            if (clientWs.readyState === WebSocket.OPEN)
                clientWs.close(1000, reason);
        }
        catch {
            /* ignore */
        }
        try {
            if (!tcpSocket.destroyed)
                tcpSocket.destroy();
        }
        catch {
            /* ignore */
        }
        clearInterval(watchdog);
    }
    const onServerShutdown = () => finish('server_shutdown');
    closeSessionHandlers.add(onServerShutdown);
    tcpSocket.on('connect', () => {
        tcpReady = true;
        tcpSocket.setTimeout(0);
        logger.info(logBase, 'VNC: conectado a balanza por TCP');
        flushPendingClientData();
    });
    function flushPendingClientData() {
        while (tcpReady && pendingFromClient.length > 0 && !tcpSocket.destroyed) {
            const chunk = pendingFromClient.shift();
            if (!chunk)
                continue;
            pendingClientBytes -= chunk.length;
            bytesUp += chunk.length;
            if (!tcpSocket.write(chunk)) {
                clientWs.pause();
                return;
            }
        }
        clientWs.resume();
    }
    tcpSocket.on('drain', flushPendingClientData);
    tcpSocket.on('close', () => tcpSockets.delete(tcpSocket));
    tcpSocket.on('timeout', () => {
        logger.warn(logBase, 'VNC: timeout conectando al puerto 5900 de la balanza');
        finish('tcp_connect_timeout');
    });
    tcpSocket.on('data', (chunk) => {
        lastActivity = Date.now();
        if (clientWs.readyState !== WebSocket.OPEN)
            return;
        bytesDown += chunk.length;
        clientWs.send(chunk, { binary: true }, (err) => {
            if (err) {
                finish('websocket_send_error');
                return;
            }
            if (tcpSocket.isPaused() && clientWs.bufferedAmount <= WS_BACKPRESSURE_LOW_WATER) {
                tcpSocket.resume();
            }
        });
        if (clientWs.bufferedAmount >= WS_BACKPRESSURE_HIGH_WATER)
            tcpSocket.pause();
    });
    tcpSocket.on('close', (hadError) => {
        finish(hadError ? 'tcp_close_error' : 'tcp_close');
    });
    tcpSocket.on('error', (err) => {
        logger.warn({ ...logBase, err: err.message }, 'VNC: error TCP hacia balanza');
        // El motivo viaja en el close frame para que el frontend pueda explicar
        // por qué falló (p. ej. la balanza no tiene el servicio VNC encendido).
        const code = err.code;
        const reason = code === 'ECONNREFUSED'
            ? 'vnc_refused: la balanza rechazó la conexión (no hay servicio VNC en ese puerto)'
            : code === 'ETIMEDOUT'
                ? 'vnc_timeout: la balanza no respondió en el puerto configurado'
                : `tcp_error:${err.message.slice(0, 60)}`;
        finish(reason);
    });
    clientWs.on('message', (data) => {
        lastActivity = Date.now();
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (!tcpReady) {
            pendingClientBytes += buf.length;
            if (pendingClientBytes > MAX_PENDING_CLIENT_BYTES) {
                finish('pending_client_data_limit');
                return;
            }
            pendingFromClient.push(buf);
            return;
        }
        if (!tcpSocket.destroyed) {
            bytesUp += buf.length;
            if (!tcpSocket.write(buf))
                clientWs.pause();
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
//# sourceMappingURL=proxy.js.map