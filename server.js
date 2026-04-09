/**
 * PITWALL — server.js
 *
 * AC UDP Remote Telemetry protocol (reverse-engineered spec):
 *   https://docs.google.com/document/d/1KfkZiIluXZ6mMhLWfDX1qAGbvhGRC3ZUzjVIt5FQpp4/pub
 *
 * Packet sizes (used to identify type — there is no type byte):
 *   408 bytes → HandshakeResponse  (UTF-16LE strings: carName, driverName, trackName, trackConfig)
 *   328 bytes → RTCarInfo          (continuous physics stream after SUBSCRIBE_UPDATE)
 *   212 bytes → RTLap              (emitted once per lap completion)
 */

const dgram   = require('dgram');
const express = require('express');
const { WebSocketServer } = require('ws');
const http    = require('http');
const os      = require('os');
const path    = require('path');
const { exec } = require('child_process');

// ── Ports ─────────────────────────────────────────────────────────────────────
const AC_HOST   = '127.0.0.1'; // AC runs on the same PC
const AC_PORT   = 9996;        // AC listens here for handshake/subscribe/dismiss
const MY_PORT   = 9997;        // We bind here; AC replies to the source port of our handshake
const HTTP_PORT = 3000;

// ── Express + HTTP ────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] Cliente conectado');
  ws.on('close', () => console.log('[WS] Cliente desconectado'));
});

// ── AC handshake helpers ──────────────────────────────────────────────────────
// Outgoing packet: 3 × Int32LE = 12 bytes
//   [0]  identifier / device type
//          0 = eIPhoneDevice  ← use 0; some AC builds ignore non-zero identifiers
//          1 = eIPadDevice
//   [4]  version  (1)
//   [8]  operationId  (0=HANDSHAKE, 1=SUBSCRIBE_UPDATE, 2=SUBSCRIBE_SPOT, 3=DISMISS)

function buildPacket(operationId) {
  const buf = Buffer.alloc(12);
  buf.writeInt32LE(0, 0); // identifier: 0 (eIPhoneDevice — most compatible)
  buf.writeInt32LE(1, 4); // version: 1
  buf.writeInt32LE(operationId, 8);
  return buf;
}

function sendToAC(operationId, label) {
  const pkt = buildPacket(operationId);
  udp.send(pkt, 0, pkt.length, AC_PORT, AC_HOST, (err) => {
    if (err) console.error(`[AC] Error enviando ${label}:`, err.message);
    else     console.log(`[AC] → ${label}`);
  });
}

const handshake      = () => sendToAC(0, 'HANDSHAKE');
const subscribeUpdate = () => sendToAC(1, 'SUBSCRIBE_UPDATE');
const dismiss        = () => sendToAC(3, 'DISMISS');

// ── RTCarInfo parser (328 bytes) ──────────────────────────────────────────────
// Source: RTCarInfoParser.js from ac-remote-telemetry-client
//
//   Offset  Field           Type
//   0       identifier      string 4 bytes (UTF-16LE, 2 chars — ignored)
//   4       size            int32LE        — ignored
//   8       speedKmh        float32LE
//   12      speedMph        float32LE      — ignored
//   16      speedMs         float32LE      — ignored
//   20      isAbsEnabled    int8
//   21      isAbsInAction   int8
//   22      isTcInAction    int8
//   23      isTcEnabled     int8
//   24      isInPit         int8
//   25      isEngineLimiterOn int8
//   26-27   padding (2 bytes)
//   28      accGVertical    float32LE      — ignored
//   32      accGHorizontal  float32LE      — ignored
//   36      accGFrontal     float32LE      — ignored
//   40      lapTime         int32LE  (ms)
//   44      lastLap         int32LE  (ms)
//   48      bestLap         int32LE  (ms)
//   52      lapCount        int32LE
//   56      gas             float32LE  (0-1)
//   60      brake           float32LE  (0-1)
//   64      clutch          float32LE  — ignored
//   68      engineRPM       float32LE
//   72      steer           float32LE
//   76      gear            int32LE  (0=R, 1=N, 2=1st …)
//   80+     wheel/tyre dynamics data — ignored here

function parseRTCarInfo(buf) {
  return {
    speed:      buf.readFloatLE(8),
    rpms:       buf.readFloatLE(68),
    gear:       buf.readInt32LE(76),
    throttle:   buf.readFloatLE(56),
    brake:      buf.readFloatLE(60),
    steerAngle: buf.readFloatLE(72),
    lapTime:    buf.readInt32LE(40),   // int32, not float
    lastLap:    buf.readInt32LE(44),
    bestLap:    buf.readInt32LE(48),
    lapCount:   buf.readInt32LE(52),
    isInPit:    buf.readInt8(24),
    // Tyre temps not available via UDP; front-end receives null
    tyreTempFL: null,
    tyreTempFR: null,
    tyreTempRL: null,
    tyreTempRR: null,
  };
}

