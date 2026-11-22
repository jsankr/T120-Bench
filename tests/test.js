const T = require('../src/core.js');
const assert = require('assert');
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok  ' + name); }, e => { console.log('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; });
const run = (tw, secs, f) => { for (let i = 0; i < secs * 50; i++) { f && f(0.02); tw.step(0.02); } };

(async () => {
  await ok('PID encode/decode round trips', () => {
    const samples = { load: 50, ect: 92, stft: -6.2, ltft: 3.1, map: 64, rpm: 3125.5, speed: 97, adv: 27.5, iat: 34, tps: 40, o2: 0.45, runtime: 600, baro: 100, vbat: 14.1, lambdaCmd: 0.88, ambient: 30, grip: 50, thrCmd: 40, oil: 95 };
    for (const k in samples) { const d = T.PID_BY_KEY[k], v = d.dec(d.enc(samples[k])); assert(Math.abs(v - samples[k]) <= Math.max(0.5, (d.max - d.min) / 200), k + ' ' + v); }
  });
  await ok('DTC byte coding', () => { for (const c of ['P0117', 'P2135', 'C1234', 'U0100']) { const b = T.dtcToBytes(c); assert.strictEqual(T.dtcFromBytes(b[0], b[1]), c); } });
  await ok('parser handles spaces, noise, multi-frame and errors', () => {
    assert.deepStrictEqual(T.parseObd('41 0C 1A F8\r\r', 1, 0x0C).bytes, [0x1A, 0xF8]);
    assert.deepStrictEqual(T.parseObd('SEARCHING...\r410C1AF8\r', 1, 0x0C).bytes, [0x1A, 0xF8]);
    assert.deepStrictEqual(T.parseObd('7E8 04 41 0C 1A F8', 1, 0x0C).bytes, [0x1A, 0xF8]);
    assert(T.parseObd('NO DATA', 1, 0x0C).error);
    assert(T.parseObd('CAN ERROR', 1, 0x0C).error);
    const vin = T.parseObd('014\r0:490201534D54\r1:4430305457494E\r2:54313230303138', 9, 2).bytes;
    assert.strictEqual(String.fromCharCode(...vin.slice(1)), 'SMTD00TWINT120018');
  });
  await ok('image round trip and CRC tamper detection', () => {
    const m = T.baselineMap(), img = T.encodeImage(m), back = T.decodeImage(img);
    assert.deepStrictEqual(back.fuel, m.fuel); assert.deepStrictEqual(back.ign, m.ign); assert.deepStrictEqual(back.sc, m.sc); assert.deepStrictEqual(back.thr, m.thr);
    img[100] ^= 1; assert.strictEqual(T.imageCrcOk(img), false); assert.throws(() => T.decodeImage(img));
  });
  await ok('engine model matches published T120 figures', () => {
    const d = T.dynoSweep(T.baselineMap());
    const peakT = d.reduce((a, b) => b.tq > a.tq ? b : a), peakP = d.reduce((a, b) => b.ps > a.ps ? b : a);
    console.log('    peak ' + peakT.tq.toFixed(1) + ' Nm @ ' + peakT.rpm + ', ' + peakP.ps.toFixed(1) + ' PS @ ' + peakP.rpm);
    assert(Math.abs(peakT.tq - 105) < 3 && Math.abs(peakT.rpm - 3100) <= 250);
    assert(Math.abs(peakP.ps - 80) < 3 && Math.abs(peakP.rpm - 6550) <= 250);
  });
  await ok('baseline map passes validation; unsafe edits fail', () => {
    const base = T.baselineMap(), v = T.validateMap(base);
    assert(v.ok, JSON.stringify(v.checks.filter(c => c.level !== 'pass')));
    const lean = T.cloneMap(base); lean.fuel[11] = lean.fuel[11].map(() => 14.7);
    assert(!T.validateMap(lean).ok);
    const adv = T.cloneMap(base); adv.ign[11] = adv.ign[11].map(x => x + 6);
    const va = T.validateMap(adv); assert(!va.ok && va.checks.find(c => c.id === 'knock').level === 'fail');
    const rev = T.cloneMap(base); rev.sc.revLimit = 7600; assert(!T.validateMap(rev).ok);
    const mild = T.cloneMap(base); mild.ign[11] = mild.ign[11].map(x => x + 1.5); assert(T.validateMap(mild).ok);
  });
  await ok('twin starts, idles, warms up and cycles the fan', () => {
    const tw = new T.Twin(); tw.warm(80); tw.start(); run(tw, 20);
    assert(tw.s.run, 'running'); assert(Math.abs(tw.out.rpm - 1000) < 120, 'idle rpm ' + tw.out.rpm);
    assert(tw.out.vbat > 13.2, 'charging'); assert(tw.out.map < 60, 'idle vacuum ' + tw.out.map);
    let fanSeen = false, peak = 0; run(tw, 900, () => { if (tw.s.fan) fanSeen = true; peak = Math.max(peak, tw.s.ect); });
    console.log('    idle soak peak ' + peak.toFixed(1) + ' °C, fan seen ' + fanSeen);
    assert(fanSeen && peak < 110 && peak > 100);
  });
  await ok('twin rides: accelerates, hits rev limiter, top speed plausible', () => {
    const tw = new T.Twin(); tw.warm(85); tw.start(); run(tw, 3);
    tw.ctl.gear = 1; tw.ctl.grip = 100; let maxRpm = 0; run(tw, 6, () => { maxRpm = Math.max(maxRpm, tw.out.rpm); });
    assert(maxRpm > 6900 && maxRpm < 7400, 'limiter ' + maxRpm);
    tw.ctl.gear = 6; run(tw, 90); console.log('    top speed ' + tw.out.speed.toFixed(0) + ' km/h, ect ' + tw.s.ect.toFixed(0));
    assert(tw.out.speed > 160 && tw.out.speed < 210); assert(tw.s.ect < 108);
    assert(tw.out.afr < 13.5, 'open loop rich at WOT ' + tw.out.afr);
  });
  await ok('closed loop trims out the fuel error at cruise', () => {
    const tw = new T.Twin(); tw.warm(88); tw.start(); run(tw, 3); tw.ctl.gear = 5; tw.ctl.grip = 18; run(tw, 60);
    assert(tw.s.loop, 'closed loop'); assert(Math.abs(tw.out.afr - 14.7) < 0.3, 'afr ' + tw.out.afr);
    assert(tw.out.stft + tw.out.ltft > 1.5, 'trim positive');
  });
  await ok('ELM client over twin transport: init, PIDs, VIN, DTC read and clear', async () => {
    const tw = new T.Twin(); tw.warm(85); tw.start(); run(tw, 5);
    const elm = new T.Elm(new T.TwinTransport(tw, { latency: 1 })); const info = await elm.init();
    assert.strictEqual(info.vin, tw.vin); assert(/ELM327/.test(info.adapter)); assert(/15765/.test(info.protocol));
    for (const p of [0x04, 0x05, 0x0C, 0x0D, 0x11, 0x42, 0x49, 0x4C]) assert(elm.supported.has(p), 'supported ' + p.toString(16));
    assert(!elm.supported.has(0x5C) && !elm.supported.has(0x10));
    assert(Math.abs(await elm.read('rpm') - tw.out.rpm) < 1); assert(Math.abs(await elm.read('ect') - tw.out.ect) <= 1);
    assert.strictEqual(await elm.read('oil'), null);
    tw.inject('P0117'); run(tw, 3);
    assert.deepStrictEqual(await elm.dtcs(), ['P0117']); assert.strictEqual((await elm.status()).mil, true);
    assert.strictEqual(await elm.read('ect'), -40);
    assert.strictEqual((await elm.clearDtcs()).ok, false, 'refused while running');
    tw.stop(); run(tw, 2); tw.heal('P0117');
    assert.strictEqual((await elm.clearDtcs()).ok, true); assert.deepStrictEqual(await elm.dtcs(), []);
    tw.setIgnition(false); assert((await elm.query(1, 0x0C)).error);
  });
  await ok('client times out cleanly when the link drops a frame', async () => {
    const tw = new T.Twin(), tp = new T.TwinTransport(tw, { latency: 1 }), elm = new T.Elm(tp); await elm.init();
    tp.dropNext = 1; await assert.rejects(elm.cmd('010C', 80)); assert((await elm.read('rpm')) !== null);
  });
  await ok('client resyncs after a late reply instead of pairing answers with the wrong question', async () => {
    const tw = new T.Twin(); tw.warm(85); tw.start(); run(tw, 5);
    const tp = new T.TwinTransport(tw, { latency: 1 }), elm = new T.Elm(tp); await elm.init();
    tp.latency = 200; await assert.rejects(elm.cmd('0105', 60)); tp.latency = 1;
    for (let i = 0; i < 6; i++) { const r = await elm.read('rpm'), e = await elm.read('ect'); assert(r === null || Math.abs(r - tw.out.rpm) < 1, 'rpm never wrong: ' + r); assert(e === null || Math.abs(e - tw.out.ect) <= 1, 'ect never wrong: ' + e); }
    assert(Math.abs(await elm.read('rpm') - tw.out.rpm) < 1, 'recovered'); assert(elm.resyncs >= 1);
  });
  await ok('fast single-reply mode is used when the adapter supports it and skipped when it does not', async () => {
    const tw = new T.Twin(); tw.warm(85); tw.start(); run(tw, 5);
    const a = new T.Elm(new T.TwinTransport(tw, { latency: 1 })); await a.init(); assert.strictEqual(a.fast, true); assert(Math.abs(await a.read('rpm') - tw.out.rpm) < 1);
    const t2 = new T.Twin(); t2.noCount = true; t2.warm(85); t2.start(); run(t2, 5);
    const b = new T.Elm(new T.TwinTransport(t2, { latency: 1 })); await b.init(); assert.strictEqual(b.fast, false); assert(Math.abs(await b.read('rpm') - t2.out.rpm) < 1);
  });
  await ok('acceleration timing from a whole-km/h speed signal', () => {
    for (const hz of [5, 10, 25]) {
      const m = new T.AccelMeter(); const a = 5, dt = 1 / hz; let ev = [];
      for (let t = 0; t < 2; t += dt) m.add(t, 0);
      for (let t = 2; t < 12; t += dt) ev = ev.concat(m.add(t, Math.floor(Math.min(140, a * (t - 2) * 3.6))));
      const g = n => ev.find(e => e.name === n).time, tol = dt + 0.06;
      assert(Math.abs(g('0-60') - 16.667 / a) < tol, hz + 'Hz 0-60 ' + g('0-60')); assert(Math.abs(g('0-100') - 27.778 / a) < tol, hz + 'Hz 0-100 ' + g('0-100'));
      assert(Math.abs(g('60-100') - 11.111 / a) < 0.12, hz + 'Hz 60-100 ' + g('60-100')); assert(Math.abs(g('80-120') - 11.111 / a) < 0.12, '80-120 ' + g('80-120'));
      assert(Math.abs(m.peakG - a / 9.81) < 0.08, 'peak g ' + m.peakG);
    }
    const m = new T.AccelMeter(); let ev = []; for (let t = 0; t < 1; t += 0.1) m.add(t, 0);
    for (let t = 1; t < 4; t += 0.1) ev = ev.concat(m.add(t, Math.floor((t - 1) * 15)));   /* reaches 45 */
    for (let t = 4; t < 6; t += 0.1) ev = ev.concat(m.add(t, Math.floor(45 - (t - 4) * 10))); /* lifts off */
    for (let t = 6; t < 12; t += 0.1) ev = ev.concat(m.add(t, Math.floor(25 + (t - 6) * 18)));
    assert(!ev.some(e => e.name.startsWith('0-')), 'aborted launch must not produce a standing-start time'); assert(ev.some(e => e.name === '60-100'));
  });
  await ok('twin standing start is physically plausible', () => {
    const tw = new T.Twin(); tw.warm(85); tw.start(); run(tw, 3); tw.ctl.gear = 1; tw.ctl.grip = 100; let t = 0, t100 = null;
    while (t < 15 && t100 === null) { tw.step(0.01); t += 0.01; if (tw.out.rpm > 6600 && tw.ctl.gear < 6) tw.ctl.gear++; if (tw.out.speed >= 100) t100 = t; }
    console.log('    twin 0-100 in ' + t100.toFixed(2) + ' s'); assert(t100 > 3 && t100 < 7);
  });
  await ok('flash rehearsal: success changes twin behaviour', async () => {
    const tw = new T.Twin(), m = T.cloneMap(tw.map); m.sc.revLimit = 6500; m.sc.idle = 1200;
    const r = await T.rehearseFlash(tw, T.encodeImage(m), { blockDelay: 0 });
    assert(r.ok && r.written === 64); assert.strictEqual(tw.map.sc.revLimit, 6500);
    tw.warm(85); tw.start(); run(tw, 15); assert(Math.abs(tw.out.rpm - 1200) < 120, 'new idle ' + tw.out.rpm);
  });
  await ok('flash rehearsal: refuses with engine running or low battery, ECU untouched', async () => {
    const tw = new T.Twin(); tw.warm(85); tw.start(); run(tw, 3); const before = T.crc32(tw.flash);
    let r = await T.rehearseFlash(tw, T.encodeImage(tw.map), { blockDelay: 0 });
    assert(!r.ok && /running/.test(r.error)); assert.strictEqual(T.crc32(tw.flash), before); assert.strictEqual(tw.ecu, 'ok');
    const t2 = new T.Twin(); t2.inject('P0562'); run(t2, 3);
    r = await T.rehearseFlash(t2, T.encodeImage(t2.map), { blockDelay: 0 }); assert(!r.ok && /Battery/.test(r.error) && t2.ecu === 'ok');
    const bad = T.encodeImage(tw.map); bad[70] ^= 5; const t3 = new T.Twin();
    r = await T.rehearseFlash(t3, bad, { blockDelay: 0 }); assert(!r.ok && /checksum/.test(r.error) && t3.ecu === 'ok');
  });
  await ok('flash rehearsal: link drop bricks the twin, backup recovers it', async () => {
    const tw = new T.Twin(), m = T.cloneMap(tw.map); m.sc.revLimit = 6800;
    const r = await T.rehearseFlash(tw, T.encodeImage(m), { blockDelay: 0, dropAt: 30 });
    assert(!r.ok && r.written === 30); assert.strictEqual(tw.ecu, 'corrupt');
    tw.start(); run(tw, 3); assert(!tw.s.run, 'corrupt ECU must not start'); assert(tw.dtcs.includes('P0605'));
    const rec = await T.recoverFlash(tw, r.backup); assert(rec.ok); assert.strictEqual(tw.ecu, 'ok'); assert.strictEqual(tw.map.sc.revLimit, 7000);
    tw.start(); run(tw, 3); assert(tw.s.run);
  });
  await ok('flash rehearsal: voltage sag mid-write is caught', async () => {
    const tw = new T.Twin(); const r = await T.rehearseFlash(tw, T.encodeImage(tw.map), { blockDelay: 0, sagAt: 10 });
    assert(!r.ok && /Voltage/.test(r.error) && tw.ecu === 'corrupt');
  });
  await ok('ride scenario runs 5 minutes without stalling or overheating', () => {
    const tw = new T.Twin(); tw.warm(80); const sc = T.rideScenario(tw); let maxV = 0, maxE = 0, stalls = 0, was = false;
    run(tw, 300, dt => { sc(dt); maxV = Math.max(maxV, tw.out.speed); maxE = Math.max(maxE, tw.s.ect); if (was && !tw.s.run) stalls++; was = tw.s.run; });
    console.log('    max ' + maxV.toFixed(0) + ' km/h, ect max ' + maxE.toFixed(0) + ', stalls ' + stalls);
    assert(maxV > 80 && maxV < 190 && maxE < 110 && stalls === 0);
  });
  console.log(n + ' passed');
})();
