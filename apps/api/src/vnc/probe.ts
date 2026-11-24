import net from 'node:net';

export type ProbeFailureReason = 'refused' | 'timeout' | 'unreachable' | 'error';

export interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
  reason?: ProbeFailureReason;
  message?: string;
}

/**
 * Comprueba que exista algo escuchando en `host:port`.
 *
 * La diferencia entre "conexión rechazada" y "timeout" es la que permite
 * distinguir "la balanza no tiene el servicio VNC encendido" de "hay un
 * firewall filtrando el puerto", dos fallas que se corrigen distinto.
 */
export function probeTcp(host: string, port: number, timeoutMs = 3000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.connect({ host, port });
    let settled = false;

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finish({ ok: true, latencyMs: Date.now() - startedAt });
    });
    socket.once('timeout', () => {
      finish({
        ok: false,
        reason: 'timeout',
        message:
          `No hay respuesta desde ${host}:${port} en ${timeoutMs} ms. ` +
          'El puerto está filtrado por firewall o la balanza está apagada.',
      });
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        finish({
          ok: false,
          reason: 'refused',
          message:
            `${host}:${port} rechazó la conexión: no hay ningún servicio escuchando en ese puerto. ` +
            'Activá el servicio de Control Remoto en la balanza y verificá el puerto configurado.',
        });
        return;
      }
      if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
        finish({
          ok: false,
          reason: 'unreachable',
          message: `${host} no es alcanzable desde el servidor del portal (red o VLAN).`,
        });
        return;
      }
      finish({
        ok: false,
        reason: 'error',
        message: `Error conectando a ${host}:${port}: ${err.message}`,
      });
    });
  });
}
