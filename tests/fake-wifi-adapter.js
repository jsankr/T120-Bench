/* Test stand-in for a WiFi ELM327 dongle: raw TCP on a port, backed by a separate simulated bike. */
const net = require('net'), T = require('../src/core.js');
const bike = new T.Twin(); bike.vin = 'SMTWIFIBIKE000001'; bike.warm(75); bike.start();
setInterval(() => bike.step(0.02), 20);
net.createServer(sock => {
  let buf = ''; sock.setNoDelay(true);
  sock.on('data', d => { buf += d.toString(); let i; while ((i = buf.indexOf('\r')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const r = (bike.elm.echo ? line + '\r' : '') + bike.command(line) + '\r\r>'; const h = Math.ceil(r.length / 2); sock.write(r.slice(0, h)); setTimeout(() => sock.writable && sock.write(r.slice(h)), 3); } });
  sock.on('error', () => { });
}).listen(+process.argv[2] || 35000, '127.0.0.1', () => console.log('fake adapter up'));
