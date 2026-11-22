#!/usr/bin/env node
/* T120 Bench WiFi bridge.
   WiFi OBD adapters speak raw TCP (usually 192.168.0.10:35000). Browsers cannot open raw TCP,
   so this small program relays between a WebSocket the page can open and the adapter's TCP port.
   It also serves t120-bench.html from the same folder, so you can open http://localhost:8765/.

   Usage:  node t120-wifi-bridge.js [--adapter 192.168.0.10:35000] [--port 8765] [--lan]
                                    [--allow-origin https://you.github.io]
   --lan            listen on all interfaces so a phone on the same network can open the page
   --allow-origin   let a page hosted elsewhere (for example GitHub Pages) use the bridge
   No dependencies. Needs Node 16 or newer. */
'use strict';
const http = require('http'), net = require('net'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const [aHost, aPort] = arg('adapter', '192.168.0.10:35000').split(':');
const port = +arg('port', 8765), lan = process.argv.includes('--lan'), host = lan ? '0.0.0.0' : '127.0.0.1';
const extra = process.argv.map((v, i) => process.argv[i - 1] === '--allow-origin' ? v.replace(/\/$/, '') : null).filter(Boolean);
const page = [path.join(__dirname, 't120-bench.html'), path.join(__dirname, '..', 'index.html')].find(f => fs.existsSync(f)) || path.join(__dirname, 't120-bench.html');
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function originOk(req) {
  const o = req.headers.origin; if (!o) return false;
  if (extra.includes(o)) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; } /* same origin: the page this bridge served */
}
function frame(op, payload) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}
const closeFrame = (code, reason) => { const r = Buffer.from(String(reason).slice(0, 110)); const b = Buffer.alloc(2 + r.length); b.writeUInt16BE(code, 0); r.copy(b, 2); return frame(8, b); };

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/t120-bench.html')) {
    fs.readFile(page, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Put t120-bench.html next to t120-wifi-bridge.js to serve the app from here.'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(data);
    });
  } else if (req.url === '/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ bridge: 't120', adapter: aHost + ':' + aPort, busy: !!active })); }
  else { res.writeHead(404); res.end(); }
});
let active = null;
server.on('upgrade', (req, sock) => {
  const deny = (code, msg) => { sock.write('HTTP/1.1 ' + code + '\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n' + msg); sock.destroy(); };
  if (req.url !== '/elm' || (req.headers.upgrade || '').toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) return deny('400 Bad Request', 'WebSocket endpoint is /elm');
  if (!originOk(req)) { log('refused page origin', req.headers.origin || '(none)', '- add --allow-origin to permit it'); return deny('403 Forbidden', 'Origin not allowed'); }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const up = () => sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  if (active) { up(); sock.write(closeFrame(4002, 'Another page is already using the adapter')); return sock.end(); }
  const tcp = net.connect({ host: aHost, port: +aPort }); let ready = false, closed = false; active = sock; tcp.setNoDelay(true); sock.setNoDelay(true);
  const timer = setTimeout(() => tcp.destroy(new Error('timed out')), 5000);
  const end = (code, reason) => { if (closed) return; closed = true; clearTimeout(timer); if (active === sock) active = null; try { if (!ready) up(); sock.write(closeFrame(code, reason)); sock.end(); } catch (e) { } tcp.destroy(); log('session ended:', reason); };
  tcp.on('connect', () => { clearTimeout(timer); ready = true; up(); log('page', req.headers.origin, 'linked to adapter', aHost + ':' + aPort); });
  tcp.on('data', d => { if (!closed) sock.write(frame(1, Buffer.from(d.toString('latin1'), 'utf8'))); });
  tcp.on('error', e => end(4001, 'Adapter at ' + aHost + ':' + aPort + ' unreachable (' + e.message + '). Join the adapter WiFi network first.'));
  tcp.on('close', () => end(4003, 'Adapter closed the connection'));
  let buf = Buffer.alloc(0);
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return; const op = buf[0] & 15, masked = buf[1] & 128; let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) return end(1009, 'Frame too large');
      const need = off + (masked ? 4 : 0) + len; if (buf.length < need) return;
      let data = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
      buf = buf.subarray(need);
      if (op === 8) return end(1000, 'Page disconnected');
      if (op === 9) sock.write(frame(10, data));
      else if ((op === 1 || op === 2 || op === 0) && ready) tcp.write(data);
    }
  });
  sock.on('close', () => end(1000, 'Page disconnected')); sock.on('error', () => end(1000, 'Page connection error'));
});
server.on('error', e => { console.error('Cannot listen on port ' + port + ': ' + e.message); process.exit(1); });
server.listen(port, host, () => {
  log('T120 WiFi bridge ready');
  console.log('  1. Join this computer to the adapter WiFi network (adapter expected at ' + aHost + ':' + aPort + ')');
  console.log('  2. Open http://localhost:' + port + '/ and choose WiFi in Connect' + (lan ? '\n     Phones on the same network: http://<this computer\'s IP>:' + port + '/' : ''));
  if (extra.length) console.log('  Extra allowed page origins: ' + extra.join(', '));
});
