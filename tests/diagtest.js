const T = require('../src/core.js'), D = require('../src/diag.js'), assert = require('assert');
let pass = 0, fail = 0;
const ok = async (n, f) => { try { await f(); pass++; console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n   ' + e.message); } };
function rig(opts) {
  const tw = new T.Twin(), dg = new D.Diagnoser({ user: (opts && opts.user) || {} }); let t = 0, acc = 0;
  const sample = () => { const o = tw.out; return { t, rpm: o.rpm, ect: o.ect, iat: o.iat, map: o.map, baro: o.baro, tps: o.tps, grip: o.grip, speed: o.speed, stft: o.stft, ltft: o.ltft, o2: o.o2, fuelSys: o.fuelSys, volts: tw.s.vbat, answering: tw.ctl.ign && !tw.prog }; };
  const meta = () => ({ source: 'twin', dtcs: tw.dtcs.slice(), pending: [], mil: tw.mil, dtcRead: true });
  const run = (secs, drive) => { for (let i = 0; i < secs * 50; i++) { drive && drive(0.02, t); tw.step(0.02); t += 0.02; acc += 0.02; if (acc >= 0.2) { acc = 0; dg.feed(sample(), meta()); } } };
  return { tw, dg, run, active: () => dg.list().filter(f => f.active).map(f => f.id), get t() { return t; }, sample };
}
(async () => {
  await ok('every rule, test and part cites only known sources', () => {
    const chk = (ids, where) => ids.forEach(id => assert(D.SOURCES[id] || id === 'user' || id === null, where + ' cites unknown source ' + id));
    D.RULES.forEach(r => { chk(r.src, r.id); (r.causes || []).forEach(c => chk(c[1], r.id)); r.parts.forEach(p => assert(D.PARTS[p], r.id + ' unknown part ' + p)); });
    Object.entries(D.TEST_RULES).forEach(([k, r]) => { chk(r.src, k); r.causes.forEach(c => chk(c[1], k)); r.parts.forEach(p => assert(D.PARTS[p], k + ' part ' + p)); });
    Object.entries(D.PARTS).forEach(([k, p]) => chk(p.src, 'part ' + k)); D.REF.forEach(r => chk([r.src], 'ref'));
    Object.values(D.SYS).forEach(s => s.parts.forEach(p => assert(D.PARTS[p], 'sys part ' + p)));
    Object.entries(D.DTC).forEach(([c, d]) => { assert(D.SYS[d[0]], c); if (d[2]) chk([d[2]], c); assert.strictEqual(D.familyOf(c) === null || D.familyOf(c) === d[0] || ['P0315', 'P0125', 'P0128', 'P011B', 'P050C', 'P0135', 'P0155', 'P0705', 'P1521', 'P0600'].includes(c), true, c + ' family ' + D.familyOf(c) + ' vs ' + d[0]); });
  });
  await ok('DTC lookup: known, family-only and unknown codes', () => {
    assert.strictEqual(D.describeDtc('P0117').system, 'Coolant temperature sensor'); assert(D.describeDtc('P0117').known);
    const f = D.describeDtc('P0124'); assert.strictEqual(f.sys, 'tps'); assert(!f.known);
    const u = D.describeDtc('P1690'); assert.strictEqual(u.sys, null); assert(/Manufacturer/.test(u.text));
    assert.strictEqual(D.describeDtc('U0100').sys, 'can'); assert.strictEqual(D.describeDtc('P050C').src, 'tb222');
  });
  await ok('healthy twin: 20 minute ride from cold raises nothing', () => {
    const r = rig(); r.tw.warm(28); const sc = T.rideScenario(r.tw); r.run(1200, dt => sc(dt));
    const all = r.dg.list().map(f => f.id + (f.active ? '' : '(resolved)')); assert.deepStrictEqual(all, [], 'false findings: ' + all.join(', '));
    console.log('    end coolant ' + r.tw.s.ect.toFixed(0) + ' C, ltft ' + r.tw.s.ltft.toFixed(1));
  });
  await ok('healthy twin: long warm idle raises nothing', () => { const r = rig(); r.tw.warm(88); r.tw.start(); r.run(600); assert.deepStrictEqual(r.dg.list().map(f => f.id), []); });
  await ok('healthy twin: key on, engine off for 2 minutes raises nothing', () => { const r = rig(); r.run(120); assert.deepStrictEqual(r.dg.list().map(f => f.id), []); });
  const sc = async (name, sym, expect, setup, secs, notExpect) => ok(name, () => {
    const r = rig(); setup(r); if (sym) r.tw.symptom(sym, true); const drv = r.drive; r.run(secs, drv);
    const act = r.active(); expect.forEach(e => assert(act.includes(e), 'expected ' + e + ', got [' + act.join(', ') + ']'));
    (notExpect || []).forEach(e => assert(!act.includes(e), 'did not expect ' + e));
    const f = r.dg.findings[expect[0]]; assert(f.evidence.length && f.fix.length && f.parts.length && f.src.length);
  });
  const cruise = r => { r.tw.warm(88); r.tw.start(); r.drive = (dt, t) => { const c = r.tw.ctl; if (t < 3) return; c.gear = r.tw.out.speed < 30 ? 2 : r.tw.out.speed < 60 ? 4 : 5; c.grip = 22; }; };
  const idle = r => { r.tw.warm(88); r.tw.start(); };
  const rev3k = r => { r.tw.warm(88); r.tw.start(); r.drive = (dt, t) => { if (t < 3) return; const c = r.tw.ctl; c.gear = 0; c.grip = Math.max(0, Math.min(40, c.grip + (3000 - r.tw.out.rpm) * 0.002)); }; };
  await sc('charging fault without a code is found', 'undercharge', ['charge-low'], rev3k, 60);
  await sc('regulator overcharging is found and critical', 'overcharge', ['charge-high'], rev3k, 40);
  await sc('weak battery found at rest', 'weakBattery', ['battery-rest'], r => {}, 60);
  await sc('air leak found as lean trim', 'airLeak', ['fuel-trim'], idle, 300, ['o2-flat']);
  await sc('air leak causes idle hunting', 'airLeak', ['idle-unstable'], idle, 120);
  await sc('thermostat stuck open found on a cruise', 'thermoOpen', ['cold-running'], r => { cruise(r); r.tw.warm(40); }, 1200);
  await ok('dead cooling fan found as overheating, warning first', () => { const r = rig(); idle(r); r.tw.symptom('fanDead', true); let warnAt = null; for (let i = 0; i < 150 && !warnAt; i++) { r.run(10); const f = r.dg.findings.overheat; if (f && f.active) warnAt = f.sev; } assert.strictEqual(warnAt, 'warn'); });
  await ok('dead cooling fan escalates to critical', () => { const r = rig(); idle(r); r.tw.symptom('fanDead', true); r.run(2400); const f = r.dg.findings.overheat; assert(f && f.active && f.sev === 'critical', r.active().join()); });
  await sc('lazy O2 sensor found', 'o2Lazy', ['o2-flat', 'fuel-trim'], idle, 240);
  await sc('chafed harness voltage drop-outs found', 'harness', ['volt-dips'], cruise, 240);
  await sc('coolant sensor open circuit found from data before the code', null, ['ect-implausible'], r => { idle(r); r.tw.inject('P0117'); }, 30);
  await ok('stored code becomes a finding and clears when the ECM clears it', () => {
    const r = rig(); idle(r); r.tw.inject('P0117'); r.run(10); assert(r.dg.findings['dtc-P0117'] && r.dg.findings['dtc-P0117'].active);
    r.tw.heal('P0117'); r.tw.stop(); r.run(2); r.tw.dtcs = []; r.run(2); assert(!r.dg.findings['dtc-P0117'].active);
  });
  await ok('O2 heater fault code also shows open-loop fault status', () => { const r = rig(); idle(r); r.tw.inject('P0135'); r.run(60); const a = r.active(); assert(a.includes('dtc-P0135') && a.includes('open-loop-fault'), a.join()); });
  await ok('TB 222 code carries the calibration advice', () => { const r = rig(); idle(r); r.tw.dtcs.push('P050C'); r.run(2); const f = r.dg.findings['dtc-P050C']; assert(f.fix[0].includes('latest calibration') && f.src.includes('tb222')); });
  await ok('MAP/baro mismatch at key on is found', () => { const r = rig(); r.run(5); const s0 = r.sample; let t = r.t; for (let i = 0; i < 40; i++) { t += 0.2; r.dg.feed(Object.assign(s0(), { t: t + 20, map: 92, baro: 100 }), { source: 'twin', dtcs: [], pending: [], dtcRead: true }); } assert(r.active().includes('map-baro'), r.active().join()); });
  await ok('user idle figure enables the idle-spec rule', () => { const r = rig({ user: { idle: 1200, idleTol: 50 } }); idle(r); r.run(90); assert(r.active().includes('idle-spec')); const g = rig({ user: { idle: 1000, idleTol: 60 } }); idle(g); g.run(90); assert(!g.active().includes('idle-spec')); });
  await ok('engine starts, stops and rev changes are not counted as drop-outs', () => { const r = rig(); r.tw.warm(88); r.tw.symptom('overcharge', true); for (let k = 0; k < 6; k++) { r.tw.start(); r.run(8, (dt, t) => { r.tw.ctl.gear = 0; r.tw.ctl.grip = (t % 4) < 2 ? 30 : 0; }); r.tw.stop(); r.run(4); } assert(!r.dg.findings['volt-dips'], r.active().join()); });
  await ok('findings resolve when the fault goes away', () => { const r = rig(); rev3k(r); r.tw.symptom('overcharge', true); r.run(30, r.drive); assert(r.active().includes('charge-high')); r.tw.symptom('overcharge', false); r.run(40, r.drive); assert(!r.active().includes('charge-high') && r.dg.findings['charge-high'].resolvedAt); });
  /* guided test analysers on synthetic samples */
  const T_ = id => D.TESTS.find(t => t.id === id), X = { lim: { chargeMin: 13, chargeMax: 15, chargeSrc: 'mcn' }, user: { idle: null, idleTol: 50 }, coldSoak: true };
  await ok('test: key-on analyser passes healthy and flags weak battery and MAP gap', () => {
    const good = Array.from({ length: 20 }, (_, i) => ({ t: i * .2, volts: 12.6, map: 100, baro: 100, ect: 30, iat: 31, grip: 0 }));
    assert(T_('koeo').analyse(good, X).every(r => r.pass));
    const bad = good.map(q => Object.assign({}, q, { volts: 12.0, map: 95 })); const rr = T_('koeo').analyse(bad, X);
    assert(rr.find(r => r.rule === 'battery-rest') && rr.find(r => r.rule === 'map-baro'));
  });
  await ok('test: cranking analyser uses the 9.6 V limit', () => {
    const mk = vmin => [{ t: 0, rpm: 0, volts: 12.5 }, { t: .2, rpm: 250, volts: vmin }, { t: .5, rpm: 280, volts: vmin + .3 }, { t: 1, rpm: 900, volts: 12 }, { t: 6, rpm: 1000, volts: 14 }];
    assert(T_('crank').analyse(mk(10.1), X).every(r => r.pass)); assert(T_('crank').analyse(mk(8.9), X).find(r => r.rule === 'battery-crank'));
  });
  await ok('test: grip sweep finds drop-outs and a stuck grip', () => {
    const sweep = (glitch, end) => { const s = []; for (let i = 0; i < 60; i++) { const ph = i / 20 % 1; let g = i < 40 ? ph * 100 : end; if (glitch && i % 7 === 3 && i < 40 && g > 20) g = 0; s.push({ t: i * .2, grip: g }); } return s; };
    assert(T_('grip').analyse(sweep(false, 0), X).every(r => r.pass)); assert(T_('grip').analyse(sweep(true, 0), X).find(r => r.rule === 'grip-glitch')); assert(T_('grip').analyse(sweep(false, 9), X).find(r => r.rule === 'grip-stuck'));
  });
  await ok('test results become findings with evidence', () => { const dg = new D.Diagnoser(); dg.fromTest(T_('crank'), [{ name: 'Lowest', value: '8.9 V', limit: '9.6 V', pass: false, src: 'crankTest', rule: 'battery-crank' }], 5, 'ecu'); const f = dg.findings['battery-crank']; assert(f.active && f.origin === 'Live ECU' && f.parts[0] === 'battery'); });
  console.log(pass + ' passed, ' + fail + ' failed'); if (fail) process.exitCode = 1;
})();