// ── RTLap parser (212 bytes) ──────────────────────────────────────────────────
// Emitted once per lap completion.
//   0    carIdentifierNumber  int32LE
//   4    lap                  int32LE
//   8    driverName           100 bytes UTF-16LE
//   108  carName              100 bytes UTF-16LE
//   208  time                 int32LE  (ms)

function parseRTLap(buf) {
  return {
    lap:        buf.readInt32LE(4),
    lapTime:    buf.readInt32LE(208),
    driverName: buf.slice(8,  108).toString('utf16le').replace(/\0/g, '').trim(),
    carName:    buf.slice(108, 208).toString('utf16le').replace(/\0/g, '').trim(),
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
let lastDataAt  = 0;
let retryTimer  = null;
let subscribed  = false;
let logCounter  = 0;

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (Date.now() - lastDataAt > 4000) {
      console.log('[AC] Sin datos — reenviando handshake...');
      subscribed = false;
      handshake();
    }
    scheduleRetry();
  }, 5000);
}

// ── UDP socket ────────────────────────────────────────────────────────────────
const udp = dgram.createSocket('udp4');

udp.on('message', (msg, rinfo) => {
  const len = msg.length;
  const hex4 = msg.slice(0, Math.min(16, len)).toString('hex').match(/.{2}/g).join(' ');
  console.log(`[UDP] ← ${rinfo.address}:${rinfo.port}  ${len} bytes  [${hex4}${len > 16 ? '…' : ''}]`);

  if (len === 408) {
    // HandshakeResponse — AC accepted our greeting; now subscribe to live data
    const carName = msg.slice(0,   100).toString('utf16le').replace(/\0/g, '').trim();
    const track   = msg.slice(208, 308).toString('utf16le').replace(/\0/g, '').trim();
    console.log(`[AC] HandshakeResponse — car: "${carName}"  track: "${track}"`);
    subscribeUpdate();
    subscribed = true;
    return;
  }

  if (len === 328) {
    // RTCarInfo — continuous physics stream
    logCounter++;
    try {
      const data = parseRTCarInfo(msg);
      if (logCounter % 60 === 0) {
        console.log('[AC] Raw offsets →',
          'spd@8:',   msg.readFloatLE(8) .toFixed(1),
          'rpm@68:',  msg.readFloatLE(68).toFixed(0),
          'gear@76:', msg.readInt32LE(76),
        );
        console.log('[AC] Physics:', JSON.stringify(data));
      }
      lastDataAt = Date.now();
      broadcast(data);
    } catch (e) {
      console.error('[AC] Error parseando RTCarInfo:', e.message);
    }
    return;
  }

  if (len === 212) {
    // RTLap — lap completed
    try {
      const lap = parseRTLap(msg);
      console.log(`[AC] Vuelta ${lap.lap} completada: ${lap.lapTime} ms`);
      broadcast({ _lapCompleted: lap });
    } catch (e) { /* ignore */ }
    return;
  }

  // Unknown size — already logged with hex dump above
});

udp.on('error', (err) => {
  console.error('[UDP] Error:', err.message);
});

// ── Firewall rule (Windows) ───────────────────────────────────────────────────
// Add an inbound UDP rule so Windows doesn't silently drop AC's reply packets.
// Requires admin rights; if the process isn't elevated the command will fail
// silently — user will see a one-time UAC prompt or error in the log.
const fwCmd = [
  'netsh advfirewall firewall add rule',
  'name="PITWALL-UDP"',
  'protocol=UDP',
  'dir=in',
  `localport=${MY_PORT}`,
  'action=allow',
].join(' ');

exec(fwCmd, (err, stdout, stderr) => {
  if (err) {
    console.warn(`[FW] No se pudo agregar regla de firewall (¿sin admin?): ${stderr.trim() || err.message}`);
  } else {
    console.log(`[FW] Regla firewall UDP ${MY_PORT} entrada: OK`);
  }
});

udp.bind(MY_PORT, '0.0.0.0', () => {
  const addr = udp.address();
  console.log(`[UDP] Bindeado en ${addr.address}:${addr.port}`);
  handshake();
  scheduleRetry();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown() {
  console.log('\n[AC] Cerrando — enviando DISMISS a AC...');
  clearTimeout(retryTimer);
  try { dismiss(); } catch (_) {}
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ── HTTP + WS ─────────────────────────────────────────────────────────────────
server.listen(HTTP_PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  let localIP = 'localhost';
  outer: for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break outer; }
    }
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║            PITWALL — Telemetría AC               ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Dashboard : http://${localIP}:${HTTP_PORT}            ║`);
  console.log(`║  UDP bind  : 0.0.0.0:${MY_PORT}                      ║`);
  console.log(`║  UDP → AC  : ${AC_HOST}:${AC_PORT} (handshake)    ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Si AC no responde, verificar en Windows:        ║');
  console.log(`║    Firewall → permitir puerto UDP ${MY_PORT} entrada  ║`);
  console.log('║    Content Manager → Settings → General →        ║');
  console.log('║      enable "Remote Telemetry"                   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Abre en el iPad: http://${localIP}:${HTTP_PORT}`);
  console.log('');
});
