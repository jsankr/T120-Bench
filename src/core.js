/* T120 Bench core: OBD/ELM327 stack, digital twin ECU, map image, validation, flash rehearsal.
   Runs in the browser and in Node (for tests). No DOM access in this file. */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hex2 = n => (n & 255).toString(16).toUpperCase().padStart(2, '0');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- Standard OBD-II mode 01 PIDs ---------- */
  const u8 = v => [clamp(Math.round(v), 0, 255)];
  const u16 = v => { v = clamp(Math.round(v), 0, 65535); return [v >> 8, v & 255]; };
  const PIDS = [
    { pid: 0x03, key: 'fuelSys', name: 'Fuel system status', unit: '', group: 'fuel', min: 0, max: 16, dp: 0, labels: { 0: 'Engine off', 1: 'Open loop, warming up', 2: 'Closed loop', 4: 'Open loop, load', 8: 'Open loop, sensor fault', 16: 'Closed loop, sensor fault' }, dec: b => b[0], enc: v => [v & 255, 0] },
    { pid: 0x04, key: 'load', name: 'Calculated engine load', unit: '%', group: 'engine', min: 0, max: 100, dp: 0, dec: b => b[0] * 100 / 255, enc: v => u8(v * 255 / 100) },
    { pid: 0x05, key: 'ect', name: 'Coolant temperature', unit: '°C', group: 'thermal', min: -20, max: 130, dp: 0, dec: b => b[0] - 40, enc: v => u8(v + 40) },
    { pid: 0x06, key: 'stft', name: 'Short-term fuel trim', unit: '%', group: 'fuel', min: -25, max: 25, dp: 1, dec: b => (b[0] - 128) * 100 / 128, enc: v => u8(v * 128 / 100 + 128) },
    { pid: 0x07, key: 'ltft', name: 'Long-term fuel trim', unit: '%', group: 'fuel', min: -25, max: 25, dp: 1, dec: b => (b[0] - 128) * 100 / 128, enc: v => u8(v * 128 / 100 + 128) },
    { pid: 0x0B, key: 'map', name: 'Manifold absolute pressure', unit: 'kPa', group: 'air', min: 0, max: 110, dp: 0, fast: 1, dec: b => b[0], enc: v => u8(v) },
    { pid: 0x0C, key: 'rpm', name: 'Engine speed', unit: 'rpm', group: 'engine', min: 0, max: 8000, dp: 0, fast: 1, dec: b => (b[0] * 256 + b[1]) / 4, enc: v => u16(v * 4) },
    { pid: 0x0D, key: 'speed', name: 'Road speed', unit: 'km/h', group: 'engine', min: 0, max: 220, dp: 0, fast: 1, dec: b => b[0], enc: v => u8(v) },
    { pid: 0x0E, key: 'adv', name: 'Ignition advance', unit: '°BTDC', group: 'engine', min: -10, max: 50, dp: 1, dec: b => b[0] / 2 - 64, enc: v => u8((v + 64) * 2) },
    { pid: 0x0F, key: 'iat', name: 'Intake air temperature', unit: '°C', group: 'air', min: -20, max: 80, dp: 0, dec: b => b[0] - 40, enc: v => u8(v + 40) },
    { pid: 0x11, key: 'tps', name: 'Throttle butterfly position', unit: '%', group: 'air', min: 0, max: 100, dp: 0, fast: 1, dec: b => b[0] * 100 / 255, enc: v => u8(v * 255 / 100) },
    { pid: 0x14, key: 'o2', name: 'O2 sensor voltage', unit: 'V', group: 'fuel', min: 0, max: 1, dp: 2, dec: b => b[0] / 200, enc: v => [clamp(Math.round(v * 200), 0, 255), 0xFF] },
    { pid: 0x1F, key: 'runtime', name: 'Run time since start', unit: 's', group: 'engine', min: 0, max: 3600, dp: 0, dec: b => b[0] * 256 + b[1], enc: v => u16(v) },
    { pid: 0x33, key: 'baro', name: 'Barometric pressure', unit: 'kPa', group: 'air', min: 60, max: 105, dp: 0, dec: b => b[0], enc: v => u8(v) },
    { pid: 0x42, key: 'vbat', name: 'ECU supply voltage', unit: 'V', group: 'electrical', min: 9, max: 15, dp: 2, dec: b => (b[0] * 256 + b[1]) / 1000, enc: v => u16(v * 1000) },
    { pid: 0x44, key: 'lambdaCmd', name: 'Commanded lambda', unit: 'λ', group: 'fuel', min: 0.7, max: 1.2, dp: 3, dec: b => (b[0] * 256 + b[1]) / 32768, enc: v => u16(v * 32768) },
    { pid: 0x46, key: 'ambient', name: 'Ambient air temperature', unit: '°C', group: 'thermal', min: -20, max: 60, dp: 0, dec: b => b[0] - 40, enc: v => u8(v + 40) },
    { pid: 0x49, key: 'grip', name: 'Twist grip position', unit: '%', group: 'air', min: 0, max: 100, dp: 0, dec: b => b[0] * 100 / 255, enc: v => u8(v * 255 / 100) },
    { pid: 0x4C, key: 'thrCmd', name: 'Commanded throttle actuator', unit: '%', group: 'air', min: 0, max: 100, dp: 0, dec: b => b[0] * 100 / 255, enc: v => u8(v * 255 / 100) },
    { pid: 0x5C, key: 'oil', name: 'Oil temperature', unit: '°C', group: 'thermal', min: -20, max: 150, dp: 0, dec: b => b[0] - 40, enc: v => u8(v + 40) },
    { pid: 0x10, key: 'maf', name: 'Mass air flow', unit: 'g/s', group: 'air', min: 0, max: 120, dp: 1, dec: b => (b[0] * 256 + b[1]) / 100, enc: v => u16(v * 100) },
    { pid: 0x2F, key: 'fuelLevel', name: 'Fuel level', unit: '%', group: 'fuel', min: 0, max: 100, dp: 0, dec: b => b[0] * 100 / 255, enc: v => u8(v * 255 / 100) },
    { pid: 0x0A, key: 'fuelPress', name: 'Fuel pressure (gauge)', unit: 'kPa', group: 'fuel', min: 0, max: 765, dp: 0, dec: b => b[0] * 3, enc: v => u8(v / 3) }
  ];
  const PID_BY_KEY = {}, PID_BY_ID = {};
  PIDS.forEach(p => { PID_BY_KEY[p.key] = p; PID_BY_ID[p.pid] = p; });

  /* Channels the twin models but a real ECU does not expose over standard OBD. */
  const MODEL_CHANNELS = [
    { key: 'afr', name: 'Air-fuel ratio (actual)', unit: ':1', group: 'fuel', min: 10, max: 17, dp: 1 },
    { key: 'injPw', name: 'Injector pulse width', unit: 'ms', group: 'fuel', min: 0, max: 14, dp: 2 },
    { key: 'injDuty', name: 'Injector duty', unit: '%', group: 'fuel', min: 0, max: 100, dp: 0 },
    { key: 'railKpa', name: 'Fuel rail pressure', unit: 'kPa', group: 'fuel', min: 0, max: 400, dp: 0 },
    { key: 'pump', name: 'Fuel pump', unit: '', group: 'fuel', state: ['Off', 'Running'] },
    { key: 'purge', name: 'EVAP purge valve duty', unit: '%', group: 'valves', min: 0, max: 100, dp: 0 },
    { key: 'sai', name: 'Secondary air valve', unit: '', group: 'valves', state: ['Closed', 'Open'] },
    { key: 'thermostat', name: 'Thermostat opening', unit: '%', group: 'valves', min: 0, max: 100, dp: 0 },
    { key: 'fan', name: 'Radiator fan', unit: '', group: 'thermal', state: ['Off', 'Running'] },
    { key: 'egt', name: 'Exhaust gas temperature', unit: '°C', group: 'thermal', min: 0, max: 950, dp: 0 },
    { key: 'torque', name: 'Crank torque', unit: 'Nm', group: 'engine', min: -20, max: 115, dp: 0 },
    { key: 'power', name: 'Crank power', unit: 'kW', group: 'engine', min: 0, max: 65, dp: 1 },
    { key: 'knockMargin', name: 'Knock margin', unit: '°', group: 'engine', min: -6, max: 12, dp: 1 },
    { key: 'gear', name: 'Gear', unit: '', group: 'engine', state: ['N', '1', '2', '3', '4', '5', '6'] }
  ];

  const DTC_TEXT = {
    P0107: 'Manifold pressure sensor circuit low', P0108: 'Manifold pressure sensor circuit high',
    P0112: 'Intake air temperature sensor circuit low', P0113: 'Intake air temperature sensor circuit high',
    P0117: 'Coolant temperature sensor circuit low', P0118: 'Coolant temperature sensor circuit high',
    P0122: 'Throttle position sensor circuit low', P0123: 'Throttle position sensor circuit high',
    P0130: 'O2 sensor circuit', P0135: 'O2 sensor heater circuit', P0171: 'System too lean', P0172: 'System too rich',
    P0201: 'Injector 1 circuit', P0202: 'Injector 2 circuit', P0230: 'Fuel pump primary circuit',
    P0335: 'Crankshaft position sensor circuit', P0351: 'Ignition coil 1 circuit', P0352: 'Ignition coil 2 circuit',
    P0444: 'EVAP purge valve circuit open', P0480: 'Radiator fan relay circuit', P0500: 'Vehicle speed sensor',
    P0560: 'System voltage', P0562: 'System voltage low', P0563: 'System voltage high',
    P0605: 'ECU memory checksum error', P2135: 'Throttle position sensors disagree'
  };
  function dtcFromBytes(a, b) {
    const sys = 'PCBU'[a >> 6];
    return sys + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + hex2(b);
  }
  function dtcToBytes(code) {
    const sys = 'PCBU'.indexOf(code[0]);
    const a = (sys << 6) | (parseInt(code[1], 16) << 4) | parseInt(code[2], 16);
    return [a, parseInt(code.slice(3), 16)];
  }

  /* ---------- Map set (the calibration the twin runs) ---------- */
  const RPM_AXIS = [800, 1200, 1600, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7250, 7500];
  const LOAD_AXIS = [0, 3, 6, 10, 15, 20, 30, 40, 50, 65, 80, 100];
  const GRIP_AXIS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const r5 = v => Math.round(v * 2) / 2, r1 = v => Math.round(v * 10) / 10;

  function baselineMap() {
    const fuelByLoad = [14.6, 14.7, 14.7, 14.7, 14.7, 14.7, 14.7, 14.2, 13.8, 13.4, 13.1, 12.9];
    const fuel = LOAD_AXIS.map((l, li) => RPM_AXIS.map(r => r1(fuelByLoad[li] - (r >= 6500 && l >= 40 ? 0.2 : 0))));
    const ign = LOAD_AXIS.map(l => RPM_AXIS.map(r => {
      if (l === 0 && r <= 1200) return 10;
      const base = 8 + 26 * (1 - Math.exp(-r / 2200));
      const light = l > 0 && l <= 30 ? 6 * Math.sin(Math.PI * l / 40) : 0;
      return r5(base + light - 12 * Math.pow(l / 100, 0.7));
    }));
    return {
      name: 'Twin baseline', note: 'Representative calibration for the twin. Not Triumph factory data.',
      rpm: RPM_AXIS.slice(), load: LOAD_AXIS.slice(), fuel, ign,
      thr: [0, 6, 14, 23, 33, 44, 55, 67, 79, 90, 100],
      sc: { revLimit: 7000, idle: 1000, fanOn: 103, fanOff: 98 }
    };
  }
  const cloneMap = m => JSON.parse(JSON.stringify(m));

  function interp1(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    const n = xs.length; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 1; while (xs[i] < x) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  }
  function axisPos(xs, x) {
    const n = xs.length;
    if (x <= xs[0]) return [0, 0, 0]; if (x >= xs[n - 1]) return [n - 1, n - 1, 0];
    let i = 1; while (xs[i] < x) i++;
    return [i - 1, i, (x - xs[i - 1]) / (xs[i] - xs[i - 1])];
  }
  function interp2(m, table, rpm, load) {
    const [r0, r1_, rt] = axisPos(m.rpm, rpm), [l0, l1, lt] = axisPos(m.load, load);
    const a = table[l0][r0] + rt * (table[l0][r1_] - table[l0][r0]);
    const b = table[l1][r0] + rt * (table[l1][r1_] - table[l1][r0]);
    return a + lt * (b - a);
  }

  /* ---------- CRC32 and binary image ---------- */
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes, len) {
    let c = 0xFFFFFFFF; const n = len == null ? bytes.length : len;
    for (let i = 0; i < n; i++) c = CRC_T[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const IMG_SIZE = 8192, BLOCK = 128, MAGIC = 'T120TWIN';
  function encodeImage(m) {
    const b = new Uint8Array(IMG_SIZE).fill(0xFF);
    for (let i = 0; i < 8; i++) b[i] = MAGIC.charCodeAt(i);
    b[8] = 1; b[9] = m.rpm.length; b[10] = m.load.length;
    m.rpm.forEach((r, i) => { b[16 + i * 2] = r & 255; b[17 + i * 2] = r >> 8; });
    m.load.forEach((l, i) => { b[48 + i] = l; });
    let o = 64; m.fuel.forEach(row => row.forEach(v => { b[o++] = clamp(Math.round(v * 10), 0, 255); }));
    o = 256; m.ign.forEach(row => row.forEach(v => { b[o++] = clamp(Math.round((v + 10) * 2), 0, 255); }));
    m.thr.forEach((v, i) => { b[448 + i] = clamp(Math.round(v * 2), 0, 255); });
    const s = m.sc; b[480] = s.revLimit & 255; b[481] = s.revLimit >> 8; b[482] = s.idle & 255; b[483] = s.idle >> 8; b[484] = s.fanOn; b[485] = s.fanOff;
    const c = crc32(b, IMG_SIZE - 4);
    b[IMG_SIZE - 4] = c & 255; b[IMG_SIZE - 3] = (c >>> 8) & 255; b[IMG_SIZE - 2] = (c >>> 16) & 255; b[IMG_SIZE - 1] = (c >>> 24) & 255;
    return b;
  }
  function imageCrcOk(b) {
    if (b.length !== IMG_SIZE) return false;
    for (let i = 0; i < 8; i++) if (b[i] !== MAGIC.charCodeAt(i)) return false;
    const c = (b[IMG_SIZE - 4] | (b[IMG_SIZE - 3] << 8) | (b[IMG_SIZE - 2] << 16) | (b[IMG_SIZE - 1] << 24)) >>> 0;
    return c === crc32(b, IMG_SIZE - 4);
  }
  function decodeImage(b, name) {
    if (!imageCrcOk(b)) throw new Error('Image checksum or header is invalid');
    const nr = b[9], nl = b[10], m = { name: name || 'Decoded image', note: '', rpm: [], load: [], fuel: [], ign: [], thr: [], sc: {} };
    for (let i = 0; i < nr; i++) m.rpm.push(b[16 + i * 2] | (b[17 + i * 2] << 8));
    for (let i = 0; i < nl; i++) m.load.push(b[48 + i]);
    let o = 64; for (let l = 0; l < nl; l++) { const row = []; for (let r = 0; r < nr; r++) row.push(b[o++] / 10); m.fuel.push(row); }
    o = 256; for (let l = 0; l < nl; l++) { const row = []; for (let r = 0; r < nr; r++) row.push(b[o++] / 2 - 10); m.ign.push(row); }
    for (let i = 0; i < 11; i++) m.thr.push(b[448 + i] / 2);
    m.sc = { revLimit: b[480] | (b[481] << 8), idle: b[482] | (b[483] << 8), fanOn: b[484], fanOff: b[485] };
    return m;
  }

  /* ---------- Engine model (pure) ----------
     Anchored to published T120 figures: 1200 cc twin, 105 Nm at 3100 rpm, 80 PS at 6550 rpm.
     Everything else is a plausible physical model, not measured data. */
  const TQ_R = [800, 1000, 2000, 3100, 4000, 5000, 6000, 6550, 7000, 7500];
  const TQ_V = [55, 70, 95, 105, 102, 96, 89, 85.6, 78, 60];
  const BASE = baselineMap();
  const friction = rpm => 8 + 1.2 * rpm / 1000;
  function fillFrac(thr, rpm) {
    const k = 4 + 5 * rpm / 1000;
    return (1 - Math.exp(-thr / k)) / (1 - Math.exp(-100 / k));
  }
  function engineCalc(m, rpm, thr, env) {
    env = env || {};
    const ect = env.ect == null ? 88 : env.ect, iat = env.iat == null ? 30 : env.iat, baro = env.baro || 100;
    const frac = fillFrac(thr, rpm);
    const mapKpa = 24 + (baro - 26) * frac;
    const afrT = interp2(m, m.fuel, rpm, thr), adv = interp2(m, m.ign, rpm, thr);
    const afr = env.afr || afrT;
    const stockAdv = interp2(BASE, BASE.ign, rpm, thr);
    const afrF = clamp(1 - Math.pow((afr - 12.9) / 7, 2), 0, 1);
    const mbt = stockAdv + 3;
    const ignF = clamp(1 - Math.pow((adv - mbt) / 38, 2), 0, 1) / 0.99377;
    let knockLimit = stockAdv + 4 - Math.max(0, ect - 100) * 0.15 - Math.max(0, iat - 40) * 0.1;
    if (afr > 13.5 && frac > 0.6) knockLimit -= (afr - 13.5) * 2;
    const knockMargin = frac > 0.5 ? knockLimit - adv : 12;
    const cut = rpm > m.sc.revLimit;
    const gross = cut ? 0 : (interp1(TQ_R, TQ_V, rpm) + friction(rpm)) * frac * afrF * ignF;
    const tq = gross - friction(rpm) - (1 - frac) * (4 + 2.5 * rpm / 1000); /* pumping loss with the butterfly closed */
    const w = rpm * Math.PI / 30;
    const egt = 430 + 360 * frac + (afr - 12.9) * 45 * frac + (stockAdv - adv) * 6 * frac + rpm * 0.012;
    const airG = 0.6 * (mapKpa / 101) * 0.85 * 1.18 * (298 / (273 + iat));
    const injPw = cut ? 0 : airG / afr / 4.2 * 1000 + 0.6;
    return { frac, mapKpa, afrT, afr, adv, tq, gross, power: Math.max(0, tq * w / 1000), knockMargin, egt, injPw, injDuty: clamp(injPw / (120000 / Math.max(rpm, 300)) * 100, 0, 100), maf: airG * rpm / 60, cut };
  }
  function dynoSweep(m) {
    const out = [];
    for (let rpm = 1500; rpm <= 7500; rpm += 250) {
      const e = engineCalc(m, rpm, 100);
      out.push({ rpm, tq: e.tq, kw: e.power, ps: e.power * 1.35962, afr: e.afr, adv: e.adv, knockMargin: e.knockMargin, egt: e.egt });
    }
    return out;
  }

  /* ---------- Pre-write validation ---------- */
  function validateMap(m, stock) {
    stock = stock || BASE; const checks = [];
    const add = (id, level, title, detail) => checks.push({ id, level, title, detail });
    let afrOut = 0, ignOut = 0, leanLoad = 0, advHigh = 0, rough = 0, knockCells = 0, hotCells = 0, worstKnock = 99, worstEgt = 0, changed = 0;
    m.load.forEach((l, li) => m.rpm.forEach((r, ri) => {
      const f = m.fuel[li][ri], g = m.ign[li][ri];
      if (f !== stock.fuel[li][ri] || g !== stock.ign[li][ri]) changed++;
      if (!(f >= 11.5 && f <= 15.5)) afrOut++;
      if (!(g >= 0 && g <= 45)) ignOut++;
      if (l >= 65 && f > 13.6) leanLoad++;
      if (l >= 50 && g - stock.ign[li][ri] > 4) advHigh++;
      if (ri > 0 && (Math.abs(f - m.fuel[li][ri - 1]) > 1.2 || Math.abs(g - m.ign[li][ri - 1]) > 8)) rough++;
      if (li > 0 && (Math.abs(f - m.fuel[li - 1][ri]) > 1.2 || Math.abs(g - m.ign[li - 1][ri]) > 10)) rough++;
      if (l >= 30 && r >= 1600 && r <= m.sc.revLimit) {
        const e = engineCalc(m, r, l, { ect: 100, iat: 40 });
        if (e.knockMargin < 0) knockCells++;
        worstKnock = Math.min(worstKnock, e.knockMargin);
        if (e.egt > 900) hotCells++;
        worstEgt = Math.max(worstEgt, e.egt);
      }
    }));
    add('afr-range', afrOut ? 'fail' : 'pass', 'Fuel targets inside 11.5 to 15.5:1', afrOut ? afrOut + ' cells outside the range the twin accepts' : 'All 192 cells in range');
    add('ign-range', ignOut ? 'fail' : 'pass', 'Ignition inside 0 to 45° BTDC', ignOut ? ignOut + ' cells outside range' : 'All 192 cells in range');
    add('lean-load', leanLoad ? 'fail' : 'pass', 'No lean targets under high load', leanLoad ? leanLoad + ' cells leaner than 13.6:1 at 65% throttle or more' : 'High-load cells stay at 13.6:1 or richer');
    add('adv-delta', advHigh ? 'fail' : 'pass', 'Advance within +4° of baseline under load', advHigh ? advHigh + ' cells exceed +4° at 50% throttle or more' : 'No cell exceeds +4° at load');
    add('knock', knockCells ? 'fail' : worstKnock < 1.5 ? 'warn' : 'pass', 'Knock margin at 100 °C coolant, 40 °C intake', knockCells ? knockCells + ' cells go past the modelled knock limit' : 'Smallest margin ' + worstKnock.toFixed(1) + '°');
    add('egt', hotCells ? 'warn' : 'pass', 'Exhaust temperature below 900 °C', hotCells ? hotCells + ' cells above 900 °C, peak ' + worstEgt.toFixed(0) + ' °C' : 'Peak ' + worstEgt.toFixed(0) + ' °C');
    add('smooth', rough ? 'warn' : 'pass', 'No steps between neighbouring cells', rough ? rough + ' sharp steps. Smooth them before writing' : 'Table surfaces are continuous');
    const s = m.sc;
    add('rev', s.revLimit > 7200 ? 'fail' : s.revLimit > 7000 ? 'warn' : 'pass', 'Rev limit at or below 7200 rpm', 'Set to ' + s.revLimit + ' rpm (baseline 7000)');
    add('idle', s.idle < 900 || s.idle > 1400 ? 'fail' : 'pass', 'Idle target between 900 and 1400 rpm', 'Set to ' + s.idle + ' rpm');
    add('fan', s.fanOn > 108 || s.fanOff >= s.fanOn ? 'fail' : 'pass', 'Fan switches on by 108 °C and off below that', 'On at ' + s.fanOn + ' °C, off at ' + s.fanOff + ' °C');
    let mono = true; for (let i = 1; i < m.thr.length; i++) if (m.thr[i] < m.thr[i - 1]) mono = false;
    add('thr', !mono || m.thr[0] !== 0 ? 'fail' : 'pass', 'Throttle map rises from zero', mono ? 'Grip to butterfly curve is monotonic' : 'Curve goes down as the grip opens');
    const fails = checks.filter(c => c.level === 'fail').length, warns = checks.filter(c => c.level === 'warn').length;
    return { checks, fails, warns, changed, ok: fails === 0 };
  }

  /* ---------- Digital twin ECU ---------- */
  const KPH_PER_1000 = [0, 9, 13, 17.5, 22.5, 28, 34];
  const MASS = 320, SUPPORTED = [0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x14, 0x1F, 0x33, 0x42, 0x44, 0x46, 0x49, 0x4C];
  /* Twin symptoms: physical faults that change the data without setting a code by themselves. */
  const SYMPTOMS = {
    weakBattery: 'Weak battery (low resting voltage, deep dip when cranking)',
    undercharge: 'Charging fault without a code (stator or regulator)',
    overcharge: 'Regulator overcharging',
    airLeak: 'Air leak at a throttle body or intake boot',
    thermoOpen: 'Thermostat stuck open',
    fanDead: 'Cooling fan not running',
    o2Lazy: 'Oxygen sensor stuck lean',
    harness: 'Chafed harness, brief voltage drop-outs',
    gripGlitch: 'Twist grip sensor signal drop-outs'
  };
  const FAULTS = {
    P0117: 'Coolant sensor shorted (reads -40 °C)', P0122: 'Throttle sensor signal lost',
    P0135: 'O2 heater open circuit', P0562: 'Charging fault, low system voltage'
  };
  class Twin {
    constructor() {
      this.map = baselineMap(); this.flash = encodeImage(this.map); this.ecu = 'ok';
      this.ctl = { ign: true, grip: 0, gear: 0, brake: 0, ambient: 30, baro: 100 };
      this.s = { run: false, crank: 0, rpm: 0, v: 0, thr: 0, idleThr: 3, ect: 30, oil: 30, iat: 30, vbat: 12.6, rail: 0, prime: 2, runtime: 0, stft: 0, ltft: 1.5, o2: 0.45, fan: 0, phase: 0, purge: 0, sai: 0, dist: 0, fuelErr: 0.03 };
      this.out = {}; this.dtcs = []; this.pending = []; this.faults = {}; this.faultAge = {}; this.sym = {}; this.rnd = 1;
      this.elm = { echo: true, spaces: true, headers: false }; this.t = 0;
      this.vin = 'SMTD00TWINT120018'; this.prog = null; this.step(0.01);
    }
    setIgnition(on) { this.ctl.ign = on; if (on) this.s.prime = 2; else { this.s.run = false; this.s.crank = 0; } }
    start() { if (this.ctl.ign && !this.s.run && this.ecu === 'ok' && !this.prog) this.s.crank = 0.7; }
    stop() { this.s.run = false; }
    warm(t) { this.s.ect = t; this.s.oil = t; }
    inject(code) { this.faults[code] = true; this.faultAge[code] = 0; }
    heal(code) { delete this.faults[code]; }
    symptom(k, on) { if (on) this.sym[k] = true; else delete this.sym[k]; }
    _rand() { this.rnd = (this.rnd * 16807) % 2147483647; return this.rnd / 2147483647; }
    step(dt) {
      const c = this.ctl, s = this.s, m = this.map; this.t += dt;
      if (!c.ign) { s.run = false; s.crank = 0; }
      if (s.crank > 0) { s.crank -= dt; s.rpm = 280; if (s.crank <= 0) { s.run = true; s.rpm = 900; s.runtime = 0; s.idleThr = 4; s.coldStart = s.ect < 50; } }
      const grip = this.faults.P0122 ? Math.min(c.grip, 12) : c.grip;
      const Y = this.sym;
      const idleTarget = m.sc.idle + Math.max(0, 60 - s.ect) * 6 + (Y.airLeak ? 70 * Math.sin(this.t * 1.7) : 0);
      let e = null;
      if (s.run) {
        if (grip < 1 && (c.gear === 0 || s.rpm < idleTarget + 250)) s.idleThr = clamp(s.idleThr + (idleTarget - s.rpm) * 0.012 * dt, 0.5, 14);
        const target = Math.max(interp1(GRIP_AXIS, m.thr, grip), grip < 1 ? clamp(s.idleThr + clamp((idleTarget - s.rpm) * 0.012, -3, 6), 0.3, 18) : 0);
        s.thr += (target - s.thr) * Math.min(1, dt * 14);
        const closed = s.ect > 55 && s.runtime > 15 && !this.faults.P0135;
        const afrT = interp2(m, m.fuel, s.rpm, s.thr), loop = closed && afrT >= 14.4 && afrT <= 15.0;
        s.phase += dt * 7.5;
        const errNow = s.fuelErr + (Y.airLeak ? 0.17 * (1 - clamp(s.thr / 25, 0, 1)) : 0);
        if (loop && !Y.o2Lazy) { s.stft += ((errNow * 100 - s.ltft) + 1.4 * Math.sin(s.phase) - s.stft) * Math.min(1, dt * 3); s.ltft += s.stft * dt / 45; s.o2 = 0.45 + 0.36 * Math.sign(Math.sin(s.phase)) * Math.min(1, Math.abs(Math.sin(s.phase)) * 3); }
        else if (!loop) { s.stft += (0 - s.stft) * Math.min(1, dt * 4); }
        if (Y.o2Lazy && loop) { s.stft = Math.min(25, s.stft + 6 * dt); s.ltft += s.stft * dt / 45; s.o2 = 0.1 + 0.02 * Math.sin(s.phase); }
        s.stft = clamp(s.stft, -25, 25); s.ltft = clamp(s.ltft, -25, 25);
        const err = s.fuelErr + (Y.airLeak ? 0.17 * (1 - clamp(s.thr / 25, 0, 1)) : 0);
        const afr = afrT * (1 + err) / (1 + (s.stft + s.ltft) / 100);
        if (!loop) s.o2 = this.faults.P0135 || s.runtime < 15 ? 0.45 : afr < 14.5 ? 0.86 : 0.09;
        s.loop = loop;
        e = engineCalc(m, s.rpm, s.thr, { ect: s.ect, iat: s.iat, baro: c.baro, afr });
        const w = Math.max(s.rpm, 300) * Math.PI / 30;
        if (c.gear === 0) {
          s.rpm += e.tq / 0.09 * 30 / Math.PI * dt; s.v = Math.max(0, s.v - (0.4 + c.brake * 0.08 + 0.0012 * s.v * s.v) * dt);
        } else {
          const kg = 1000 * Math.PI / 30 / (KPH_PER_1000[c.gear] / 3.6);
          const drag = 0.39 * s.v * s.v + 47 + c.brake * 26;
          const a = clamp((e.tq * 0.92 * kg - drag) / MASS, -9, 8);
          s.v = Math.max(0, s.v + a * dt);
          s.rpm = Math.max(s.v * 3.6 / KPH_PER_1000[c.gear] * 1000, Math.min(idleTarget + 150, 1150));
        }
        if (s.rpm < 450) { s.run = false; }
        s.rpm = clamp(s.rpm, 0, 7900); s.runtime += dt;
        const q = 1.2 + 0.45 * (e.gross * w / 1000) * (1 + Math.max(0, e.afr - 13.2) * 0.04);
        s.heat = q;
      } else {
        if (s.crank <= 0) s.rpm = Math.max(0, s.rpm - 2500 * dt);
        s.thr += (0 - s.thr) * Math.min(1, dt * 8); s.heat = 0; s.loop = false; s.stft = 0; s.o2 = 0.45;
        s.v = Math.max(0, s.v - (0.5 + c.brake * 0.08 + 0.0012 * s.v * s.v) * dt);
      }
      s.dist += s.v * dt;
      /* thermal */
      if (s.ect >= m.sc.fanOn && c.ign && !Y.fanDead) s.fan = 1; else if (s.ect <= m.sc.fanOff || !c.ign || Y.fanDead) s.fan = 0;
      const open = Y.thermoOpen ? 1 : clamp((s.ect - 82) / 10, 0, 1);
      const rej = open * (s.ect - c.ambient) * (0.008 + 0.012 * s.v + (s.fan ? 0.12 : 0)) + (s.ect - c.ambient) * 0.003;
      s.ect = Math.min(124, s.ect + (s.heat - rej) / 25 * dt);
      s.oil += (s.ect + (e ? 8 * e.frac : 0) - s.oil) * dt / 60;
      s.iat += ((c.ambient + (s.v < 3 ? (s.ect - c.ambient) * 0.18 : 2)) - s.iat) * dt / 20;
      /* electrical and fuel delivery */
      if (s.prime > 0) s.prime -= dt;
      const pump = c.ign && (s.prime > 0 || s.run || s.crank > 0) ? 1 : 0;
      s.rail += ((pump ? 350 : Math.max(0, s.rail - 2)) - s.rail) * Math.min(1, dt * (pump ? 4 : 0.05));
      let vb = !c.ign ? 12.6 : s.crank > 0 ? 10.4 : s.run ? 13.4 + clamp((s.rpm - 1000) / 2000, 0, 1) * 0.8 - (s.fan ? 0.2 : 0) : pump ? 12.3 : 12.5;
      if (this.faults.P0562) vb -= s.run ? 2.6 : 0.9;
      if (Y.weakBattery) vb = !c.ign ? 12.05 : s.crank > 0 ? 8.5 : s.run ? vb : vb - 0.45;
      if (Y.undercharge && s.run) vb = 12.35 - (s.fan ? 0.2 : 0);
      if (Y.overcharge && s.run) vb = 13.6 + clamp((s.rpm - 1000) / 1500, 0, 1) * 2.3;
      if (Y.harness && s.run && s.v > 3) { if (!(s.dip > 0) && this._rand() < dt / 9) s.dip = 1.2; }
      if (s.dip > 0) { s.dip -= dt; vb = 8.6; }
      s.vbat += (vb - s.vbat) * Math.min(1, dt * (s.dip > 0 ? 40 : 6));
      s.purge = s.run && s.loop && s.ect > 70 && s.thr > 5 ? 20 + 20 * clamp(s.thr / 40, 0, 1) : 0;
      s.sai = s.run && s.coldStart && s.runtime < 40 ? 1 : 0;
      /* fault to DTC */
      Object.keys(this.faults).forEach(code => { this.faultAge[code] = (this.faultAge[code] || 0) + dt; if (this.faultAge[code] > 2 && !this.dtcs.includes(code)) { this.dtcs.push(code); } });
      if (this.ecu === 'corrupt' && !this.dtcs.includes('P0605')) this.dtcs.push('P0605');
      const o = this.out;
      o.rpm = s.rpm; o.speed = s.v * 3.6; o.tps = this.faults.P0122 ? 0 : s.thr; o.thrCmd = s.thr; o.grip = Y.gripGlitch && c.grip > 8 && (this.t % 1.9) < 0.35 ? 0 : c.grip;
      o.ect = this.faults.P0117 ? -40 : s.ect; o.oil = s.oil; o.iat = s.iat; o.ambient = c.ambient; o.baro = c.baro;
      o.vbat = s.vbat; o.stft = s.stft; o.ltft = s.ltft; o.o2 = s.o2; o.runtime = s.runtime;
      o.map = e ? e.mapKpa + (Y.airLeak ? 9 * (1 - e.frac) : 0) : c.baro; o.load = e ? e.frac * 100 : 0; o.adv = e ? e.adv : 0; o.afr = e ? e.afr : 0;
      o.lambdaCmd = e ? e.afrT / 14.7 : 1; o.torque = e ? e.tq : 0; o.power = e ? e.power : 0; o.egt = e ? e.egt : s.ect;
      o.knockMargin = e ? e.knockMargin : 12; o.injPw = e ? e.injPw : 0; o.injDuty = e ? e.injDuty : 0; o.maf = e ? e.maf : 0;
      o.railKpa = s.rail; o.pump = pump; o.fan = s.fan; o.purge = s.purge; o.sai = s.sai; o.thermostat = open * 100; o.gear = c.gear;
      o.loop = s.loop ? 2 : s.run ? (s.ect < 55 ? 1 : 4) : 0; o.run = s.run ? 1 : 0;
      o.fuelSys = s.run ? (this.faults.P0135 && s.ect > 55 ? 8 : o.loop || 1) : 0;
    }
    get mil() { return this.dtcs.length > 0; }
    /* ELM327 command interpreter. Returns the reply text without the prompt. */
    command(raw) {
      const cmd = raw.replace(/\s+/g, '').toUpperCase(), el = this.elm, sp = el.spaces ? ' ' : '';
      const fmt = bytes => bytes.map(hex2).join(sp);
      if (cmd.startsWith('AT')) {
        const a = cmd.slice(2);
        if (a === 'Z' || a === 'WS') { el.echo = true; el.spaces = true; el.headers = false; return 'ELM327 v1.5'; }
        if (a === 'I') return 'ELM327 v1.5'; if (a === '@1') return 'T120 BENCH TWIN';
        if (a === 'E0') { el.echo = false; return 'OK'; } if (a === 'E1') { el.echo = true; return 'OK'; }
        if (a === 'S0') { el.spaces = false; return 'OK'; } if (a === 'S1') { el.spaces = true; return 'OK'; }
        if (a === 'H0') { el.headers = false; return 'OK'; } if (a === 'H1') { el.headers = true; return 'OK'; }
        if (a === 'RV') return this.s.vbat.toFixed(1) + 'V'; if (a === 'DPN') return 'A6'; if (a === 'DP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
        if (/^(L[01]|SP[0-9A]+|AT[012]|ST[0-9A-F]+|D|M[01]|CAF[01])$/.test(a)) return 'OK';
        return '?';
      }
      if (!/^[0-9A-F]+$/.test(cmd) || cmd.length < 2) return '?';
      if (cmd.length % 2 === 1) { if (this.noCount || cmd.length < 5) return '?'; return this.command(cmd.slice(0, -1)); }
      if (!this.ctl.ign || this.prog) return 'UNABLE TO CONNECT';
      if (this.ecu === 'corrupt' && cmd !== '03' && cmd !== '0101') return 'NO DATA';
      const mode = parseInt(cmd.slice(0, 2), 16), pid = cmd.length >= 4 ? parseInt(cmd.slice(2, 4), 16) : null;
      if (mode === 1) {
        if (pid === 0x00 || pid === 0x20 || pid === 0x40) {
          let bits = 0; SUPPORTED.forEach(p => { if (p > pid && p <= pid + 0x20) bits |= 1 << (32 - (p - pid)); });
          if (SUPPORTED.some(p => p > pid + 0x20)) bits |= 1; bits >>>= 0;
          return fmt([0x41, pid, bits >>> 24, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255]);
        }
        if (pid === 0x01) return fmt([0x41, 0x01, (this.mil ? 0x80 : 0) | this.dtcs.length, 0x07, 0x61, 0x00]);
        const def = PID_BY_ID[pid];
        if (!def || !SUPPORTED.includes(pid)) return 'NO DATA';
        return fmt([0x41, pid].concat(def.enc(this.out[def.key])));
      }
      if (mode === 3 || mode === 7) {
        const list = mode === 3 ? this.dtcs : this.pending, bytes = [0x40 + mode, list.length];
        list.forEach(d => bytes.push.apply(bytes, dtcToBytes(d)));
        return fmt(bytes);
      }
      if (mode === 4) {
        if (this.s.run) return fmt([0x7F, 0x04, 0x22]);
        this.dtcs = []; this.pending = []; Object.keys(this.faultAge).forEach(k => { this.faultAge[k] = 0; }); return fmt([0x44]);
      }
      if (mode === 9 && pid === 2) {
        const b = [0x49, 0x02, 0x01].concat(this.vin.split('').map(ch => ch.charCodeAt(0)));
        const lines = ['014']; for (let i = 0, n = 0; i < b.length; i += (i ? 7 : 6), n++) lines.push(n.toString(16).toUpperCase() + ':' + sp + fmt(b.slice(i, i + (i ? 7 : 6))));
        return lines.join('\r');
      }
      return 'NO DATA';
    }
    /* ----- programming interface used by the flash rehearsal ----- */
    progEnter() {
      if (!this.ctl.ign) throw new Error('Ignition is off. The ECU is not powered.');
      if (this.s.run || this.s.rpm > 0) throw new Error('Engine is running. The ECU refuses a programming session.');
      if (this.s.vbat < 12.0) throw new Error('Battery at ' + this.s.vbat.toFixed(1) + ' V. The ECU needs 12.0 V or more.');
      this.prog = { erased: false, written: new Set() };
    }
    progErase() { if (!this.prog) throw new Error('No programming session'); this.flash.fill(0xFF); this.prog.erased = true; this.ecu = 'corrupt'; }
    progWrite(i, bytes) {
      if (!this.prog || !this.prog.erased) throw new Error('Flash not erased');
      if (this.s.vbat < 11.0) throw new Error('Voltage dropped to ' + this.s.vbat.toFixed(1) + ' V during write');
      this.flash.set(bytes, i * BLOCK); this.prog.written.add(i);
    }
    progRead(i) { return this.flash.slice(i * BLOCK, (i + 1) * BLOCK); }
    progExit() {
      this.prog = null;
      if (imageCrcOk(this.flash)) { this.map = decodeImage(this.flash, 'Active twin calibration'); this.ecu = 'ok'; this.dtcs = this.dtcs.filter(d => d !== 'P0605'); return true; }
      this.ecu = 'corrupt'; return false;
    }
  }

  /* ---------- Transports ---------- */
  class TwinTransport {
    constructor(twin, opts) { this.twin = twin; this.latency = (opts && opts.latency) || 6; this.onData = null; this.buf = ''; this.kind = 'twin'; this.name = 'Digital twin'; this.dropNext = 0; }
    async open() { }
    async close() { }
    async write(str) {
      this.buf += str; let i;
      while ((i = this.buf.indexOf('\r')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        if (this.dropNext > 0) { this.dropNext--; continue; }
        const reply = (this.twin.elm.echo ? line + '\r' : '') + this.twin.command(line) + '\r\r>';
        setTimeout(() => this.onData && this.onData(reply), this.latency);
      }
    }
  }
  const BLE_SERVICES = [0xfff0, 0xffe0, 0x18f0, '6e400001-b5a3-f393-e0a9-e50e24dcca9e', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
  class BleTransport {
    constructor() { this.onData = null; this.onClose = null; this.kind = 'ble'; this.name = 'BLE adapter'; }
    static supported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }
    async open() {
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      this.dev = dev; this.name = dev.name || 'BLE adapter';
      dev.addEventListener('gattserverdisconnected', () => this.onClose && this.onClose());
      const server = await dev.gatt.connect();
      const services = await server.getPrimaryServices();
      let tx = null, rx = null;
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        const n = chars.find(ch => ch.properties.notify || ch.properties.indicate);
        const w = chars.find(ch => ch.properties.writeWithoutResponse) || chars.find(ch => ch.properties.write);
        if (n && w) { rx = n; tx = w; break; }
      }
      if (!tx || !rx) { try { dev.gatt.disconnect(); } catch (e) { } throw new Error('This device has no serial-style BLE service. It may be a classic Bluetooth adapter, which browsers cannot reach.'); }
      this.tx = tx; this.rx = rx; const td = new TextDecoder();
      rx.addEventListener('characteristicvaluechanged', ev => this.onData && this.onData(td.decode(ev.target.value)));
      await rx.startNotifications();
    }
    async write(str) {
      const data = new TextEncoder().encode(str);
      for (let i = 0; i < data.length; i += 20) {
        const chunk = data.slice(i, i + 20);
        if (this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
        else await this.tx.writeValue(chunk);
      }
    }
    async close() { try { this.dev && this.dev.gatt.disconnect(); } catch (e) { } }
  }

  /* WiFi adapters speak raw TCP, which browsers cannot open. This talks to the local bridge over WebSocket. */
  class WsTransport {
    constructor(url) { this.url = url; this.onData = null; this.onClose = null; this.kind = 'wifi'; this.name = 'WiFi adapter via ' + url; }
    static supported() { return typeof WebSocket !== 'undefined'; }
    open() {
      return new Promise((resolve, reject) => {
        let ws, done = false; const fail = m => { if (!done) { done = true; reject(new Error(m)); } };
        try { ws = new WebSocket(this.url); } catch (e) { return fail('The browser refused to open ' + this.url + ' (' + e.message + ')'); }
        this.ws = ws; ws.binaryType = 'arraybuffer'; const td = new TextDecoder();
        const timer = setTimeout(() => { fail('No answer from the bridge at ' + this.url + ' within 6 s'); try { ws.close(); } catch (e) { } }, 6000);
        ws.onopen = () => setTimeout(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } }, 200);
        ws.onmessage = ev => this.onData && this.onData(typeof ev.data === 'string' ? ev.data : td.decode(ev.data));
        ws.onerror = () => { clearTimeout(timer); fail('Could not reach the bridge at ' + this.url + '. Is t120-wifi-bridge.js running, and is this page allowed by it?'); };
        ws.onclose = ev => { clearTimeout(timer); if (!done) fail(ev.reason || 'The bridge closed the connection'); else if (this.onClose) this.onClose(ev.reason); };
      });
    }
    async write(str) { if (!this.ws || this.ws.readyState !== 1) throw new Error('WiFi bridge link is closed'); this.ws.send(str); }
    async close() { try { this.onClose = null; this.ws && this.ws.close(); } catch (e) { } }
  }

  /* ---------- Acceleration from the road-speed signal ----------
     Speed arrives in whole km/h at the polling rate, so timings carry about one sample period of uncertainty. */
  class AccelMeter {
    constructor() { this.s = []; this.runs = []; this.best = {}; this.last = {}; this.peakG = 0; this.g = 0; this.rate = 0; this.launch = null; this.maxV = 0; this.roll = {}; this.runPeak = 0; }
    _rec(name, time, t, out) { const r = { name, time, at: t, peakG: this.runPeak, period: this.rate ? 1 / this.rate : null }; this.runs.push(r); this.last[name] = time; if (this.best[name] == null || time < this.best[name]) this.best[name] = time; out.push(r); }
    add(t, v) {
      const s = this.s, p = s[s.length - 1], out = []; if (p && t <= p.t) return out;
      let i = s.length - 1; while (i > 0 && t - s[i - 1].t <= 2) i--; this.rate = s.length - i > 1 ? (s.length - i) / (t - s[i].t) : 0;
      /* slope of speed over the last 0.7 s by least squares */
      let k = s.length - 1; while (k > 0 && t - s[k - 1].t <= 0.7) k--; const w = s.slice(k).concat([{ t, v }]);
      if (w.length >= 3 && t - w[0].t >= 0.3) { let mt = 0, mv = 0; w.forEach(q => { mt += q.t; mv += q.v; }); mt /= w.length; mv /= w.length; let a = 0, b = 0; w.forEach(q => { a += (q.t - mt) * (q.v - mv); b += (q.t - mt) * (q.t - mt); }); this.g = clamp(a / b / 3.6 / 9.81, -1.5, 1.5); } else this.g = 0;
      if (this.g > this.peakG) this.peakG = this.g; if (this.g > this.runPeak) this.runPeak = this.g;
      s.push({ t, v, g: this.g }); if (s.length > 1500) s.shift();
      if (!p) return out;
      const cross = th => p.v < th && v >= th ? p.t + (th - p.v) / (v - p.v) * (t - p.t) : null;
      if (v < 1) { this.launch = null; this.maxV = 0; this.runPeak = 0; }
      else if (p.v < 1) { this.launch = p.t; this.maxV = v; this.done = {}; }
      if (this.launch != null) {
        this.maxV = Math.max(this.maxV, v); if (v < this.maxV - 5) this.launch = null;
        else [60, 100].forEach(th => { const tc = cross(th); if (tc != null && !this.done[th]) { this.done[th] = 1; this._rec('0-' + th, tc - this.launch, t, out); } });
      }
      [[60, 100], [80, 120]].forEach(([lo, hi]) => {
        const key = lo + '-' + hi; if (v < lo) this.roll[key] = null;
        const tl = cross(lo); if (tl != null) this.roll[key] = tl;
        const th = cross(hi); if (th != null && this.roll[key] != null) { this._rec(key, th - this.roll[key], t, out); this.roll[key] = null; }
      });
      return out;
    }
  }

  /* ---------- ELM327 client ---------- */
  function parseObd(raw, mode, pid) {
    const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(l => l && !/^SEARCHING/i.test(l));
    if (!lines.length) return { error: 'EMPTY' };
    const bad = lines.find(l => /NO DATA|UNABLE|ERROR|STOPPED|BUS|^\?$/i.test(l));
    if (bad) return { error: bad.toUpperCase() };
    let cands;
    if (lines.some(l => /^[0-9A-F]:/i.test(l))) cands = [lines.filter(l => /^[0-9A-F]:/i.test(l)).map(l => l.slice(2)).join('')];
    else cands = lines;
    const want = hex2(mode + 0x40) + (pid == null ? '' : hex2(pid));
    for (let c of cands) {
      c = c.replace(/\s+/g, '').toUpperCase();
      if (c.length % 2 === 1 && /^7E[0-9A-F]/.test(c)) c = c.slice(5); /* 11-bit CAN header plus length byte */
      if (!/^[0-9A-F]+$/.test(c)) continue;
      const at = c.indexOf(want);
      if (at >= 0 && at % 2 === 0 && at <= 10) {
        const h = c.slice(at + want.length), bytes = [];
        for (let i = 0; i + 1 < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
        return { bytes };
      }
      if (c.startsWith('7F')) return { error: 'ECU REFUSED (' + c.slice(4, 6) + ')' };
    }
    return { error: 'UNEXPECTED: ' + lines.join(' | ') };
  }
  class Elm {
    constructor(transport) {
      this.tp = transport; this.rx = ''; this.waiter = null; this.chain = Promise.resolve(); this.supported = new Set(); this.info = {}; this.tx = 0; this.errors = 0; this.lat = 0;
      transport.onData = d => { this.rxAt = Date.now(); this.rx += d; const i = this.rx.indexOf('>'); if (i >= 0 && this.waiter) { const r = this.rx.slice(0, i); this.rx = this.rx.slice(i + 1); const w = this.waiter; this.waiter = null; w(r); } };
    }
    cmd(str, timeout) {
      const run = async () => { if (this.dirty) await this._drain(); return new Promise((resolve, reject) => {
        this.rx = ''; const t0 = Date.now();
        const timer = setTimeout(() => { this.waiter = null; this.errors++; this.dirty = true; reject(new Error('No reply to ' + str + ' within ' + (timeout || 2500) + ' ms')); }, timeout || 2500);
        this.waiter = r => { clearTimeout(timer); this.lat = this.lat * 0.8 + (Date.now() - t0) * 0.2; resolve(r); };
        this.tx++; this.tp.write(str + '\r').catch(e => { clearTimeout(timer); this.waiter = null; reject(e); });
      }); };
      const p = this.chain.then(run, run); this.chain = p.catch(() => { }); return p;
    }
    /* After a timeout or a run of mismatched replies, a late answer may still be in flight.
       Wait for the line to go quiet so the next command is not paired with the previous reply. */
    async _drain() {
      this.dirty = false; this.mismatch = 0; this.resyncs = (this.resyncs || 0) + 1; const t0 = Date.now();
      while (Date.now() - t0 < 2000 && (Date.now() - (this.rxAt || 0) < 250 || Date.now() - t0 < 250)) await sleep(40);
      this.rx = '';
    }
    async init() {
      const clean = r => r.replace(/[\r\n]+/g, ' ').replace(/^AT\S*\s*/i, '').trim();
      this.info.adapter = clean(await this.cmd('ATZ', 4000));
      for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) await this.cmd(c);
      this.info.voltage = clean(await this.cmd('ATRV'));
      const r = await this.query(1, 0, 9000);
      if (r.error) throw new Error('Adapter is up but the ECU did not answer (' + r.error + '). Turn the ignition on and try again.');
      this.info.protocol = clean(await this.cmd('ATDP'));
      this.supported = new Set(); this._bits(0, r.bytes);
      for (const base of [0x20, 0x40]) { if (!this.supported.has(base)) break; const q = await this.query(1, base); if (q.bytes) this._bits(base, q.bytes); }
      /* Ask the adapter to return after one reply instead of waiting out its timeout. Clones that lack this answer '?'. */
      this.fast = false; try { const f = parseObd(await this.cmd('010C1'), 1, 0x0C); this.fast = !!f.bytes; } catch (e) { }
      this.info.fast = this.fast;
      const v = await this.query(9, 2, 4000);
      this.info.vin = v.bytes ? String.fromCharCode.apply(null, v.bytes.slice(1).filter(b => b >= 32 && b < 127)) : 'Not reported';
      return this.info;
    }
    _bits(base, b) { for (let i = 0; i < 32; i++) if (b[i >> 3] & (0x80 >> (i & 7))) this.supported.add(base + i + 1); }
    async query(mode, pid, timeout, one) {
      const raw = await this.cmd(hex2(mode) + (pid == null ? '' : hex2(pid)) + (one ? '1' : ''), timeout);
      const r = parseObd(raw, mode, pid);
      if (r.error && /^UNEXPECTED/.test(r.error)) { this.mismatch = (this.mismatch || 0) + 1; if (this.mismatch >= 2) this.dirty = true; } else this.mismatch = 0;
      return r;
    }
    async read(key) {
      const def = PID_BY_KEY[key]; const r = await this.query(1, def.pid, undefined, this.fast);
      return r.bytes ? def.dec(r.bytes) : null;
    }
    async status() {
      const r = await this.query(1, 1); if (!r.bytes) return null;
      return { mil: !!(r.bytes[0] & 0x80), count: r.bytes[0] & 0x7F };
    }
    async dtcs(mode) {
      const r = await this.query(mode || 3, null, 4000); if (r.error) return r.error.startsWith('NO DATA') ? [] : { error: r.error };
      let b = r.bytes; if (b.length % 2 === 1) b = b.slice(1); /* CAN replies lead with a count byte */
      const out = []; for (let i = 0; i + 1 < b.length; i += 2) if (b[i] || b[i + 1]) out.push(dtcFromBytes(b[i], b[i + 1]));
      return out;
    }
    async clearDtcs() { const r = await this.query(4, null, 5000); return r.error ? { ok: false, error: r.error } : { ok: true }; }
    async voltage() { const r = await this.cmd('ATRV'); const m = /([\d.]+)\s*V/i.exec(r); return m ? parseFloat(m[1]) : null; }
  }

  /* ---------- Flash rehearsal against the twin ---------- */
  async function rehearseFlash(twin, image, opts) {
    opts = opts || {}; const on = opts.onEvent || (() => { }), delay = opts.blockDelay == null ? 25 : opts.blockDelay;
    const blocks = IMG_SIZE / BLOCK, backup = twin.flash.slice();
    const res = { ok: false, stage: 'preflight', blocks, written: 0, backup, error: null, recovered: false };
    const log = (stage, msg, level) => { res.stage = stage; on({ stage, msg, level: level || 'info', written: res.written, blocks }); };
    try {
      log('preflight', 'Checking image checksum');
      if (!imageCrcOk(image)) throw new Error('Image checksum is invalid. Nothing was sent.');
      log('preflight', 'Backup of current calibration held in memory, CRC ' + crc32(backup, IMG_SIZE - 4).toString(16).toUpperCase());
      log('session', 'Requesting programming session');
      twin.progEnter();
      log('session', 'Security access granted (twin accepts a fixed key)');
      log('erase', 'Erasing calibration area'); twin.progErase(); await sleep(delay * 4);
      for (let i = 0; i < blocks; i++) {
        if (opts.dropAt === i) throw new Error('Bluetooth link dropped at block ' + (i + 1) + ' of ' + blocks);
        if (opts.sagAt === i) { twin.s.vbat = 10.6; }
        twin.progWrite(i, image.slice(i * BLOCK, (i + 1) * BLOCK)); res.written = i + 1;
        log('write', 'Block ' + (i + 1) + '/' + blocks); if (delay) await sleep(delay);
      }
      log('verify', 'Reading back and comparing');
      for (let i = 0; i < blocks; i++) { const rb = twin.progRead(i); for (let j = 0; j < BLOCK; j++) if (rb[j] !== image[i * BLOCK + j]) throw new Error('Verify mismatch in block ' + (i + 1)); }
      const good = twin.progExit();
      if (!good) throw new Error('ECU rejected the image after reset');
      res.ok = true; log('done', 'ECU reset. New calibration is active on the twin.', 'good');
    } catch (err) {
      res.error = err.message; const where = res.stage;
      on({ stage: where, msg: err.message, level: 'bad', written: res.written, blocks });
      if (twin.prog && twin.prog.erased) {
        twin.progExit();
        on({ stage: 'failed', msg: 'Twin ECU now has a partial image and will not start. On a real bike this is the bricked state.', level: 'bad', written: res.written, blocks });
      } else { twin.prog = null; on({ stage: 'failed', msg: 'Stopped before erase. The ECU is untouched.', level: 'warn', written: 0, blocks }); }
    }
    return res;
  }
  async function recoverFlash(twin, backup, onEvent) {
    twin.s.vbat = Math.max(twin.s.vbat, 12.4); delete twin.faults.P0562;
    return rehearseFlash(twin, backup, { onEvent, blockDelay: 8 });
  }

  /* ---------- Ride scenario for the twin (keeps the demo alive) ---------- */
  function rideScenario(twin) {
    let t = 0; const c = twin.ctl;
    const plan = [[0, 0, 0], [4, 1, 22], [7, 2, 30], [10, 3, 34], [14, 4, 26], [20, 5, 20], [30, 6, 16], [42, 6, 62], [47, 6, 18], [58, 5, 0], [62, 4, 0], [66, 3, 0], [70, 2, 0], [73, 0, 0], [84, 0, 0]];
    return dt => {
      t += dt; const tt = t % 84; let cur = plan[0];
      for (const p of plan) if (tt >= p[0]) cur = p;
      c.gear = cur[1]; c.grip += (cur[2] - c.grip) * Math.min(1, dt * 2.5); c.brake = cur[2] === 0 && cur[1] > 0 ? 35 : 0;
      if (!twin.s.run && twin.s.crank <= 0 && c.ign && twin.ecu === 'ok') twin.start();
    };
  }

  const api = { PIDS, PID_BY_KEY, PID_BY_ID, MODEL_CHANNELS, DTC_TEXT, FAULTS, SYMPTOMS, RPM_AXIS, LOAD_AXIS, GRIP_AXIS, IMG_SIZE, BLOCK, baselineMap, cloneMap, interp1, interp2, crc32, encodeImage, decodeImage, imageCrcOk, engineCalc, dynoSweep, validateMap, Twin, TwinTransport, BleTransport, WsTransport, AccelMeter, Elm, parseObd, rehearseFlash, recoverFlash, rideScenario, dtcFromBytes, dtcToBytes, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.T120 = api;
})(typeof window !== 'undefined' ? window : globalThis);
