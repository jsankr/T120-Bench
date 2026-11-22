# Shared browser-test helpers: a fake BLE ELM327 adapter backed by a separate simulated bike.
FAKE_BLE = r"""
window.__ble = Object.assign({ mode: 'ok', chunk: 20, latency: 12, silent: false, searching: true, writes: 0, maxChunk: 0 }, window.__bleCfg || {});
navigator.bluetooth = { requestDevice: async (opts) => {
  const cfg = window.__ble; cfg.opts = opts;
  if (cfg.mode === 'cancel') { const e = new Error('User cancelled the requestDevice() chooser.'); e.name = 'NotFoundError'; throw e; }
  const bike = cfg.bike = new T120.Twin(); bike.noCount = !!cfg.nofast; bike.vin = 'SMTTESTBIKE000001'; bike.warm(70);
  if (cfg.mode === 'ignoff') bike.setIgnition(false); else bike.start();
  let t = 0; setInterval(() => { t += 0.02; if (!cfg.hold) bike.ctl.grip = bike.s.run ? 8 + 8 * Math.sin(t) : 0; bike.step(0.02); }, 20);
  const dl = []; let connected = false;
  const mk = (uuid, props) => { const l = []; return { uuid, properties: props, addEventListener: (ty, f) => l.push(f), startNotifications: async () => {}, _emit: bytes => l.forEach(f => f({ target: { value: new DataView(bytes.buffer) } })) }; };
  const rx = mk('fff1', { notify: true }), tx = mk('fff2', { writeWithoutResponse: true, write: true });
  let buf = '', q = Promise.resolve();
  tx.writeValueWithoutResponse = async chunk => {
    cfg.writes++; cfg.maxChunk = Math.max(cfg.maxChunk, chunk.byteLength); if (chunk.byteLength > 20) throw new Error('GATT write over 20 bytes');
    if (!connected) throw new Error('GATT Server is disconnected.');
    buf += new TextDecoder().decode(chunk); let i;
    while ((i = buf.indexOf('\r')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (cfg.silent) continue;
      const pre = cfg.searching && /^01/.test(line) && !cfg.searched ? (cfg.searched = 1, 'SEARCHING...\r') : '';
      const bytes = new TextEncoder().encode((bike.elm.echo ? line + '\r' : '') + pre + bike.command(line) + '\r\r>');
      for (let o = 0; o < bytes.length; o += cfg.chunk) { const part = bytes.slice(o, o + cfg.chunk); q = q.then(() => new Promise(r => setTimeout(() => { if (connected) rx._emit(part); r(); }, cfg.latency))); }
    }
  };
  const svc = { getCharacteristics: async () => cfg.mode === 'noserial' ? [mk('2a00', { read: true })] : [rx, tx] };
  const dev = { name: 'OBDII-TEST', addEventListener: (ty, f) => dl.push(f), gatt: { get connected() { return connected; }, connect: async () => { connected = true; return { getPrimaryServices: async () => [svc] }; }, disconnect: () => { if (connected) { connected = false; dl.forEach(f => f()); } } } };
  cfg.drop = () => dev.gatt.disconnect();
  return dev;
} };
"""
S = "window.__bench"
async def page(b, cfg=None, ble=True, w=1360, h=900, errs=None):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    pg = await ctx.new_page()
    if errs is not None:
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if ble:
        await pg.add_init_script('window.__bleCfg = ' + json.dumps(cfg or {}) + ';')
        await pg.add_init_script(FAKE_BLE.replace('navigator.bluetooth = ', 'Object.defineProperty(navigator, "bluetooth", { configurable: true, value: ') .replace('  return dev;\n} };', '  return dev;\n} } });'))
    await pg.goto(URL); await pg.wait_for_timeout(2500)
    return pg
async def dl(pg, sel):
    async with pg.expect_download() as d: await pg.click(sel)
    x = await d.value; p = await x.path()
    return x.suggested_filename, open(p, encoding='utf8').read()
ev = lambda pg, js: pg.evaluate(js)