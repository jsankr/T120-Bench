import asyncio, json, csv, io, sys
from playwright.async_api import async_playwright
import os, sys, json, pathlib, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = os.environ.get('APP_URL', (ROOT / 'index.html').as_uri())
CHROME = os.environ.get('CHROME') or None
TMP = pathlib.Path(tempfile.mkdtemp(prefix='t120-'))
R = []
def chk(name, cond, detail=''):
    R.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (('  [' + str(detail) + ']') if detail != '' and not cond else ''))

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

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        errs = []
        # ================= A. simulated Bluetooth =================
        pg = await page(b, {}, errs=errs)
        await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(6000)
        chk('BLE: connects and switches to live ECU', await ev(pg, S + ".source") == 'ecu')
        chk('BLE: requested the serial-style services', await ev(pg, "window.__ble.opts.optionalServices.length") >= 4)
        chk('BLE: writes chunked to 20 bytes or less', 0 < await ev(pg, "window.__ble.maxChunk") <= 20)
        chk('BLE: VIN read from the bike over multi-frame reply', await ev(pg, S + ".session.info.vin") == 'SMTTESTBIKE000001')
        chk('BLE: protocol and adapter identified', 'ELM327' in await ev(pg, S + ".session.info.adapter") and '15765' in await ev(pg, S + ".session.info.protocol"))
        chk('BLE: fast single-reply mode negotiated', await ev(pg, S + ".session.elm.fast") is True)
        chk('BLE: handled SEARCHING... noise on first query', await ev(pg, "window.__ble.searched") == 1)
        d = await ev(pg, "[" + S + ".live.rpm, window.__ble.bike.out.rpm, " + S + ".live.ect, window.__ble.bike.out.ect, " + S + ".live.vbat, window.__ble.bike.out.vbat]")
        chk('BLE: live rpm, coolant, battery match the bike', abs(d[0]-d[1]) < 150 and abs(d[2]-d[3]) <= 1.5 and abs(d[4]-d[5]) < 0.2, d)
        chk('BLE: simulated banner hidden, chip says Live ECU', await ev(pg, "document.querySelector('#simbar').hidden && document.querySelector('#srcChip').textContent === 'Live ECU · Bluetooth'"))
        chk('BLE: twin controls hidden', await ev(pg, "getComputedStyle(document.querySelector('#dock')).display") == 'none')
        chk('BLE: no twin-model channel in live data', await ev(pg, "['afr','injPw','egt','torque','knockMargin','gear','fan','pump'].every(k => " + S + ".live[k] === undefined)"))
        await pg.wait_for_timeout(1500)
        chk('BLE: twin-only tiles show as unavailable', await ev(pg, "['afr','egt','knockMargin','injDuty','railKpa'].every(k => document.querySelector('#tile-'+k).classList.contains('na') && document.querySelector('#tile-'+k+' .v span').textContent === '–')"))
        chk('BLE: PID tiles show values', await ev(pg, "['ect','iat','map','tps','vbat'].every(k => !document.querySelector('#tile-'+k).classList.contains('na'))"))
        await ev(pg, "location.hash='systems'"); await pg.wait_for_timeout(1200)
        chk('BLE systems: unpublished rows labelled, none carry a value', await ev(pg, "[...document.querySelectorAll('#groups tr.na')].length >= 14 && [...document.querySelectorAll('#groups tr.na .v')].every(e => e.textContent === '–')"))
        chk('BLE systems: published rows carry values', await ev(pg, "[...document.querySelectorAll('#groups tr:not(.na)[data-k] .v')].filter(e => e.textContent !== '–').length") >= 16)
        # faults on the "real" bike
        await ev(pg, "location.hash='faults'"); await ev(pg, "window.__ble.bike.inject('P0122')"); await pg.wait_for_timeout(5500)
        chk('BLE faults: code set on bike is read and MIL shown', await ev(pg, S + ".dtcs") == ['P0122'] and await ev(pg, S + ".mil") is True)
        chk('BLE faults: code described in list', 'Throttle position sensor' in await pg.inner_text('#dtcList'))
        chk('BLE faults: no twin fault-injection buttons on a real ECU', await ev(pg, "document.querySelectorAll('[data-fault]').length") == 0)
        await pg.click('#dtcClear'); await pg.wait_for_timeout(300)
        chk('BLE faults: clear blocked while engine runs', 'stop the engine' in (await pg.inner_text('#modalBox')).lower())
        await pg.click('#modalBox [data-close]')
        await ev(pg, "(() => { const k = window.__ble.bike; k.heal('P0122'); k.stop(); })()"); await pg.wait_for_timeout(2500)
        await pg.click('#dtcClear'); await pg.wait_for_timeout(300)
        chk('BLE faults: confirmation names the real ECU', 'real ecu' in (await pg.inner_text('#modalBox')).lower() and 'real write to your bike' in await pg.inner_text('#modalBox'))
        await pg.click('#okClear'); await pg.wait_for_timeout(2500)
        chk('BLE faults: clear reaches the bike', await ev(pg, "window.__ble.bike.dtcs.length") == 0 and await ev(pg, S + ".dtcs") == [])
        chk('BLE faults: PID grid shows 19 data PIDs plus 2 range markers', await ev(pg, "document.querySelectorAll('#pidGrid .y').length") == 21)
        # write lab while on real ECU
        await ev(pg, "location.hash='write-lab'"); await pg.wait_for_timeout(800)
        await pg.click('#bkBtn'); await pg.wait_for_timeout(700)
        bikeCrc = await ev(pg, "T120.crc32(window.__ble.bike.flash)")
        await pg.click('#rhBtn'); await pg.wait_for_timeout(4500)
        chk('BLE write lab: rehearsal ran on the twin only, bike flash untouched', await ev(pg, S + ".lastFlash.ok") is True and await ev(pg, "T120.crc32(window.__ble.bike.flash)") == bikeCrc and await ev(pg, "window.__ble.bike.prog") is None)
        chk('BLE write lab: real write shown as locked', await pg.inner_text('#pl-re') == 'Locked')
        # reports in ECU mode
        await ev(pg, "location.hash='reports'"); await pg.wait_for_timeout(1200)
        name, text = await dl(pg, '#expCsv'); rows = list(csv.reader(io.StringIO(text)))
        chk('BLE report: CSV not stamped simulated, rows tagged ECU', not name.startswith('SIMULATED') and all(r[0] == 'ECU' for r in rows[1:]) and len(rows) > 20, name)
        chk('BLE report: CSV has no twin-model columns', not any(k in ','.join(rows[0]) for k in ['afr', 'egt', 'torque', 'injPw', 'knock']), rows[0])
        chk('BLE report: subtitle says live ECU with VIN', 'SMTTESTBIKE000001' in await pg.inner_text('#repSub'))
        name, text = await dl(pg, '#expHtml')
        chk('BLE report: HTML report has no simulated banner', 'SIMULATED DATA' not in text and 'SMTTESTBIKE000001' in text)
        # unplug
        await ev(pg, "window.__ble.drop()"); await pg.wait_for_timeout(2500)
        chk('BLE: unplug falls back to twin with banner', await ev(pg, S + ".source") == 'twin' and not await ev(pg, "document.querySelector('#simbar').hidden"))
        chk('BLE: unplug logged as event', await ev(pg, S + ".events.some(e => /Adapter link closed/.test(e.msg))"))
        chk('BLE: twin polling resumed after unplug', await ev(pg, S + ".answering") is True)
        await pg.context.close()

        pg = await page(b, {'mode': 'cancel'}, errs=errs); await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(800)
        chk('BLE cancel: chooser dismissed quietly, twin keeps running', await ev(pg, S + ".source") == 'twin' and not await ev(pg, "document.querySelector('#modal').classList.contains('on')") and await ev(pg, S + ".answering"))
        await pg.context.close()
        pg = await page(b, {'mode': 'noserial'}, errs=errs); await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(1500)
        chk('BLE wrong device: clear error, twin keeps running', 'no serial-style ble service' in (await pg.inner_text('#modalBox')).lower() and await ev(pg, S + ".source") == 'twin')
        await pg.context.close()
        pg = await page(b, {'mode': 'ignoff'}, errs=errs); await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(3000)
        m = await pg.inner_text('#modalBox')
        chk('BLE ignition off: says ECU did not answer', 'ecu did not answer' in m.lower() and await ev(pg, S + ".source") == 'twin', m[:120])
        await pg.click('#modalBox [data-close]'); await pg.wait_for_timeout(1500)
        r1 = await ev(pg, S + ".session.elm.tx"); await pg.wait_for_timeout(1000); r2 = await ev(pg, S + ".session.elm.tx")
        chk('BLE ignition off: twin polling resumed, single loop', 20 < (r2 - r1) < 400 and await ev(pg, S + ".answering"), r2 - r1)
        await pg.context.close()
        pg = await page(b, {'latency': 60, 'chunk': 7, 'hold': True, 'nofast': True}, errs=errs); await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(14000)
        d = await ev(pg, "[" + S + ".source, " + S + ".live.rpm, window.__ble.bike.out.rpm, " + S + ".session.elm.errors, " + S + ".session.info.vin]")
        chk('BLE slow link, 7-byte fragments: connects and reads correctly', d[0] == 'ecu' and abs(d[1]-d[2]) < 200 and d[3] == 0 and d[4] == 'SMTTESTBIKE000001', d)
        chk('BLE adapter without fast mode: falls back and still reads', await ev(pg, S + ".session.elm.fast") is False)
        await ev(pg, "window.__ble.silent = true"); await pg.wait_for_timeout(24000)
        chk('BLE goes silent: link-lost message and fallback to twin', 'link lost' in (await pg.inner_text('#modalBox')).lower() and await ev(pg, S + ".source") == 'twin')
        await pg.context.close()

        # ================= B. modules on the twin =================
        pg = await page(b, None, ble=False, errs=errs)
        await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(300)
        chk('No Web Bluetooth: guidance shown instead of failing', 'no web bluetooth' in (await pg.inner_text('#modalBox')).lower())
        await pg.click('#modalBox [data-close]'); await pg.wait_for_timeout(3000)
        # live
        d = await ev(pg, "[document.querySelector('#tRpm').textContent, " + S + ".live.rpm, document.querySelectorAll('#tiles .tile.na').length, document.querySelectorAll('#tiles .tile').length]")
        chk('Live: tach text tracks rpm, all 16 tiles populated', abs(int(d[0]) - d[1]) < 400 and d[2] == 0 and d[3] == 16, d)
        chk('Live: four charts drawn with data', await ev(pg, "[0,1,2,3].every(i => { const c = document.querySelector('#lc'+i+' canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let j=3;j<d.length;j+=4) if (d[j]) n++; return n > 500; })"))
        chk('Live: legends list every series with a value', await ev(pg, "[...document.querySelectorAll('#liveCharts .legend')].map(l => l.querySelectorAll('b').length).join()") == '1,3,2,2')
        # twin controls
        await pg.uncheck('#cAuto'); await pg.select_option('#cGear', '0'); await ev(pg, "(() => { const g = document.querySelector('#cGrip'); g.value = 0; g.dispatchEvent(new Event('input')); })()"); await pg.wait_for_timeout(5000)
        idle = await ev(pg, S + ".live.rpm")
        chk('Twin controls: manual neutral idle near 1000 rpm', 850 < idle < 1250, idle)
        await pg.uncheck('#cIgn'); await pg.wait_for_timeout(2500)
        chk('Twin controls: ignition off stops engine and ECU goes silent', await ev(pg, S + ".twin.s.run") is False and await ev(pg, S + ".answering") is False)
        await pg.check('#cIgn'); await pg.click('#cStart'); await pg.wait_for_timeout(3000)
        chk('Twin controls: restart works', await ev(pg, S + ".twin.s.run") is True and await ev(pg, S + ".answering") is True)
        # systems
        await ev(pg, "location.hash='systems'"); await pg.wait_for_timeout(1500)
        d = await ev(pg, "[document.querySelectorAll('#groups tr[data-k]').length, document.querySelectorAll('#groups tr.na').length, [...document.querySelectorAll('#groups tr:not(.na) .v')].filter(e => e.textContent === '–').length, [...document.querySelectorAll('#flow dd')].filter(e => e.textContent === 'n/a').length, document.querySelectorAll('#groups .tag.model').length]")
        chk('Systems: 37 channels, 4 marked not published, rest have values, flow filled, 14 tagged twin model', d == [37, 4, 0, 0, 14], d)
        chk('Systems: sparklines drawn', await ev(pg, "[...document.querySelectorAll('#groups polyline')].filter(p => p.getAttribute('points').length > 20).length") >= 25)
        # maps
        await ev(pg, "location.hash='maps'"); await pg.wait_for_timeout(600)
        await pg.click('td[data-l="5"][data-r="5"]'); await pg.click('td[data-l="7"][data-r="8"]', modifiers=['Shift'])
        chk('Maps: shift-click selects a 3x4 block', await ev(pg, S + ".sel.size") == 12)
        await pg.click('#mapTools [data-a="-b"]')
        chk('Maps: fuel edit applied to selection only', await ev(pg, S + ".val.changed") == 12 and abs(await ev(pg, S + ".work.fuel[6][6] - " + S + ".stock.fuel[6][6]") + 0.5) < 1e-6)
        await pg.fill('#mapSet', '13.0'); await pg.click('#mapTools [data-a="set"]')
        chk('Maps: set value', await ev(pg, S + ".work.fuel[5][5]") == 13)
        await pg.click('#segMode [data-m="1"]');
        chk('Maps: change view shows signed deltas', (await pg.inner_text('td[data-l="5"][data-r="5"]')).startswith('−'))
        await pg.click('#segMode [data-m="0"]'); await pg.click('#mapTools [data-a="smooth"]'); await pg.click('#mapTools [data-a="rev"]')
        chk('Maps: revert selection restores baseline', await ev(pg, S + ".val.changed") == 0)
        await pg.click('#segTable [data-t="fuel"]'); await pg.click('th[data-row="11"]'); await pg.fill('#mapSet', '14.7'); await pg.click('#mapTools [data-a="set"]')
        chk('Maps: lean full-throttle row fails safety checks', await ev(pg, S + ".val.ok") is False and '✕ Fail' in await pg.inner_text('#mapChecks'))
        await ev(pg, "location.hash='write-lab'"); await pg.wait_for_timeout(600); await pg.click('#bkBtn'); await pg.wait_for_timeout(600)
        chk('Write lab: unsafe map blocks the rehearsal', await pg.is_disabled('#rhBtn') and 'Blocked until the safety checks pass' in await pg.inner_text('#rhTxt'))
        await ev(pg, "location.hash='maps'"); await pg.wait_for_timeout(400); await pg.click('#mapTools [data-a="revall"]')
        await pg.click('#segTable [data-t="thr"]'); await pg.fill('[data-thr="3"]', '5'); await pg.dispatch_event('[data-thr="3"]', 'change')
        chk('Maps: non-monotonic throttle curve fails', await ev(pg, S + ".val.checks.find(c => c.id === 'thr').level") == 'fail')
        await pg.click('#mapTools [data-a="revall"]'); await pg.click('#segTable [data-t="lim"]'); await pg.fill('#lim-revLimit', '7600'); await pg.dispatch_event('#lim-revLimit', 'change')
        chk('Maps: rev limit 7600 fails', await ev(pg, S + ".val.checks.find(c => c.id === 'rev').level") == 'fail')
        await pg.fill('#lim-revLimit', '6500'); await pg.dispatch_event('#lim-revLimit', 'change'); await pg.fill('#lim-idle', '1150'); await pg.dispatch_event('#lim-idle', 'change')
        await pg.click('#segTable [data-t="ign"]'); await pg.click('th[data-row="11"]'); await pg.click('#mapTools [data-a="+s"]'); await pg.click('#mapTools [data-a="+s"]')
        chk('Maps: mild edit passes, dyno recomputed', await ev(pg, S + ".val.ok") is True and await ev(pg, S + ".dyno.filter(p => p.rpm > 6500).every(p => p.tq < 0)"))
        name, text = await dl(pg, '#mapExport'); mj = json.loads(text)
        chk('Maps: export stamped simulated with origin note', name.startswith('SIMULATED-') and 'Not read from an ECU' in mj['origin'] and mj['sc']['revLimit'] == 6500, name)
        await pg.click('#mapTools [data-a="revall"]'); (TMP / 'map-in.json').write_text(text)
        await pg.set_input_files('#mapImport', str(TMP / 'map-in.json')); await pg.wait_for_timeout(500)
        chk('Maps: import round trip restores the edit', await ev(pg, S + ".work.sc.revLimit") == 6500 and await ev(pg, S + ".val.changed") == 16)
        (TMP / 'bad.json').write_text('{"format":"nope"}'); await pg.set_input_files('#mapImport', str(TMP / 'bad.json')); await pg.wait_for_timeout(400)
        chk('Maps: bad file rejected with message', 'import failed' in (await pg.inner_text('#modalBox')).lower()); await pg.click('#modalBox [data-close]')
        chk('Maps: dyno charts drawn', await ev(pg, "['#dynoT','#dynoP'].every(s => { const c = document.querySelector(s+' canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let j=3;j<d.length;j+=4) if (d[j]) n++; return n > 500; })"))
        # write lab: sag, recover, clean, behaviour change
        await ev(pg, "location.hash='write-lab'"); await pg.wait_for_timeout(600)
        await pg.click('#pfStop'); await pg.wait_for_timeout(4000)
        await pg.select_option('#rhFault', 'sag'); await pg.click('#rhBtn'); await pg.wait_for_timeout(2500)
        chk('Write lab: battery sag fails the write and corrupts twin', await ev(pg, S + ".lastFlash.ok") is False and 'Voltage' in await ev(pg, S + ".lastFlash.error") and await ev(pg, S + ".twin.ecu") == 'corrupt')
        chk('Write lab: corrupt twin will not start, rehearse disabled', await pg.is_disabled('#rhBtn') and await pg.inner_text('#cStart') == 'ECU will not start')
        await pg.click('#rhRec'); await pg.wait_for_timeout(2500)
        chk('Write lab: recovery restores baseline calibration', await ev(pg, S + ".twin.ecu") == 'ok' and await ev(pg, S + ".twin.map.sc.revLimit") == 7000)
        await pg.select_option('#rhFault', ''); await pg.click('#rhBtn'); await pg.wait_for_timeout(4500)
        chk('Write lab: clean write verified, 64 blocks, counter 1', await ev(pg, S + ".lastFlash.ok") is True and await ev(pg, "document.querySelectorAll('#rhBlocks i.v').length") == 64 and await ev(pg, S + ".clean") == 1)
        await pg.click('#cStart'); await pg.wait_for_timeout(9000)
        idle = await ev(pg, S + ".live.rpm")
        chk('Write lab: twin now idles at the written 1150 rpm', abs(idle - 1150) < 120, idle)
        await ev(pg, "(() => { const g = document.querySelector('#cGrip'); g.value = 100; g.dispatchEvent(new Event('input')); })()"); await pg.wait_for_timeout(3500)
        peak = await ev(pg, "Math.max(..." + S + ".hist.slice(-15).map(r => r.rpm))")
        chk('Write lab: twin now cuts at the written 6500 rpm limit', 6300 < peak < 6900, peak)
        await ev(pg, "(() => { const g = document.querySelector('#cGrip'); g.value = 0; g.dispatchEvent(new Event('input')); })()")
        # faults: all four
        await ev(pg, "location.hash='faults'"); await pg.wait_for_timeout(500)
        for c in ['P0117', 'P0122', 'P0135', 'P0562']: await pg.click(f'[data-fault={c}]')
        await pg.wait_for_timeout(6000)
        chk('Faults: all four injected codes read back', sorted(await ev(pg, S + ".dtcs")) == ['P0117', 'P0122', 'P0135', 'P0562'])
        chk('Faults: sensor effects visible in live data', await ev(pg, S + ".live.ect") == -40 and await ev(pg, S + ".live.vbat") < 12.2)
        for c in ['P0117', 'P0122', 'P0135', 'P0562']: await pg.click(f'[data-fault={c}]')
        await pg.click('#cStart'); await pg.wait_for_timeout(3000); await pg.click('#dtcClear'); await pg.click('#okClear'); await pg.wait_for_timeout(2500)
        chk('Faults: cleared after faults removed and engine stopped', await ev(pg, S + ".dtcs") == [] and await ev(pg, S + ".mil") is False)
        info = await pg.inner_text('#ecuInfo')
        chk('Faults: ECU info filled', all(k in info for k in ['Digital twin', 'ELM327', '15765', 'SMTD00TWINT120018']), info)
        # reports
        await ev(pg, "location.hash='reports'"); await pg.wait_for_timeout(1500)
        sm = await ev(pg, "[...document.querySelectorAll('#repSum div')].map(d => d.querySelector('span').textContent + '=' + d.querySelector('b').textContent)")
        chk('Report: summary tiles filled', len(sm) == 8 and not any(x.endswith('=–') for x in sm), sm)
        chk('Report: statistics for every logged channel, min <= avg <= max', await ev(pg, "(() => { const rows = [...document.querySelectorAll('#repStats tbody tr')]; return rows.length >= 28 && rows.every(r => { const c = r.children; return +c[2].textContent <= +c[3].textContent + 1e-9 && +c[3].textContent <= +c[4].textContent + 1e-9; }); })()"))
        chk('Report: events include flash, faults and clear', await ev(pg, "['Rehearsal', 'Recovery', 'Injected fault', 'Cleared fault codes', 'Backed up'].every(k => " + S + ".events.some(e => e.msg.includes(k)))"))
        name, text = await dl(pg, '#expCsv'); rows = list(csv.reader(io.StringIO(text)))
        n = await ev(pg, S + ".hist.length")
        chk('Report CSV: stamped, rectangular, row count matches log', name == 'SIMULATED-t120-log.csv' and len(set(len(r) for r in rows)) == 1 and abs(len(rows) - 1 - n) <= 3 and all(r[0] == 'SIMULATED' for r in rows[1:]), (name, len(rows), n))
        ri = rows[0].index('rpm_rpm'); mx = max(float(r[ri]) for r in rows[1:] if r[ri])
        chk('Report CSV: peak rpm equals summary peak', abs(mx - float([x for x in sm if x.startswith('Peak rpm')][0].split('=')[1])) <= 1, mx)
        name, text = await dl(pg, '#expJson'); sj = json.loads(text)
        chk('Report JSON: parses, flagged simulated, carries log, map, validation, events', name.startswith('SIMULATED-') and sj['simulated'] is True and len(sj['log']) > 50 and sj['workingMap']['sc']['revLimit'] == 6500 and len(sj['events']) > 5 and 'checks' in sj['validation'])
        name, text = await dl(pg, '#expHtml')
        chk('Report HTML: banner, tables and charts present', name.startswith('SIMULATED-') and 'SIMULATED DATA' in text and text.count('<polyline') == 2 and text.count('<tr>') > 30)
        rp = await b.new_page(); await rp.set_content(text);
        chk('Report HTML: opens standalone and renders', 'T120 session report' in await rp.inner_text('h1') and await rp.evaluate("document.querySelectorAll('polyline')[0].getAttribute('points').split(' ').length") > 20); await rp.close()
        await pg.emulate_media(media='print')
        chk('Report print: only the report and banner are visible', await ev(pg, "getComputedStyle(document.querySelector('nav')).display === 'none' && getComputedStyle(document.querySelector('.top')).display === 'none' && getComputedStyle(document.querySelector('#v-reports')).display !== 'none' && getComputedStyle(document.querySelector('#simbar')).display !== 'none' && [...document.querySelectorAll('.noprint')].every(e => getComputedStyle(e).display === 'none')"))
        await pg.emulate_media(media='screen')
        await pg.click('#repReset'); await pg.wait_for_timeout(700)
        chk('Report: new session clears log and events', await ev(pg, S + ".hist.length") < 6 and await ev(pg, S + ".events.length") == 1)
        await pg.context.close()
        # framed preview fallback
        (TMP / 'frame.html').write_text('<iframe src="' + URL + '#reports" style="width:1200px;height:800px"></iframe>')
        fp = await b.new_page(viewport={'width': 1300, 'height': 900}); await fp.goto((TMP / 'frame.html').as_uri()); await fp.wait_for_timeout(3500)
        fr = fp.frames[1]; await fr.click('#expCsv'); await fr.wait_for_timeout(500)
        chk('Embedded preview: export falls back to copy box with content', await fr.evaluate("document.querySelector('#expTa').value.split('\\n').length") > 5 and await fr.evaluate("document.querySelector('#expPrint').hidden"))
        await fp.close()
        # ================= C. acceleration =================
        pg = await page(b, None, ble=False, errs=errs)
        await ev(pg, "location.hash='accel'"); await pg.wait_for_timeout(2500)
        rate = await ev(pg, S + ".acc.rate")
        chk('Accel: focus polling gives 8 or more speed samples per second on the twin', rate >= 8, rate)
        await ev(pg, """(() => { const tw = window.__bench.twin, g = window.__truth = { t0: null, t60: null, t100: null, r60: null, r100: null, r80: null, r120: null }; let pv = 0;
          setInterval(() => { const v = tw.s.v * 3.6, t = performance.now() / 1000; if (v < 0.5) { g.t0 = t; if (g.t100 === null) g.t60 = null; }
            const up = th => pv < th && v >= th; if (up(60)) { if (g.t60 === null) g.t60 = t; g.r60 = t; } if (up(100)) { if (g.t100 === null) g.t100 = t; g.r100 = t; } if (up(80)) g.r80 = t; if (up(120)) g.r120 = t;
            if (g.t100 === null && g.t60 === null) g.start = g.t0; pv = v; }, 2); })()""")
        await pg.click('#accLaunch'); await pg.wait_for_timeout(1000)
        chk('Accel: launch button locks while running', await pg.is_disabled('#accLaunch'))
        await pg.wait_for_timeout(26000)
        d = await ev(pg, "({ last: " + S + ".acc.last, g: window.__truth, rate: " + S + ".acc.rate, peak: " + S + ".acc.peakG, n: " + S + ".acc.runs.length, launch: " + S + ".launch })")
        g = d['g']; tol = 2 / max(d['rate'], 1) + 0.12
        chk('Accel: simulated launch completes and four runs are timed', d['launch'] is None and d['n'] == 4 and all(k in d['last'] for k in ['0-60', '0-100', '60-100', '80-120']), d['last'])
        chk('Accel: 0-60 matches the twin ground truth', abs(d['last'].get('0-60', 0) - (g['t60'] - g['start'])) < tol, (d['last'].get('0-60'), g['t60'] - g['start'], tol))
        chk('Accel: 0-100 matches the twin ground truth', abs(d['last'].get('0-100', 0) - (g['t100'] - g['start'])) < tol, (d['last'].get('0-100'), g['t100'] - g['start'], tol))
        chk('Accel: 60-100 roll-on matches ground truth', abs(d['last'].get('60-100', 0) - (g['r100'] - g['r60'])) < tol, (d['last'].get('60-100'), g['r100'] - g['r60']))
        chk('Accel: 80-120 roll-on matches ground truth', abs(d['last'].get('80-120', 0) - (g['r120'] - g['r80'])) < tol, (d['last'].get('80-120'), g['r120'] - g['r80']))
        chk('Accel: peak g plausible and below the twin traction cap', 0.5 < d['peak'] <= 0.9, d['peak'])
        txt = await pg.inner_text('#accTable'); runs = await pg.inner_text('#accRuns')
        chk('Accel: table and history show the runs, marked simulated', txt.count(' s') >= 8 and runs.count('(simulated)') == 4 and 'timing ±' in runs, runs[:160])
        chk('Accel: charts drawn', await ev(pg, "['#accC1','#accC2'].every(s => { const c = document.querySelector(s+' canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let j=3;j<d.length;j+=4) if (d[j]) n++; return n > 500; })"))
        chk('Accel: runs logged as events', await ev(pg, S + ".events.filter(e => /km\\/h in/.test(e.msg)).length") == 4)
        await ev(pg, "location.hash='reports'"); await pg.wait_for_timeout(800)
        name, text = await dl(pg, '#expJson'); sj = json.loads(text)
        chk('Accel: session JSON carries runs with timing uncertainty', len(sj['acceleration']['runs']) == 4 and all(r['timingUncertaintySeconds'] for r in sj['acceleration']['runs']))
        name, text = await dl(pg, '#expHtml'); chk('Accel: HTML report lists the runs', text.count('km/h in') >= 4)
        await ev(pg, "location.hash='accel'"); await pg.click('#accReset'); await pg.wait_for_timeout(400)
        chk('Accel: reset clears results', await ev(pg, S + ".acc.runs.length") == 0)
        await pg.context.close()

        # ================= D. WiFi through the bridge =================
        import subprocess, time
        fake = subprocess.Popen(['node', 'tests/fake-wifi-adapter.js', '35000'], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        br = subprocess.Popen(['node', 'tools/t120-wifi-bridge.js', '--adapter', '127.0.0.1:35000', '--port', '8765'], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        time.sleep(1.2)
        try:
            ctx = await b.new_context(viewport={'width': 1360, 'height': 900}, accept_downloads=True); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append('WIFI ' + str(e)))
            await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(2500)
            chk('WiFi: bridge serves the app', await pg.title() == 'T120 Bench' and await ev(pg, S + ".source") == 'twin')
            await pg.click('#btnConnect')
            chk('WiFi: bridge address prefilled from the page origin', await pg.input_value('#cnUrl') == 'ws://localhost:8765/elm')
            await pg.click('#cnWifi'); await pg.wait_for_timeout(5000)
            d = await ev(pg, "[" + S + ".source, " + S + ".session.link, " + S + ".session.info.vin, " + S + ".session.elm.fast, " + S + ".live.rpm, document.querySelector('#srcChip').textContent, document.querySelector('#simbar').hidden, " + S + ".session.elm.errors]")
            chk('WiFi: connects through the bridge to the TCP adapter', d[0] == 'ecu' and d[1] == 'wifi' and d[2] == 'SMTWIFIBIKE000001' and d[4] > 500 and d[7] == 0, d)
            chk('WiFi: labelled Live ECU · WiFi, banner hidden, fast mode on', d[5] == 'Live ECU · WiFi' and d[6] is True and d[3] is True, d)
            await ev(pg, "location.hash='accel'"); await pg.wait_for_timeout(3500)
            wr = await ev(pg, S + ".acc.rate"); print('     wifi speed samples/s through local bridge:', round(wr, 1))
            chk('WiFi: acceleration page samples speed from the real link', wr >= 8 and await pg.inner_text('#accSpd .st') == 'From ECU', wr)
            await ev(pg, "location.hash='faults'"); await pg.wait_for_timeout(1200)
            chk('WiFi: ECU info names the WiFi bridge', 'WiFi bridge' in await pg.inner_text('#ecuInfo'))
            p2 = await ctx.new_page(); await p2.goto('http://localhost:8765/'); await p2.wait_for_timeout(2000); await p2.click('#btnConnect'); await p2.click('#cnWifi'); await p2.wait_for_timeout(2500)
            chk('WiFi: second page told the adapter is in use', 'already using the adapter' in await p2.inner_text('#modalBox') and await p2.evaluate(S + ".source") == 'twin'); await p2.close()
            p3 = await ctx.new_page(); await p3.goto(URL); await p3.wait_for_timeout(2000); await p3.click('#btnConnect'); await p3.click('#cnWifi'); await p3.wait_for_timeout(2500)
            chk('WiFi: page from another origin is refused by the bridge', 'could not connect' in (await p3.inner_text('#modalBox')).lower() and await p3.evaluate(S + ".source") == 'twin'); await p3.close()
            fake.kill(); await pg.wait_for_timeout(3000)
            chk('WiFi: adapter dropping out falls back to twin with a reason', await ev(pg, S + ".source") == 'twin' and await ev(pg, S + ".events.some(e => /Adapter link closed/.test(e.msg))") and not await ev(pg, "document.querySelector('#simbar').hidden"))
            await pg.click('#btnConnect'); await pg.click('#cnWifi'); await pg.wait_for_timeout(3000)
            chk('WiFi: adapter unreachable gives a clear message', 'unreachable' in await pg.inner_text('#modalBox'), (await pg.inner_text('#modalBox'))[:160])
            await ctx.close()
        finally:
            fake.kill(); br.kill()
        out = br.stdout.read().decode()
        chk('WiFi bridge log: shows link, refusal and end of session', 'linked to adapter' in out and 'refused page origin' in out and 'session ended' in out, out[-300:])
        # phone + dark
        ctx = await b.new_context(viewport={'width': 390, 'height': 800}, color_scheme='dark'); ph = await ctx.new_page(); ph.on('pageerror', lambda e: errs.append('PHONE ' + str(e)))
        await ph.goto(URL); await ph.wait_for_timeout(2500); bad = []
        for v in ['live', 'accel', 'systems', 'maps', 'write-lab', 'faults', 'reports']:
            await ph.evaluate(f"location.hash='{v}'"); await ph.wait_for_timeout(700)
            if await ph.evaluate("document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1"): bad.append(v)
        chk('Phone 390px, dark theme: no sideways page scroll on any section', bad == [], bad)
        chk('Dark theme: palette applied', await ph.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(13, 18, 20)')
        await ph.screenshot(path='e2e-phone-dark.png'); await ctx.close()
        chk('No JavaScript errors in any scenario', errs == [], errs[:5])
        await b.close()
    f = [r for r in R if not r[1]]
    print(f'\n{len(R) - len(f)} passed, {len(f)} failed')
    for r in f: print('  FAILED:', r[0], r[2])
    out = pathlib.Path(os.environ.get('RESULTS_DIR', ROOT / 'reports'))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'results-app.json').write_text(json.dumps([{'check': r[0], 'pass': r[1], 'detail': str(r[2])[:300] if not r[1] else ''} for r in R], indent=1))
    if f: sys.exit(1)
asyncio.run(main())
