(function () {
  'use strict';
  const T = window.T120, clamp = T.clamp;
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const CH = {}; T.PIDS.forEach(p => { CH[p.key] = Object.assign({ src: 'pid' }, p); }); T.MODEL_CHANNELS.forEach(c => { CH[c.key] = Object.assign({ src: 'model' }, c); });
  const GROUPS = [['engine', 'Engine'], ['air', 'Air and throttle'], ['fuel', 'Fuel'], ['thermal', 'Thermal'], ['valves', 'Valves and actuators'], ['electrical', 'Electrical']];

  const S = {
    source: 'twin', twin: new T.Twin(), session: null, live: {}, hist: [], t0: Date.now(), auto: true, busy: false,
    stock: T.baselineMap(), work: T.baselineMap(), table: 'fuel', delta: false, sel: new Set(), anchor: null,
    acc: new T.AccelMeter(), launch: null, drive: null, test: null, diag: null, diagSel: null, toasted: {}, backup: null, backupAt: null, clean: 0, lastFlash: null, dtcs: [], pending: [], dtcRead: false, mil: false, dtcCount: 0, answering: false, events: [], val: null, dyno: null
  };
  S.work.name = 'Working copy';
  const scenario = T.rideScenario(S.twin);
  S.twin.warm(84);
  const baseDyno = T.dynoSweep(S.stock);
  const event = (msg, level) => { S.events.push({ t: new Date(), msg, level: level || 'info' }); if (S.events.length > 200) S.events.shift(); };

  /* ---------- availability and formatting ---------- */
  const elm = () => S.session && S.session.elm;
  function avail(key) {
    const c = CH[key]; if (!c) return false;
    if (c.src === 'pid') return !!(elm() && elm().supported.has(c.pid));
    return S.source === 'twin';
  }
  function fmt(key, v) {
    const c = CH[key]; if (v == null || isNaN(v)) return '–';
    if (c.state) return c.state[Math.round(v)] || '–';
    if (c.labels) return c.labels[Math.round(v)] || String(Math.round(v));
    return v.toFixed(c.dp);
  }
  const tagFor = key => { const c = CH[key]; return c.src === 'pid' ? '<span class="tag">PID ' + c.pid.toString(16).toUpperCase().padStart(2, '0') + '</span>' : '<span class="tag model">Twin model</span>'; };

  /* ---------- modal ---------- */
  function modal(html, wire) { $('#modalBox').innerHTML = html; $('#modal').classList.add('on'); $$('#modalBox [data-close]').forEach(b => b.onclick = closeModal); if (wire) wire($('#modalBox')); const f = $('#modalBox button'); if (f) f.focus(); }
  function closeModal() { $('#modal').classList.remove('on'); }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  function exportFile(name, mime, text) {
    if (S.source === 'twin' || /map/.test(name)) name = 'SIMULATED-' + name;
    if (!inFrame) {
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); event('Exported ' + name); return; } catch (e) { }
    }
    modal('<h3>' + esc(name) + '</h3><p>This preview cannot save files. Copy the content, or open the hosted copy of the app to download directly.</p><textarea readonly id="expTa"></textarea><div class="row"><button class="btn pri" id="expCopy">Copy to clipboard</button><button class="btn" data-close>Close</button></div>', box => {
      box.querySelector('#expTa').value = text;
      box.querySelector('#expCopy').onclick = async ev => { try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Copied'; } catch (e) { box.querySelector('#expTa').select(); ev.target.textContent = 'Select all, then copy'; } };
    });
  }

  /* ---------- sessions and polling ---------- */
  async function startSession(source, tp) {
    const el = new T.Elm(tp), ses = { elm: el, tp, source, link: tp.kind, fail: 0, info: {} };
    ses.info = await el.init();
    S.session = ses; S.source = source; S.live = {}; S.acc = new T.AccelMeter(); S.launch = null; S.dtcRead = false; S.dtcs = []; S.pending = [];
    S.diag.reset(); renderDiag(true);
    resetLog(); event(source === 'twin' ? 'Connected to digital twin' : 'Connected to ' + tp.name + ', VIN ' + ses.info.vin + (ses.info.fast ? ', fast reply mode on' : ''), 'good');
    buildStatic(); pollLoop(ses); return ses;
  }
  async function pollLoop(ses) {
    const el = ses.elm, id = ses.loop = (ses.loop || 0) + 1; let si = 0, n = 0;
    while (S.session === ses && ses.loop === id) {
      const sup = T.PIDS.filter(p => el.supported.has(p.pid)), fast = sup.filter(p => p.fast), slow = sup.filter(p => !p.fast);
      try {
        const fk = S.test && S.test.focus ? S.test.focus : S.view === 'accel' ? ['speed', 'rpm', 'tps'] : null, focus = !!fk;
        const list = fk ? sup.filter(p => fk.includes(p.key) || (fk.includes('volts') && p.key === 'vbat')) : fast;
        if (fk && fk.includes('volts') && !el.supported.has(0x42)) { const v = await el.voltage(); if (v) { S.live.atrv = v; S.adapterV = v; } }
        for (const p of list) {
          const v = await el.read(p.key); if (p.key === 'rpm') S.answering = v !== null; if (v === null) continue; S.live[p.key] = v;
          if (p.key === 'speed') S.acc.add(performance.now() / 1000, v).forEach(r => event(r.name.replace('-', ' to ') + ' km/h in ' + r.time.toFixed(2) + ' s' + (ses.source === 'twin' ? ' (simulated)' : ''), 'good'));
        }
        for (let k = 0; k < (focus ? (n % 8 === 0 ? 1 : 0) : 3) && slow.length; k++) { const p = slow[si++ % slow.length]; const v = await el.read(p.key); if (v !== null) S.live[p.key] = v; }
        if (n % 20 === 0) {
          const st = await el.status();
          if (st) { S.mil = st.mil; if (st.count !== S.dtcCount || !S.dtcRead) { S.dtcCount = st.count; await readDtcs(true); } }
          const v = await el.voltage(); if (v) { S.adapterV = v; S.live.atrv = v; }
        }
        ses.fail = 0;
      } catch (e) {
        if (S.session !== ses || ses.loop !== id) return; /* a superseded loop must not touch shared state */
        ses.fail++; S.answering = false;
        if (ses.fail > 6 && ses.source === 'ecu') { event('Link lost: ' + e.message, 'bad'); await toTwin(); modal('<h3>Adapter link lost</h3><p>' + esc(e.message) + '</p><p>The app is back on the digital twin. Check the adapter is seated and the ignition is on, then connect again.</p><div class="row"><button class="btn pri" data-close>OK</button></div>'); return; }
        await sleep(150);
      }
      n++; await sleep(ses.source === 'ecu' ? 10 : 4);
    }
  }
  async function toTwin() {
    if (S.session && S.session.source === 'ecu') { try { await S.session.tp.close(); } catch (e) { } }
    S.session = null; await startSession('twin', new T.TwinTransport(S.twin, { latency: 5 }));
  }
  const defaultWs = () => { let u = null; try { u = localStorage.getItem('t120.ws'); } catch (e) { } return u || (location.protocol === 'http:' ? 'ws://' + location.host + '/elm' : 'ws://localhost:8765/elm'); };
  function connectChooser() {
    if (S.source === 'ecu') { event('Disconnected from adapter'); return toTwin(); }
    modal('<h3>Connect to the bike</h3><p><b>Bluetooth LE adapter.</b> Works straight from Chrome or Edge on Android, Windows, macOS and ChromeOS.</p><div class="row"><button class="btn pri" id="cnBle">Connect over Bluetooth</button></div>' +
      '<p style="margin-top:6px"><b>WiFi adapter.</b> WiFi dongles speak raw TCP, which no browser can open. Run <span class="mono">node t120-wifi-bridge.js</span> on a computer joined to the adapter network, then connect here.</p><div class="row"><label for="cnUrl" class="row" style="gap:6px;flex:1">Bridge address <input class="fld" id="cnUrl" type="text" style="flex:1;min-width:180px" spellcheck="false"></label><button class="btn pri" id="cnWifi">Connect over WiFi</button></div><div class="row"><button class="btn" data-close>Cancel</button></div>', box => {
      box.querySelector('#cnUrl').value = defaultWs();
      box.querySelector('#cnBle').onclick = () => { closeModal(); connectBle(); };
      box.querySelector('#cnWifi').onclick = () => { const u = box.querySelector('#cnUrl').value.trim(); try { localStorage.setItem('t120.ws', u); } catch (e) { } closeModal(); connectVia(new T.WsTransport(u), 'wifi'); };
    });
  }
  function connectBle() {
    if (!T.BleTransport.supported()) {
      return modal('<h3>This browser has no Web Bluetooth</h3><p>The Bluetooth link needs the Web Bluetooth API on HTTPS or localhost.</p><ul><li><b>Android, Windows, macOS, ChromeOS:</b> open this app in Chrome or Edge.</li><li><b>iPhone and iPad:</b> Safari, Chrome and Firefox all lack it there. Use a Web Bluetooth browser such as Bluefy, or a Safari Web BLE extension.</li><li><b>Adapter:</b> must be Bluetooth Low Energy. Classic Bluetooth ELM327 dongles cannot be reached from a browser.</li></ul><p>Everything else works on the digital twin in the meantime.</p><div class="row"><button class="btn pri" data-close>OK</button></div>');
    }
    return connectVia(new T.BleTransport(), 'ble');
  }
  async function connectVia(tp, kind) {
    try {
      setChip('#linkChip', 'warn', kind === 'ble' ? 'Pairing' : 'Reaching bridge'); await tp.open();
      setChip('#linkChip', 'warn', 'Talking to ECU'); const prev = S.session; S.session = null;
      try { await startSession('ecu', tp); tp.onClose = why => { if (S.session && S.session.tp === tp) { event('Adapter link closed' + (why ? ': ' + why : ''), 'bad'); toTwin(); } }; }
      catch (e) { S.session = prev; if (prev) pollLoop(prev); try { await tp.close(); } catch (x) { } throw e; }
    } catch (e) {
      if (e && e.name === 'NotFoundError') return;
      const framed = e && e.name === 'SecurityError';
      modal('<h3>Could not connect</h3><p>' + esc(e.message || e) + '</p>' + (framed ? '<p>This embedded preview blocks Bluetooth. Open the hosted copy of the app in its own tab.</p>' : kind === 'wifi' ? '<ul><li>Start the bridge: <span class="mono">node t120-wifi-bridge.js</span>, and open the app from the address it prints.</li><li>The bridge computer must be on the adapter WiFi network.</li><li>A page hosted elsewhere needs <span class="mono">--allow-origin</span> on the bridge. The embedded preview cannot reach it at all.</li></ul>' : '<ul><li>Ignition on, kill switch to run, adapter light on.</li><li>Close any other OBD app that is holding the adapter.</li><li>The adapter must be a BLE type.</li></ul>') + '<div class="row"><button class="btn pri" data-close>OK</button></div>');
    }
  }
  $('#btnConnect').onclick = connectChooser;

  /* ---------- twin loop ---------- */
  let lastT = performance.now();
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
    const n = Math.max(1, Math.ceil(dt / 0.02));
    for (let i = 0; i < n; i++) { if (S.drive && S.source === 'twin') { if (S.drive(dt / n) === false) S.drive = null; } else if (S.launch && S.source === 'twin') launchStep(dt / n); else if (S.auto && !S.busy && S.source === 'twin') scenario(dt / n); S.twin.step(dt / n); }
    if (S.source === 'twin') T.MODEL_CHANNELS.forEach(c => { S.live[c.key] = S.twin.out[c.key]; });
  }, 40);

  function launchStep(dt) {
    const L = S.launch, c = S.twin.ctl, s = S.twin.s; L.t += dt;
    if (L.phase === 'settle') { c.grip = 0; c.brake = 100; c.gear = 1; if (!s.run && s.crank <= 0) S.twin.start(); if (s.v < 0.05 && s.run) { L.still += dt; if (L.still > 1.5) { L.phase = 'go'; c.brake = 0; c.grip = 100; } } else L.still = 0; }
    else if (L.phase === 'go') { if (S.twin.out.rpm > 6600 && c.gear < 6) c.gear++; if (S.twin.out.speed >= 132 || L.t > 40) { L.phase = 'brake'; c.grip = 0; c.brake = 70; } }
    else { if (S.twin.out.speed < 60 && c.gear > 3) c.gear = 3; if (S.twin.out.speed < 30) { c.brake = 0; c.gear = 2; S.launch = null; event('Simulated launch finished'); } }
  }

  /* ---------- log ---------- */
  function resetLog() { S.hist = []; S.t0 = Date.now(); }
  const LOGKEYS = Object.keys(CH).filter(k => !CH[k].state);
  setInterval(() => {
    if (!S.session) return; const row = { t: (Date.now() - S.t0) / 1000 };
    LOGKEYS.forEach(k => { if (avail(k) && S.live[k] != null) row[k] = S.live[k]; });
    S.hist.push(row); if (S.hist.length > 36000) S.hist.splice(0, 3000);
    S.diag.feed(diagSample(), diagMeta());
  }, 200);

  /* ---------- charts ---------- */
  function makeChart(host) {
    host.innerHTML = '<div class="legend"></div><canvas></canvas><div class="tip"></div>';
    const cv = host.querySelector('canvas'), tip = host.querySelector('.tip'), lg = host.querySelector('.legend');
    const ch = { model: null, hx: null };
    ch.set = m => { ch.model = m; ch.draw(); };
    ch.draw = () => {
      const m = ch.model, w = cv.clientWidth, h = cv.clientHeight; if (!m || !w) return;
      const dpr = window.devicePixelRatio || 1; if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const L = 40, R = 12, Tp = 8, B = 20, pw = w - L - R, ph = h - Tp - B, x0 = m.xMin, x1 = m.xMax;
      const X = v => L + (v - x0) / (x1 - x0 || 1) * pw, Y = v => Tp + (1 - (clamp(v, m.yMin, m.yMax) - m.yMin) / (m.yMax - m.yMin)) * ph;
      g.font = '11px ' + css('--mono'); g.textBaseline = 'middle'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = m.yMin + (m.yMax - m.yMin) * i / 4, y = Math.round(Y(v)) + 0.5;
        g.strokeStyle = i === 0 ? css('--axis') : css('--grid'); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
        g.fillStyle = css('--muted'); g.textAlign = 'right'; g.fillText(m.yFmt ? m.yFmt(v) : String(Math.round(v * 10) / 10), L - 6, y);
      }
      g.textBaseline = 'alphabetic';
      (m.xTicks || []).forEach((v, i, a) => { g.textAlign = i === 0 ? 'left' : i === a.length - 1 ? 'right' : 'center'; g.fillStyle = css('--muted'); g.fillText(m.xFmt(v), X(v), h - 5); });
      if (m.zero != null && m.zero > m.yMin && m.zero < m.yMax) { g.strokeStyle = css('--axis'); g.beginPath(); g.moveTo(L, Math.round(Y(m.zero)) + 0.5); g.lineTo(w - R, Math.round(Y(m.zero)) + 0.5); g.stroke(); }
      m.series.forEach(s => {
        const col = css(s.color); g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.setLineDash(s.dash ? [5, 4] : []); g.beginPath(); let pen = false;
        for (let i = 0; i < m.x.length; i++) { const v = s.ys[i]; if (v == null) { pen = false; continue; } const px = X(m.x[i]), py = Y(v); if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; } }
        g.stroke(); g.setLineDash([]);
        if (m.live && m.x.length) { const i = m.x.length - 1, v = s.ys[i]; if (v != null) { g.fillStyle = css('--panel'); g.beginPath(); g.arc(X(m.x[i]), Y(v), 5, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(X(m.x[i]), Y(v), 3.5, 0, 7); g.fill(); } }
      });
      const last = m.x.length - 1;
      lg.innerHTML = m.series.map(s => '<span><i class="' + (s.dash ? 'dash' : '') + '" style="background:' + css(s.color) + '"></i>' + esc(s.label) + (m.live && last >= 0 && s.ys[last] != null ? ' <b>' + s.fmt(s.ys[last]) + '</b>' : '') + '</span>').join('');
      if (ch.hx != null && m.x.length) {
        let bi = 0, bd = 1e9; for (let i = 0; i < m.x.length; i++) { const d = Math.abs(X(m.x[i]) - ch.hx); if (d < bd) { bd = d; bi = i; } }
        const px = X(m.x[bi]); g.strokeStyle = css('--muted'); g.lineWidth = 1; g.beginPath(); g.moveTo(px + 0.5, Tp); g.lineTo(px + 0.5, Tp + ph); g.stroke();
        m.series.forEach(s => { const v = s.ys[bi]; if (v == null) return; g.fillStyle = css('--panel'); g.beginPath(); g.arc(px, Y(v), 5, 0, 7); g.fill(); g.fillStyle = css(s.color); g.beginPath(); g.arc(px, Y(v), 3.5, 0, 7); g.fill(); });
        tip.innerHTML = '<b>' + esc(m.xFmt(m.x[bi], true)) + '</b><br>' + m.series.map(s => esc(s.label) + ': ' + (s.ys[bi] == null ? '–' : s.fmt(s.ys[bi]))).join('<br>');
        tip.style.display = 'block'; const tw = tip.offsetWidth; tip.style.left = clamp(px + 10 + tw > w ? px - tw - 10 : px + 10, 0, Math.max(0, w - tw)) + 'px'; tip.style.top = (cv.offsetTop + 6) + 'px';
      } else tip.style.display = 'none';
    };
    cv.addEventListener('pointermove', e => { ch.hx = e.offsetX; ch.draw(); });
    cv.addEventListener('pointerdown', e => { ch.hx = e.offsetX; ch.draw(); });
    cv.addEventListener('pointerleave', () => { ch.hx = null; ch.draw(); });
    return ch;
  }
  const LIVE_CHARTS = [
    { title: 'Engine speed', yMin: 0, yMax: 8000, series: [['rpm', 'Engine speed', '--s1']], unit: ' rpm', dp: 0 },
    { title: 'Grip, butterfly and load', yMin: 0, yMax: 100, series: [['grip', 'Twist grip', '--s1'], ['tps', 'Butterfly', '--s2'], ['load', 'Load', '--s3']], unit: ' %', dp: 0 },
    { title: 'Temperatures', yMin: 0, yMax: 120, series: [['ect', 'Coolant', '--s1'], ['iat', 'Intake air', '--s2'], ['oil', 'Oil', '--s3']], unit: ' °C', dp: 0 },
    { title: 'Fuel trims', yMin: -10, yMax: 10, zero: 0, series: [['stft', 'Short term', '--s1'], ['ltft', 'Long term', '--s2']], unit: ' %', dp: 1 }
  ];
  let liveCharts = [], dynoT, dynoP, repC1, repC2;
  function drawLiveCharts() {
    const now = (Date.now() - S.t0) / 1000, win = 90; let i = S.hist.length; while (i > 0 && S.hist[i - 1].t >= now - win) i--;
    const rows = S.hist.slice(i), x = rows.map(r => r.t - now);
    liveCharts.forEach((c, ci) => {
      const d = LIVE_CHARTS[ci];
      c.set({ live: true, x, xMin: -win, xMax: 0, xTicks: [-90, -60, -30, 0], xFmt: (v, full) => v > -0.5 ? 'now' : Math.round(v) + ' s', yMin: d.yMin, yMax: d.yMax, zero: d.zero,
        series: d.series.filter(s => avail(s[0])).map(s => ({ label: s[1], color: s[2], ys: rows.map(r => r[s[0]]), fmt: v => v.toFixed(d.dp) + d.unit })) });
    });
  }

  /* ---------- static builds ---------- */
  const NAV = [['live', 'Live', 'M4 14a8 8 0 1 1 16 0M12 14l4-5'], ['diagnose', 'Diagnose', 'M6 3v6a4 4 0 0 0 8 0V3M10 13v3a4 4 0 0 0 8 0v-2M18 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4'], ['accel', 'Accel', 'M4 19 10 12l4 3 6-9M15 6h5v5'], ['systems', 'Systems', 'M4 6h6v5H4zM14 13h6v5h-6zM10 8.5h3v7h1'], ['maps', 'Maps', 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16'], ['write-lab', 'Write lab', 'M12 3v11M7.5 9.5 12 14l4.5-4.5M5 19h14'], ['faults', 'Faults', 'M12 4 3 19h18zM12 10v4M12 16.5v.5'], ['reports', 'Report', 'M6 3h9l4 4v14H6zM9 12h7M9 16h7']];
  $('#nav').innerHTML = NAV.map(n => '<a href="#' + n[0] + '" data-v="' + n[0] + '"><svg viewBox="0 0 24 24"><path d="' + n[2] + '"/></svg>' + n[1] + '</a>').join('');
  function route() {
    let v = (location.hash || '#live').slice(1); if (!NAV.some(n => n[0] === v)) v = 'live'; S.view = v;
    $$('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v));
    $$('#nav a').forEach(a => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#main').scrollTop = 0; tick(true);
  }
  window.addEventListener('hashchange', route);

  const pol = (r, deg) => [150 + r * Math.cos(deg * Math.PI / 180), 150 + r * Math.sin(deg * Math.PI / 180)];
  const ang = rpm => -225 + clamp(rpm, 0, 8000) / 8000 * 270;
  function arc(r, a0, a1) { const p0 = pol(r, a0), p1 = pol(r, a1); return 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + 'A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1); }
  function buildTach() {
    let s = '<path d="' + arc(118, -225, 45) + '" fill="none" stroke="var(--panel2)" stroke-width="16" stroke-linecap="round"/>';
    s += '<path id="tRed" d="" fill="none" stroke="var(--crit)" stroke-width="16"/><path id="tArc" d="" fill="none" stroke="var(--accent)" stroke-width="16" stroke-linecap="round"/>';
    for (let r = 0; r <= 8000; r += 500) { const a = ang(r), major = r % 1000 === 0, p0 = pol(major ? 96 : 102, a), p1 = pol(108, a); s += '<line x1="' + p0[0].toFixed(1) + '" y1="' + p0[1].toFixed(1) + '" x2="' + p1[0].toFixed(1) + '" y2="' + p1[1].toFixed(1) + '" stroke="var(--ink2)" stroke-width="' + (major ? 2 : 1) + '"/>'; if (major) { const t = pol(82, a); s += '<text x="' + t[0].toFixed(1) + '" y="' + (t[1] + 5).toFixed(1) + '" text-anchor="middle" font-family="var(--display)" font-size="16" font-weight="600" fill="var(--ink2)">' + r / 1000 + '</text>'; } }
    s += '<g class="needle" id="tNeedle" style="transform-origin:150px 150px"><line x1="150" y1="150" x2="258" y2="150" stroke="var(--s2)" stroke-width="3" stroke-linecap="round"/></g><circle cx="150" cy="150" r="7" fill="var(--ink)"/>';
    s += '<text id="tRpm" x="150" y="200" text-anchor="middle" font-family="var(--display)" font-size="40" font-weight="700" fill="var(--ink)">0</text><text x="150" y="217" text-anchor="middle" font-size="11" fill="var(--muted)" letter-spacing="1">RPM</text>';
    $('#tach').innerHTML = s;
  }
  const TILES = [
    ['ect', 'Coolant', v => v > 112 ? ['crit', 'Overheating'] : v > 105 ? ['warn', 'Hot'] : v < 60 ? ['', 'Warming up'] : ['ok', 'Normal']],
    ['iat', 'Intake air', v => v > 55 ? ['warn', 'Heat soak'] : ['ok', 'Normal']],
    ['map', 'Manifold', null], ['tps', 'Butterfly', null], ['load', 'Load', null], ['adv', 'Advance', null],
    ['afr', 'AFR actual', v => v === 0 ? ['', 'Engine off'] : v > 15.3 ? ['warn', 'Lean'] : v < 12 ? ['warn', 'Rich'] : ['ok', 'In range']],
    ['lambdaCmd', 'Lambda target', null],
    ['stft', 'Short trim', v => Math.abs(v) > 10 ? ['warn', 'Large correction'] : ['ok', 'Normal']],
    ['ltft', 'Long trim', v => Math.abs(v) > 10 ? ['warn', 'Large correction'] : ['ok', 'Normal']],
    ['o2', 'O2 sensor', null],
    ['vbat', 'Battery', v => v < 11.8 ? ['crit', 'Too low'] : v < 12.4 ? ['warn', 'Low'] : v > 14.8 ? ['warn', 'High'] : ['ok', v > 13.2 ? 'Charging' : 'Resting']],
    ['knockMargin', 'Knock margin', v => v < 0 ? ['crit', 'Past limit'] : v < 1.5 ? ['warn', 'Thin'] : ['ok', 'Safe']],
    ['egt', 'Exhaust gas', v => v > 900 ? ['warn', 'Hot'] : ['ok', 'Normal']],
    ['injDuty', 'Injector duty', v => v > 85 ? ['warn', 'Near limit'] : ['ok', 'Normal']],
    ['railKpa', 'Fuel rail', v => v < 300 ? ['', 'Pump off'] : ['ok', 'Pressurised']]
  ];
  function buildStatic() {
    buildTach();
    $('#tiles').innerHTML = TILES.map(t => '<div class="tile" id="tile-' + t[0] + '"><div class="l"><span>' + t[1] + '</span>' + tagFor(t[0]).replace('Twin model', 'Twin') + '</div><div class="v"><span>–</span><small>' + CH[t[0]].unit + '</small></div><div class="bar"><i></i></div><div class="st"></div></div>').join('');
    $('#liveCharts').innerHTML = LIVE_CHARTS.map((c, i) => '<div class="card"><h3>' + c.title + ', last 90 s</h3><div class="chart" id="lc' + i + '"></div></div>').join('');
    liveCharts = LIVE_CHARTS.map((c, i) => makeChart($('#lc' + i)));
    const FLOW = [['Airbox', ['iat', 'baro', 'ambient']], ['Throttle body', ['grip', 'thrCmd', 'tps']], ['Manifold', ['map', 'load']], ['Fuel', ['railKpa', 'injPw', 'afr']], ['Combustion', ['rpm', 'adv', 'torque']], ['Exhaust', ['o2', 'egt', 'stft']]];
    $('#flow').innerHTML = FLOW.map((n, i) => (i ? '<span class="arrow" aria-hidden="true">→</span>' : '') + '<div class="node"><h4>' + n[0] + '</h4><dl>' + n[1].map(k => '<dt>' + CH[k].name.replace(/ \(.*\)/, '') + '</dt><dd data-f="' + k + '">–</dd>').join('') + '</dl></div>').join('');
    $('#groups').innerHTML = GROUPS.map(g => '<div class="card"><h3>' + g[1] + '</h3><div class="scroll"><table class="chs"><thead><tr><th>Channel</th><th>Source</th><th>Range</th><th>30 s</th><th style="text-align:right">Value</th></tr></thead><tbody>' +
      Object.keys(CH).filter(k => CH[k].group === g[0]).sort((a, b) => avail(b) - avail(a)).map(k => { const c = CH[k], ok = avail(k); return '<tr class="' + (ok ? '' : 'na') + '" data-k="' + k + '"><td>' + c.name + '</td><td>' + (ok ? tagFor(k) : '<span class="tag">' + (c.src === 'pid' ? 'Not published' : 'Not on OBD') + '</span>') + '</td><td>' + (c.state || !ok ? '' : '<div class="mbar"><i></i></div>') + '</td><td>' + (c.state || !ok ? '' : '<svg viewBox="0 0 90 22" preserveAspectRatio="none"><polyline fill="none" stroke="var(--s1)" stroke-width="1.5" points=""/></svg>') + '</td><td class="v">–</td></tr>'; }).join('') + '</tbody></table></div></div>').join('');
    $('#srcChip').className = 'chip ' + (S.source === 'twin' ? 'twin' : 'ecu'); $('#srcChip').textContent = S.source === 'twin' ? 'Digital twin, simulated data' : 'Live ECU · ' + (S.session && S.session.link === 'wifi' ? 'WiFi' : 'Bluetooth');
    $('#btnConnect').textContent = S.source === 'ecu' ? 'Disconnect adapter' : 'Connect OBD adapter';
    $('#dock').style.display = S.source === 'twin' ? '' : 'none'; $('#simbar').hidden = S.source !== 'twin';
    const sup = elm() ? elm().supported : new Set(); let pg = '';
    for (let p = 1; p <= 0x60; p++) pg += '<span class="' + (sup.has(p) ? 'y' : '') + '" title="' + (T.PID_BY_ID[p] ? T.PID_BY_ID[p].name : 'PID ' + p.toString(16)) + '">' + p.toString(16).toUpperCase().padStart(2, '0') + '</span>';
    $('#pidGrid').innerHTML = pg;
    $('#faultInject').innerHTML = S.source === 'twin' ? '<h3>Inject a fault into the twin</h3><div class="row">' + Object.keys(T.FAULTS).map(c => '<button class="btn sm" data-fault="' + c + '" aria-pressed="false" title="' + esc(T.FAULTS[c]) + '">' + c + '</button>').join('') + '</div><p class="note" style="margin-top:6px">A fault sets its code after two seconds. Remove the fault before clearing or it comes back.</p>' : '';
    $$('[data-fault]').forEach(b => b.onclick = () => { const c = b.dataset.fault, on = !S.twin.faults[c]; if (on) S.twin.inject(c); else S.twin.heal(c); b.setAttribute('aria-pressed', on); b.classList.toggle('pri', on); event((on ? 'Injected fault ' : 'Removed fault ') + c, on ? 'warn' : 'info'); });
  }
  function setChip(sel, cls, text) { const e = $(sel); e.className = 'chip ' + cls; e.lastElementChild.textContent = text; }

  /* ---------- acceleration ---------- */
  const ACC = [['0-60', '0 to 60 km/h'], ['0-100', '0 to 100 km/h'], ['60-100', '60 to 100 km/h'], ['80-120', '80 to 120 km/h']];
  $('#accTiles').innerHTML = [['accG', 'Acceleration now', 'g'], ['accPeak', 'Peak this session', 'g'], ['accSpd', 'Road speed', 'km/h'], ['accRate', 'Speed samples', '/s']].map(x => '<div class="tile" id="' + x[0] + '"><div class="l"><span>' + x[1] + '</span></div><div class="v"><span>–</span><small>' + x[2] + '</small></div><div class="st"></div></div>').join('');
  let accC1, accC2;
  $('#accReset').onclick = () => { S.acc = new T.AccelMeter(); event('Acceleration results reset'); tick(true); };
  $('#accLaunch').onclick = () => { if (S.source !== 'twin' || S.busy || S.twin.ecu !== 'ok') return; S.auto = false; $('#cAuto').checked = false; S.twin.setIgnition(true); S.launch = { phase: 'settle', t: 0, still: 0 }; event('Simulated launch started'); };
  function renderAccel() {
    const A = S.acc, sim = S.source === 'twin', per = A.rate ? 1 / A.rate : null, set = (id, v, st) => { const e = $('#' + id); e.querySelector('.v span').textContent = v; e.querySelector('.st').textContent = st || ''; };
    set('accG', (A.g >= 0 ? '+' : '−') + Math.abs(A.g).toFixed(2), (A.g * 9.81).toFixed(1) + ' m/s²'); set('accPeak', A.peakG.toFixed(2), (A.peakG * 9.81).toFixed(1) + ' m/s²');
    set('accSpd', S.live.speed != null ? Math.round(S.live.speed) : '–', sim ? 'Simulated' : 'From ECU'); set('accRate', A.rate ? A.rate.toFixed(1) : '–', per ? 'Timing ± ' + per.toFixed(2) + ' s' : '');
    $('#accRate').className = 'tile ' + (!A.rate ? '' : A.rate >= 8 ? 'ok' : A.rate >= 4 ? 'warn' : 'crit');
    $('#accTable').innerHTML = '<thead><tr><th>Run</th><th>Last</th><th>Best</th><th>Runs</th></tr></thead><tbody>' + ACC.map(x => '<tr><td>' + x[1] + '</td><td>' + (A.last[x[0]] != null ? A.last[x[0]].toFixed(2) + ' s' : '–') + '</td><td>' + (A.best[x[0]] != null ? A.best[x[0]].toFixed(2) + ' s' : '–') + '</td><td>' + A.runs.filter(r => r.name === x[0]).length + '</td></tr>').join('') + '</tbody>';
    $('#accRuns').innerHTML = A.runs.slice().reverse().map(r => '<li class="good">' + r.name.replace('-', ' to ') + ' km/h in ' + r.time.toFixed(2) + ' s, peak ' + r.peakG.toFixed(2) + ' g' + (r.period ? ', timing ± ' + r.period.toFixed(2) + ' s' : '') + (sim ? ' (simulated)' : '') + '</li>').join('') || '<li>No timed run yet. A standing-start run arms when the bike is stopped. Roll-on runs time themselves whenever speed passes 60 then 100, or 80 then 120.</li>';
    $('#accNote').textContent = 'The ECU reports road speed in whole km/h, and the app can only ask as fast as the adapter answers. Each time is interpolated between two samples, so it is good to about one sample period, shown on the Speed samples tile. A standing start counts from the last sample at rest, which reads slightly long. Acceleration is the slope of speed over the last 0.7 s. ' + (sim ? 'These figures come from the twin model, not from a motorcycle.' : 'Fast reply mode is ' + (elm() && elm().fast ? 'on' : 'not supported by this adapter') + '.');
    $('#accLaunch').hidden = !sim; $('#accLaunch').disabled = !!S.launch || S.busy; $('#accLaunch').textContent = S.launch ? 'Launch running' : 'Run simulated launch';
    const now = performance.now() / 1000, rows = A.s.filter(q => q.t >= now - 30), x = rows.map(q => q.t - now), common = { live: true, x, xMin: -30, xMax: 0, xTicks: [-30, -20, -10, 0], xFmt: v => v > -0.2 ? 'now' : v.toFixed(v > -10 ? 1 : 0) + ' s' };
    accC1.set(Object.assign({ yMin: 0, yMax: 160, series: [{ label: 'Road speed', color: '--s1', ys: rows.map(q => q.v), fmt: v => v.toFixed(0) + ' km/h' }] }, common));
    accC2.set(Object.assign({ yMin: -1, yMax: 1, zero: 0, series: [{ label: 'Acceleration', color: '--s2', ys: rows.map(q => q.g), fmt: v => v.toFixed(2) + ' g' }] }, common));
  }

  /* ---------- twin dock ---------- */
  const tw = S.twin;
  const manual = () => { if (S.auto) { S.auto = false; $('#cAuto').checked = false; } };
  $('#cIgn').onchange = e => { manual(); tw.setIgnition(e.target.checked); event('Twin ignition ' + (e.target.checked ? 'on' : 'off')); };
  $('#cStart').onclick = () => { manual(); if (tw.s.run) { tw.stop(); tw.ctl.gear = 0; tw.ctl.grip = 0; } else tw.start(); };
  $('#cAuto').onchange = e => { S.auto = e.target.checked; if (S.auto) tw.setIgnition(true); };
  $('#cGrip').oninput = e => { manual(); tw.ctl.grip = +e.target.value; };
  $('#cGear').onchange = e => { manual(); tw.ctl.gear = +e.target.value; };
  $('#cBrake').oninput = e => { manual(); tw.ctl.brake = +e.target.value; };
  $('#cAmb').onchange = e => { tw.ctl.ambient = clamp(+e.target.value || 30, -10, 50); };
  function updDock() {
    $('#cStart').textContent = tw.s.run ? 'Stop engine' : tw.ecu === 'ok' ? 'Start engine' : 'ECU will not start'; $('#cStart').disabled = tw.ecu !== 'ok' && !tw.s.run;
    $('#cIgn').checked = tw.ctl.ign; $('#oGrip').textContent = Math.round(tw.ctl.grip) + '%';
    if (S.auto) { $('#cGrip').value = tw.ctl.grip; $('#cGear').value = tw.ctl.gear; $('#cBrake').value = tw.ctl.brake; }
  }

  /* ---------- maps ---------- */
  const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const ramp = t => { t = clamp(t, 0, 1) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)); return mix(RAMP[i], RAMP[i + 1], t - i); };
  const ink = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? '#0b0b0b' : '#ffffff';
  const TBL = { fuel: { label: 'Fuel target', unit: 'AFR', step: 0.1, big: 0.5, dp: 1, min: 10, max: 17, dr: 1.5, t: v => (15 - v) / 3, hint: 'Darker is richer. Rows are throttle opening, columns are engine speed.' }, ign: { label: 'Ignition', unit: '° BTDC', step: 0.5, big: 2, dp: 1, min: -5, max: 50, dr: 6, t: v => v / 40, hint: 'Darker is more advance. Rows are throttle opening, columns are engine speed.' } };
  $('#segTable').innerHTML = [['fuel', 'Fuel target'], ['ign', 'Ignition'], ['thr', 'Throttle curve'], ['lim', 'Limits']].map(t => '<button data-t="' + t[0] + '" aria-pressed="' + (t[0] === S.table) + '">' + t[1] + '</button>').join('');
  $('#segTable').onclick = e => { const t = e.target.dataset.t; if (!t) return; S.table = t; S.sel.clear(); $$('#segTable button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t)); renderMap(); };
  $('#segMode').onclick = e => { if (e.target.dataset.m == null) return; S.delta = e.target.dataset.m === '1'; $$('#segMode button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.m === '1') === S.delta)); renderMap(); };
  function renderMap() {
    const m = S.work, t = S.table, tools = $('#mapTools'), wrap = $('#mapWrap');
    $('#segMode').style.display = TBL[t] ? '' : 'none'; $('#mapCur').style.display = TBL[t] ? '' : 'none';
    if (TBL[t]) {
      const d = TBL[t];
      tools.innerHTML = '<button class="btn sm" data-a="-b">−' + d.big + '</button><button class="btn sm" data-a="-s">−' + d.step + '</button><button class="btn sm" data-a="+s">+' + d.step + '</button><button class="btn sm" data-a="+b">+' + d.big + '</button><label class="row" style="gap:6px" for="mapSet"><input class="fld" id="mapSet" type="number" step="' + d.step + '" style="width:84px" placeholder="' + d.unit + '"><button class="btn sm" data-a="set">Set</button></label><button class="btn sm" data-a="smooth">Smooth</button><button class="btn sm" data-a="all">Select all</button><button class="btn sm" data-a="rev">Revert selection</button><button class="btn sm" data-a="revall">Revert whole map</button><span class="tag" id="selCount"></span>';
      let h = '<table class="mapt"><thead><tr><th>thr % \\ rpm</th>' + m.rpm.map((r, ri) => '<th data-col="' + ri + '">' + r + '</th>').join('') + '</tr></thead><tbody>';
      for (let li = m.load.length - 1; li >= 0; li--) h += '<tr><th data-row="' + li + '">' + m.load[li] + '</th>' + m.rpm.map((r, ri) => '<td data-l="' + li + '" data-r="' + ri + '"></td>').join('') + '</tr>';
      wrap.innerHTML = h + '</tbody></table>'; $('#mapHint').textContent = d.hint + ' Click a cell, shift-click for a block, or click a header for a whole row or column. The orange frame is where the engine is running now.';
      paintMap();
    } else if (t === 'thr') {
      tools.innerHTML = '<button class="btn sm" data-a="revall">Revert whole map</button>';
      wrap.innerHTML = '<table class="mapt"><thead><tr><th>Twist grip %</th>' + T.GRIP_AXIS.map(g => '<th>' + g + '</th>').join('') + '</tr></thead><tbody><tr><th>Butterfly %</th>' + m.thr.map((v, i) => '<td style="background:var(--panel2)"><input class="fld" data-thr="' + i + '" type="number" min="0" max="100" step="1" value="' + v + '" style="width:58px;text-align:center" ' + (i === 0 ? 'disabled' : '') + ' aria-label="Butterfly at ' + T.GRIP_AXIS[i] + '% grip"></td>').join('') + '</tr><tr><th>Baseline</th>' + S.stock.thr.map(v => '<td style="color:var(--muted)">' + v + '</td>').join('') + '</tr></tbody></table>';
      $('#mapHint').textContent = 'Ride-by-wire curve: how far the butterfly opens for each grip position. A steeper start feels sharper.';
    } else {
      tools.innerHTML = '<button class="btn sm" data-a="revall">Revert whole map</button>';
      const L = [['revLimit', 'Rev limit', 'rpm', 50], ['idle', 'Idle target', 'rpm', 10], ['fanOn', 'Fan on', '°C', 1], ['fanOff', 'Fan off', '°C', 1]];
      wrap.innerHTML = '<div class="ctl">' + L.map(x => '<label for="lim-' + x[0] + '">' + x[1] + ' <input class="fld" id="lim-' + x[0] + '" data-lim="' + x[0] + '" type="number" step="' + x[3] + '" value="' + m.sc[x[0]] + '" style="width:90px"> ' + x[2] + ' <span class="tag">baseline ' + S.stock.sc[x[0]] + '</span></label>').join('') + '</div>';
      $('#mapHint').textContent = 'Scalar limits stored in the same image as the tables.';
    }
  }
  function paintMap() {
    const d = TBL[S.table]; if (!d) return; const m = S.work, tab = m[S.table], st = S.stock[S.table], mid = hexRgb(css('--div-mid'));
    $$('#mapWrap td[data-l]').forEach(td => {
      const l = +td.dataset.l, r = +td.dataset.r, v = tab[l][r], dv = v - st[l][r]; let c;
      if (S.delta) { c = Math.abs(dv) < 1e-9 ? mid : mix(mid, hexRgb(dv < 0 ? '#2a78d6' : '#eb6834'), clamp(0.25 + 0.75 * Math.abs(dv) / d.dr, 0, 1)); td.textContent = Math.abs(dv) < 1e-9 ? '·' : (dv > 0 ? '+' : '−') + Math.abs(dv).toFixed(d.dp); }
      else { c = ramp(d.t(v)); td.textContent = v.toFixed(d.dp); }
      td.style.background = 'rgb(' + c.join(',') + ')'; td.style.color = ink(c);
      td.classList.toggle('sel', S.sel.has(l + ',' + r)); td.classList.toggle('chg', !S.delta && Math.abs(dv) > 1e-9);
      td.title = m.rpm[r] + ' rpm, ' + m.load[l] + '% throttle: ' + v.toFixed(d.dp) + ' ' + d.unit + ' (baseline ' + st[l][r].toFixed(d.dp) + ')';
    });
    const sc = $('#selCount'); if (sc) sc.textContent = S.sel.size + ' selected';
  }
  $('#mapWrap').addEventListener('click', e => {
    const td = e.target.closest('td[data-l]'), th = e.target.closest('th'), m = S.work;
    if (td) {
      const l = +td.dataset.l, r = +td.dataset.r, k = l + ',' + r;
      if (e.shiftKey && S.anchor) { S.sel.clear(); for (let a = Math.min(l, S.anchor[0]); a <= Math.max(l, S.anchor[0]); a++) for (let b = Math.min(r, S.anchor[1]); b <= Math.max(r, S.anchor[1]); b++) S.sel.add(a + ',' + b); }
      else if (e.ctrlKey || e.metaKey) { if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k); S.anchor = [l, r]; }
      else { const only = S.sel.size === 1 && S.sel.has(k); S.sel.clear(); if (!only) S.sel.add(k); S.anchor = [l, r]; }
      paintMap();
    } else if (th && th.dataset.col != null) { m.load.forEach((x, l) => S.sel.add(l + ',' + th.dataset.col)); paintMap(); }
    else if (th && th.dataset.row != null) { m.rpm.forEach((x, r) => S.sel.add(th.dataset.row + ',' + r)); paintMap(); }
  });
  $('#mapWrap').addEventListener('change', e => {
    const m = S.work;
    if (e.target.dataset.thr != null) { m.thr[+e.target.dataset.thr] = clamp(+e.target.value || 0, 0, 100); mapChanged(); }
    if (e.target.dataset.lim) { m.sc[e.target.dataset.lim] = Math.round(clamp(+e.target.value || 0, 0, 9000)); mapChanged(); }
  });
  $('#mapTools').addEventListener('click', e => {
    const a = e.target.dataset.a; if (!a) return; const m = S.work, d = TBL[S.table];
    if (a === 'revall') { S.work = T.cloneMap(S.stock); S.work.name = 'Working copy'; S.sel.clear(); renderMap(); return mapChanged(); }
    if (!d) return; const tab = m[S.table], st = S.stock[S.table];
    if (a === 'all') { m.load.forEach((x, l) => m.rpm.forEach((y, r) => S.sel.add(l + ',' + r))); return paintMap(); }
    if (!S.sel.size) { $('#selCount').textContent = 'Select cells first'; return; }
    const cells = Array.from(S.sel).map(k => k.split(',').map(Number)), rd = v => Math.round(clamp(v, d.min, d.max) / d.step) * d.step;
    if (a === 'smooth') { const src = tab.map(r => r.slice()); cells.forEach(([l, r]) => { let s = 0, n = 0; for (let dl = -1; dl <= 1; dl++) for (let dr = -1; dr <= 1; dr++) { const row = src[l + dl]; if (row && row[r + dr] != null) { const w = dl === 0 && dr === 0 ? 4 : 1; s += row[r + dr] * w; n += w; } } tab[l][r] = rd(s / n); }); }
    else if (a === 'rev') cells.forEach(([l, r]) => { tab[l][r] = st[l][r]; });
    else if (a === 'set') { const v = parseFloat($('#mapSet').value); if (isNaN(v)) return; cells.forEach(([l, r]) => { tab[l][r] = rd(v); }); }
    else { const dv = (a[0] === '-' ? -1 : 1) * (a[1] === 'b' ? d.big : d.step); cells.forEach(([l, r]) => { tab[l][r] = rd(tab[l][r] + dv); }); }
    paintMap(); mapChanged();
  });
  function mapChanged() {
    S.val = T.validateMap(S.work, S.stock); S.dyno = T.dynoSweep(S.work); S.image = T.encodeImage(S.work);
    const x = baseDyno.map(p => p.rpm), mk = (f, unit, dp) => [{ label: 'Baseline', color: '--muted', dash: true, ys: baseDyno.map(f), fmt: v => v.toFixed(dp) + unit }, { label: 'Working copy', color: '--s1', ys: S.dyno.map(f), fmt: v => v.toFixed(dp) + unit }];
    const common = { x, xMin: 1500, xMax: 7500, xTicks: [1500, 3000, 4500, 6000, 7500], xFmt: (v, full) => v + (full ? ' rpm' : '') };
    if (dynoT) { dynoT.set(Object.assign({ yMin: 0, yMax: 120, series: mk(p => Math.max(0, p.tq), ' Nm', 1) }, common)); dynoP.set(Object.assign({ yMin: 0, yMax: 100, series: mk(p => p.ps, ' PS', 1) }, common)); }
    $('#mapChecks').innerHTML = S.val.checks.map(c => '<li><span class="pill ' + c.level + '">' + (c.level === 'pass' ? '✓ Pass' : c.level === 'warn' ? '! Warn' : '✕ Fail') + '</span><div><b>' + esc(c.title) + '</b><span class="d">' + esc(c.detail) + '</span></div></li>').join('');
    $('#mapMeta').innerHTML = '<dt>Name</dt><dd>' + esc(S.work.name) + '</dd><dt>Cells changed</dt><dd>' + S.val.changed + ' of 192</dd><dt>Image</dt><dd>' + T.IMG_SIZE + ' bytes, ' + T.IMG_SIZE / T.BLOCK + ' blocks</dd><dt>CRC32</dt><dd>' + T.crc32(S.image, T.IMG_SIZE - 4).toString(16).toUpperCase().padStart(8, '0') + '</dd><dt>Origin</dt><dd>Twin model, not read from an ECU</dd>';
    updWrite();
  }
  $('#mapExport').onclick = () => exportFile('t120-twin-map.json', 'application/json', JSON.stringify(Object.assign({ format: 't120-bench-map', version: 1, origin: 'SIMULATED twin model. Not read from an ECU. Not Triumph calibration data.' }, S.work), null, 1));
  $('#mapImport').onchange = e => {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { const m = JSON.parse(rd.result); if (m.format !== 't120-bench-map' || !Array.isArray(m.fuel) || m.fuel.length !== 12 || m.fuel[0].length !== 16 || m.ign.length !== 12 || m.thr.length !== 11 || !m.sc) throw new Error('Not a T120 Bench map file'); T.decodeImage(T.encodeImage(m)); S.work = { name: String(m.name || f.name), note: '', rpm: S.stock.rpm.slice(), load: S.stock.load.slice(), fuel: m.fuel, ign: m.ign, thr: m.thr, sc: m.sc }; S.sel.clear(); renderMap(); mapChanged(); event('Imported map ' + f.name); } catch (err) { modal('<h3>Import failed</h3><p>' + esc(err.message) + '</p><div class="row"><button class="btn pri" data-close>OK</button></div>'); } e.target.value = ''; };
    rd.readAsText(f);
  };

  /* ---------- write lab ---------- */
  $('#steps').innerHTML = [
    ['bk', 'Back up the current ECU image', '<p class="note" id="bkTxt"></p><div class="row"><button class="btn" id="bkBtn">Back up twin ECU image</button></div>'],
    ['ck', 'Safety checks on the working copy', '<p class="note" id="ckTxt"></p><div class="row"><a class="btn sm" href="#maps">Open maps</a></div>'],
    ['dy', 'Virtual dyno result', '<p class="note" id="dyTxt"></p>'],
    ['pf', 'Pre-flight, live', '<ul class="checks" id="pfList"></ul><div class="row" id="pfAct"></div>'],
    ['rh', 'Rehearse the write on the twin', '<div class="row"><label class="row" for="rhFault" style="gap:6px">Failure to inject <select class="fld" id="rhFault"><option value="">None, clean write</option><option value="drop">Bluetooth drops mid-write</option><option value="sag">Battery sags mid-write</option></select></label><button class="btn pri" id="rhBtn">Rehearse write on twin</button><button class="btn danger" id="rhRec" hidden>Recover twin from backup</button></div><div class="blocks" id="rhBlocks"></div><ul class="log" id="rhLog"><li>No rehearsal run yet.</li></ul><p class="note" id="rhTxt"></p>'],
    ['re', 'Write to the real ECU', '<div class="lock"><b>Locked in this version.</b><ul><li>The map-flash protocol for the T120 Keihin ECU (security unlock, memory layout, checksum scheme) is proprietary. This app does not contain a verified implementation, and an unverified one can leave the ECU unable to boot.</li><li>The tables here are a twin model. A real write has to start from an image read out of your own ECU.</li><li>What does write to the real ECU today: clearing fault codes, on the Faults page.</li></ul></div><p class="note" id="reTxt"></p>']
  ].map(s => '<div class="step" id="st-' + s[0] + '"><div class="n"></div><div class="body"><div class="head"><b>' + s[1] + '</b><span class="pill idle" id="pl-' + s[0] + '">Waiting</span></div>' + s[2] + '</div></div>').join('');
  $('#rhBlocks').innerHTML = '<i></i>'.repeat(T.IMG_SIZE / T.BLOCK);
  const setStep = (id, cls, pill, text) => { $('#st-' + id).className = 'step ' + cls; const p = $('#pl-' + id); p.className = 'pill ' + pill; p.textContent = text; };
  $('#bkBtn').onclick = () => { S.backup = tw.flash.slice(); S.backupAt = new Date(); event('Backed up twin ECU image, CRC ' + T.crc32(S.backup, T.IMG_SIZE - 4).toString(16).toUpperCase()); updWrite(); };
  function preflight() {
    const real = S.source === 'ecu', rpm = real ? S.live.rpm : tw.out.rpm, v = real ? (S.live.vbat != null ? S.live.vbat : S.adapterV) : tw.s.vbat, lat = elm() ? elm().lat : 999;
    return [
      { ok: real ? S.answering : tw.ctl.ign && (S.answering || tw.ecu !== 'ok'), t: 'Ignition on and ECU powered', d: real ? (S.answering ? 'ECU is answering' : 'ECU is not answering') : (tw.ctl.ign ? 'Ignition on' : 'Ignition off') },
      { ok: rpm != null && rpm < 1, t: 'Engine stopped', d: rpm == null ? 'Unknown' : Math.round(rpm) + ' rpm' },
      { ok: v != null && v >= 12.4, t: 'Battery at 12.4 V or more', d: v == null ? 'Unknown' : v.toFixed(1) + ' V. Use a charger or maintainer for a real write.' },
      { ok: lat < 150, t: 'Link latency under 150 ms', d: Math.round(lat) + ' ms average reply time' }
    ];
  }
  function updWrite() {
    if (!S.val) return;
    setStep('bk', S.backup ? 'done' : '', S.backup ? 'pass' : 'idle', S.backup ? '✓ Held' : 'Needed');
    $('#bkTxt').textContent = S.backup ? 'Backup taken ' + S.backupAt.toLocaleTimeString() + ', CRC32 ' + T.crc32(S.backup, T.IMG_SIZE - 4).toString(16).toUpperCase().padStart(8, '0') + '. Recovery uses this copy.' : 'Nothing gets erased until a backup exists. On a real ECU this is a full read-out saved to a file.';
    const v = S.val; setStep('ck', v.ok ? 'done' : 'bad', v.ok ? (v.warns ? 'warn' : 'pass') : 'fail', v.ok ? (v.warns ? '! ' + v.warns + ' warning' + (v.warns > 1 ? 's' : '') : '✓ Pass') : '✕ ' + v.fails + ' failed');
    $('#ckTxt').textContent = v.changed + ' cells differ from baseline. ' + (v.ok ? 'No check blocks the write.' : 'Fix on the Maps page: ' + v.checks.filter(c => c.level === 'fail').map(c => c.detail).join('; ') + '.');
    const pk = (a, f) => a.reduce((x, y) => f(y) > f(x) ? y : x), bt = pk(baseDyno, p => p.tq), wt = pk(S.dyno, p => p.tq), bp = pk(baseDyno, p => p.ps), wp = pk(S.dyno, p => p.ps), km = Math.min.apply(null, S.dyno.map(p => p.knockMargin));
    const sg = x => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
    setStep('dy', v.ok ? 'done' : '', km < 0 ? 'fail' : km < 1.5 ? 'warn' : 'pass', km < 0 ? '✕ Knock' : km < 1.5 ? '! Thin margin' : '✓ Safe');
    $('#dyTxt').textContent = 'Peak torque ' + wt.tq.toFixed(1) + ' Nm at ' + wt.rpm + ' rpm (' + sg(wt.tq - bt.tq) + ' Nm). Peak power ' + wp.ps.toFixed(1) + ' PS at ' + wp.rpm + ' rpm (' + sg(wp.ps - bp.ps) + ' PS). Smallest full-throttle knock margin ' + km.toFixed(1) + '°.';
    const pf = preflight(), pfOk = pf.every(c => c.ok);
    setStep('pf', pfOk ? 'done' : '', pfOk ? 'pass' : 'idle', pfOk ? '✓ Ready' : 'Not ready');
    $('#pfList').innerHTML = pf.map(c => '<li><span class="pill ' + (c.ok ? 'pass' : 'fail') + '">' + (c.ok ? '✓ OK' : '✕ No') + '</span><div><b>' + c.t + '</b><span class="d">' + esc(c.d) + '</span></div></li>').join('');
    const act = $('#pfAct'), need = S.source === 'twin' && !S.busy && (tw.s.run || !tw.ctl.ign);
    if (need && !act.firstChild) { act.innerHTML = '<button class="btn sm" id="pfStop">Stop engine, ignition on</button>'; $('#pfStop').onclick = () => { S.auto = false; $('#cAuto').checked = false; tw.setIgnition(true); tw.stop(); tw.ctl.gear = 0; tw.ctl.grip = 0; tw.ctl.brake = 100; }; } else if (!need) act.innerHTML = '';
    const ready = S.backup && v.ok && (S.source === 'ecu' || pfOk) && !S.busy;
    $('#rhBtn').disabled = !ready || tw.ecu !== 'ok'; $('#rhRec').hidden = !(tw.ecu === 'corrupt' && !S.busy && S.backup);
    const lf = S.lastFlash; setStep('rh', lf ? (lf.ok ? 'done' : 'bad') : '', S.busy ? 'warn' : lf ? (lf.ok ? 'pass' : 'fail') : 'idle', S.busy ? 'Writing' : lf ? (lf.ok ? '✓ Verified' : '✕ Failed') : 'Not run');
    $('#rhTxt').textContent = !S.backup ? 'Take the backup first.' : !v.ok ? 'Blocked until the safety checks pass.' : S.source === 'ecu' ? 'The rehearsal always runs against the twin, even with a real ECU connected.' : !pfOk ? 'Blocked until pre-flight is ready.' : 'Clean rehearsals of this exact image: ' + S.clean + '. Run the two failure cases too, so you have seen the recovery.';
    setStep('re', '', 'fail', 'Locked'); $('#reTxt').textContent = 'Twin ECU state: ' + (tw.ecu === 'ok' ? 'healthy, running "' + tw.map.name + '"' : 'partial image, will not start') + '.';
  }
  async function runFlash(image, opts, label) {
    S.busy = true; S.auto = false; $('#cAuto').checked = false; const logEl = $('#rhLog'), blocks = $$('#rhBlocks i'); logEl.innerHTML = ''; blocks.forEach(b => b.className = '');
    if (S.source === 'ecu') { tw.setIgnition(true); tw.stop(); tw.s.rpm = 0; tw.s.vbat = 12.6; }
    const line = (m, l) => { const li = document.createElement('li'); li.className = l || ''; li.textContent = new Date().toLocaleTimeString() + '  ' + m; logEl.appendChild(li); logEl.scrollTop = logEl.scrollHeight; };
    line(label); updWrite();
    const res = await (opts.recover ? T.recoverFlash(tw, image, ev) : T.rehearseFlash(tw, image, Object.assign({ onEvent: ev }, opts)));
    function ev(e) { if (e.stage === 'write') { blocks[e.written - 1].className = 'w'; if (e.written % 16 === 0) line(e.msg); } else { line(e.msg, e.level === 'bad' ? 'bad' : e.level === 'good' ? 'good' : e.level === 'warn' ? 'warn' : ''); if (e.stage === 'done') blocks.forEach(b => b.className = 'v'); if (e.level === 'bad' && e.written < blocks.length && e.written > 0) blocks[e.written].className = 'x'; } }
    S.busy = false; S.lastFlash = res; if (res.ok && !opts.recover && !opts.dropAt && !opts.sagAt) S.clean++;
    event(label + ': ' + (res.ok ? 'verified' : 'failed, ' + res.error), res.ok ? 'good' : 'bad'); updWrite(); return res;
  }
  $('#rhBtn').onclick = () => { const f = $('#rhFault').value, o = f === 'drop' ? { dropAt: 37 } : f === 'sag' ? { sagAt: 22 } : {}; if (S.cleanCrc !== T.crc32(S.image)) { S.clean = 0; S.cleanCrc = T.crc32(S.image); } runFlash(S.image, o, 'Rehearsal' + (f ? ' with injected failure' : '')); };
  $('#rhRec').onclick = () => runFlash(S.backup, { recover: true }, 'Recovery from backup');

  /* ---------- faults ---------- */
  async function readDtcs(silent) {
    const el = elm(); if (!el) return; const a = await el.dtcs(3), b = await el.dtcs(7);
    S.dtcs = Array.isArray(a) ? a : []; S.pending = Array.isArray(b) ? b : []; S.dtcErr = Array.isArray(a) ? null : a.error; S.dtcRead = true;
    if (!silent) event('Read fault codes: ' + (S.dtcs.length ? S.dtcs.join(', ') : 'none')); renderDtcs();
  }
  function renderDtcs() {
    const rows = S.dtcs.map(c => [c, 'Stored', 'fail']).concat(S.pending.map(c => [c, 'Pending', 'warn']));
    $('#dtcList').innerHTML = S.dtcErr ? '<p class="note">The ECU did not answer the code request (' + esc(S.dtcErr) + ').</p>' : rows.length ? rows.map(r => '<div class="dtc"><code>' + r[0] + '</code><span>' + esc(T.DTC_TEXT[r[0]] || 'Manufacturer-specific or unlisted code') + '</span><span class="pill ' + r[2] + '">' + r[1] + '</span></div>').join('') : '<p class="note">' + (S.dtcRead ? '✓ No fault codes stored.' : 'Not read yet.') + '</p>';
  }
  $('#dtcRead').onclick = () => readDtcs(false);
  $('#dtcClear').onclick = () => {
    if ((S.live.rpm || 0) > 0) return modal('<h3>Stop the engine first</h3><p>Codes are cleared with the ignition on and the engine stopped.</p><div class="row"><button class="btn pri" data-close>OK</button></div>');
    modal('<h3>Clear fault codes on the ' + (S.source === 'ecu' ? 'real ECU' : 'twin ECU') + '?</h3><p>This erases stored codes and the snapshot data saved with them. ' + (S.source === 'ecu' ? 'It is a real write to your bike. ' : '') + 'A fault that is still present will set its code again.</p><p>Export the session report first if you want a record of the codes.</p><div class="row"><button class="btn danger" id="okClear">Clear codes</button><button class="btn" data-close>Cancel</button></div>', box => {
      box.querySelector('#okClear').onclick = async () => { closeModal(); try { const r = await elm().clearDtcs(); event(r.ok ? 'Cleared fault codes on ' + (S.source === 'ecu' ? 'real ECU' : 'twin') : 'ECU refused to clear codes: ' + r.error, r.ok ? 'good' : 'bad'); if (!r.ok) modal('<h3>ECU refused</h3><p>' + esc(r.error) + '</p><div class="row"><button class="btn pri" data-close>OK</button></div>'); await readDtcs(true); } catch (e) { modal('<h3>No reply</h3><p>' + esc(e.message) + '</p><div class="row"><button class="btn pri" data-close>OK</button></div>'); } };
    });
  };


  /* ---------- diagnostics ---------- */
  const D = window.T120D, DG_KEYS = ['rpm', 'ect', 'iat', 'map', 'baro', 'tps', 'grip', 'thrCmd', 'speed', 'stft', 'ltft', 'o2', 'fuelSys'];
  let userVals = {}; try { userVals = JSON.parse(localStorage.getItem('t120.manual') || '{}') || {}; } catch (e) { }
  S.diag = new D.Diagnoser({ user: userVals });
  function diagSample() {
    const L = S.live, s = { t: (Date.now() - S.t0) / 1000, answering: !!S.answering };
    DG_KEYS.forEach(k => { if (avail(k) && L[k] != null) s[k] = L[k]; });
    if (avail('vbat') && L.vbat != null) s.volts = L.vbat; else if (L.atrv != null) s.volts = L.atrv;
    return s;
  }
  const diagMeta = () => ({ source: S.source, dtcs: S.dtcs, pending: S.pending, mil: S.mil, dtcRead: S.dtcRead });
  S.diag.on(list => {
    list.forEach(f => {
      if (!f || !f.active || f.sev === 'info') return; const k = f.id + f.sev, now = Date.now(); if (S.toasted[k] && now - S.toasted[k] < 120000) return; S.toasted[k] = now;
      event((f.sev === 'critical' ? 'Critical: ' : 'Issue: ') + f.title + (f.origin === 'Simulated twin' ? ' (simulated)' : ''), f.sev === 'critical' ? 'bad' : 'warn');
      const el = document.createElement('div'); el.className = 'toast ' + f.sev; el.setAttribute('role', 'status');
      el.innerHTML = '<b>' + (f.sev === 'critical' ? 'Critical: ' : '') + esc(f.title) + '</b>' + esc(f.evidence && f.evidence[0] ? f.evidence[0][0] + ': ' + f.evidence[0][1] : '') + (f.origin === 'Simulated twin' ? ' · simulated' : '');
      el.onclick = () => { S.diagSel = f.id; location.hash = 'diagnose'; el.remove(); renderDiag(true); };
      $('#toasts').appendChild(el); setTimeout(() => el.remove(), 8000);
    });
    renderDiag(S.view === 'diagnose');
  });
  const srcBadge = id => { if (!id) return ''; if (id === 'user') return '<span class="src user" title="Value you entered from your manual">Your manual</span>'; const s = D.SOURCES[id]; if (!s) return ''; return '<span class="src ' + s.tier + '" title="' + esc(s.title + (s.note ? '. ' + s.note : '')) + '">' + esc(D.TIER[s.tier].split(' (')[0]) + '</span>'; };
  const sevLabel = { critical: '✕ Critical', warn: '! Warning', info: 'i Info' }, sevPill = { critical: 'fail', warn: 'warn', info: 'idle' };
  const ago = t => { const d = Math.max(0, (Date.now() - S.t0) / 1000 - t); return d < 60 ? Math.round(d) + ' s ago' : Math.round(d / 60) + ' min ago'; };
  function findingHtml(f, open) {
    const parts = (f.parts || []).map(p => D.PARTS[p] ? '<button class="pchip' + (D.PARTS[p].pin ? '' : ' nopin') + '" data-part="' + p + '" aria-pressed="false">' + esc(D.PARTS[p].name) + '</button>' : '').join('');
    const srcs = Array.from(new Set(f.src || [])).filter(id => D.SOURCES[id]).map(id => { const s = D.SOURCES[id]; return '<li>' + srcBadge(id) + ' ' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : esc(s.title)) + (s.note ? '<br><span class="note" style="font-size:12px">' + esc(s.note) + '</span>' : '') + '</li>'; }).join('');
    return '<article class="find ' + (f.active ? f.sev : 'resolved') + '" data-f="' + f.id + '"><div class="fh"><span class="pill ' + (f.active ? sevPill[f.sev] : 'idle') + '">' + (f.active ? sevLabel[f.sev] : '✓ Resolved') + '</span><h4>' + esc(f.title) + '</h4><span class="tag">' + esc(f.system) + '</span><span class="tag' + (f.origin === 'Simulated twin' ? ' model' : '') + '">' + esc(f.origin) + '</span></div>' +
      '<table class="evt">' + (f.evidence || []).map(e => '<tr><td>' + esc(e[0]) + '</td><td>' + esc(e[1]) + '</td><td>' + srcBadge(e[2]) + '</td></tr>').join('') + '</table>' +
      '<p class="note" style="font-size:12px">First seen ' + ago(f.firstSeen) + ', last ' + ago(f.lastSeen) + (f.count > 1 ? ', ' + f.count + ' times' : '') + '. Confidence in the diagnosis: ' + esc(f.conf) + '.</p>' +
      '<details' + (open ? ' open' : '') + '><summary>What it means, how to fix it, where it is</summary><h5>What it means</h5><p>' + esc(f.meaning) + '</p>' +
      '<h5>Likely causes, most likely first</h5><ol>' + (f.causes || []).map(c => '<li>' + esc(c[0]) + (c[1] || []).map(srcBadge).join('') + '</li>').join('') + '</ol>' +
      '<h5>How to check and fix</h5><ol>' + (f.fix || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' +
      '<h5>Where on the bike</h5><div class="pchips">' + parts + '</div>' +
      '<h5>Sources</h5><ul>' + srcs + '</ul></details>' +
      '<div class="row noprint"><button class="btn sm" data-show="' + f.id + '">Show on bike</button>' + (f.active ? '' : '<button class="btn sm" data-dismiss="' + f.id + '">Dismiss</button>') + '</div></article>';
  }
  const COV = [['Overheating', ['ect']], ['Thermostat', ['ect', 'speed']], ['Coolant sensor', ['ect']], ['Air temperature sensor', ['iat']], ['Charging', ['volts']], ['Battery', ['volts']], ['Wiring drop-outs', ['volts']], ['Fuel mixture', ['stft', 'ltft']], ['Oxygen sensor', ['o2']], ['Fuel control mode', ['fuelSys']], ['Idle stability', ['rpm']], ['MAP vs air pressure', ['map', 'baro']], ['Fault codes', ['codes']], ['Twist grip', ['grip']]];
  function covered(k) { if (k === 'volts') return avail('vbat') || S.live.atrv != null || S.source === 'twin'; if (k === 'codes') return !!S.session; return avail(k); }
  function drawBike() {
    const P = D.PARTS, sel = S.diagSel ? (S.diag.findings[S.diagSel] || {}).parts || [] : [], selPart = S.diagPart;
    const on = p => selPart ? p === selPart : sel.includes(p);
    let s = '<path class="ln" d="M40 440H960"/>' +
      '<circle class="ln" cx="230" cy="370" r="100"/><circle class="ln" cx="230" cy="370" r="22"/><circle class="ln" cx="800" cy="370" r="100"/><circle class="ln" cx="800" cy="370" r="22"/>' +
      '<path class="ln" d="M230 370 430 330M700 112 800 370M712 108 812 366"/>' +
      '<path class="fl" d="M380 200 C390 150 430 135 520 132 C600 130 650 150 668 196 Z"/>' +
      '<path class="fl" d="M160 190 C200 176 330 176 392 190 L392 206 L170 206 Z"/>' +
      '<path class="fl" d="M335 208 H432 L422 292 L346 282 Z"/>' +
      '<rect class="fl" x="452" y="206" width="158" height="96" rx="10"/><path class="ln" d="M462 226H600M462 246H600M462 266H600M462 286H600"/>' +
      '<path class="fl" d="M420 302 H642 L630 404 H436 Z"/>' +
      '<rect class="fl" x="410" y="214" width="44" height="40" rx="6"/>' +
      '<rect class="fl" x="652" y="206" width="40" height="128" rx="4"/>' +
      '<path class="ln" d="M600 252 C660 262 668 330 648 410 C600 430 420 424 300 412"/><path class="fl" d="M170 398 H330 L326 424 H176 Z"/>' +
      '<circle class="fl" cx="752" cy="150" r="30"/><path class="ln" d="M700 104 L722 84 L742 78"/><rect class="fl" x="726" y="198" width="26" height="22" rx="3"/>' +
      '<rect class="fl" x="392" y="272" width="16" height="22" rx="3"/>' +
      '<text x="40" y="474" font-size="26" font-weight="600" fill="var(--muted)">REAR</text><text x="960" y="474" text-anchor="end" font-size="26" font-weight="600" fill="var(--muted)">FRONT</text>';
    const boxes = [], pins = [], labels = [];
    Object.keys(P).forEach(k => { const p = P[k]; if (!p.pin) return; const lit = on(k), [x, y] = p.pin; pins.push('<g class="pin' + (lit ? ' on' : '') + '" data-part="' + k + '" style="cursor:pointer"><circle class="h" cx="' + x + '" cy="' + y + '" r="10"/><circle class="c" cx="' + x + '" cy="' + y + '" r="' + (lit ? 13 : 8) + '"/></g>');
      if (!lit) return; const name = p.name.split(' (')[0], w = name.length * 16.5 + 8, right = x <= 600;
      for (const dy of [-22, 46, -62, 86, -102, 126]) { const ly = y + dy, x0 = right ? x + 16 : x - 16 - w, b = [x0, ly - 26, x0 + w, ly + 6]; if (boxes.every(o => b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3])) { boxes.push(b); labels.push('<g class="lbl"><text x="' + (right ? x + 16 : x - 16) + '" y="' + ly + '" text-anchor="' + (right ? 'start' : 'end') + '">' + esc(name) + '</text></g>'); break; } } });
    s += pins.join('') + labels.join('');
    $('#bike').innerHTML = s;
    const list = selPart ? [selPart] : sel;
    $('#dgLoc').innerHTML = list.length ? list.filter(k => P[k]).map(k => { const p = P[k]; return '<div><b>' + esc(p.name) + '</b>' + esc(p.where) + '<br><span class="note">To reach it: ' + esc(p.access) + '</span><br><span class="note">Manual: ' + esc(p.page) + '. Position confidence: ' + esc(p.conf) + (p.pin ? '' : ' (not drawn: no source gives its position)') + '.</span> ' + p.src.map(srcBadge).join('') + '</div>'; }).join('') : '<p class="note">Choose a finding or a part to see where it is.</p>';
  }
  function renderDiag(full) {
    const all = S.diag.list(), act = all.filter(f => f.active), n = sv => act.filter(f => f.sev === sv).length, c = n('critical'), w = n('warn');
    const chip = $('#diagChip'); chip.className = 'chip diag ' + (c ? 'crit' : w ? 'warn' : 'good'); chip.lastElementChild.textContent = c ? c + ' critical' + (w ? ', ' + w + ' warning' + (w > 1 ? 's' : '') : '') : w ? w + ' issue' + (w > 1 ? 's' : '') : 'No issues';
    if (S.view !== 'diagnose' && !full) return;
    const sim = S.source === 'twin', mins = Math.round(((Date.now() - S.t0) / 1000) / 60);
    $('#dgSum').innerHTML = '<span class="chip ' + (c ? 'crit' : '') + '"><i></i><span>' + c + ' critical</span></span><span class="chip ' + (w ? 'warn' : '') + '"><i></i><span>' + w + ' warning' + (w === 1 ? '' : 's') + '</span></span><span class="chip"><i></i><span>' + n('info') + ' info</span></span><span class="chip"><i></i><span>' + (all.length - act.length) + ' resolved</span></span><span class="chip ' + (sim ? 'twin' : 'ecu') + '">' + (sim ? 'Checking simulated twin data' : 'Checking live ECU data') + '</span>';
    if (full || !$('#dgList').dataset.sig || $('#dgList').dataset.sig !== all.map(f => f.id + f.sev + f.active + f.count).join()) {
      $('#dgList').dataset.sig = all.map(f => f.id + f.sev + f.active + f.count).join();
      const openId = S.diagSel;
      $('#dgList').innerHTML = all.length ? all.map(f => findingHtml(f, f.id === openId)).join('') : '<div class="card"><h3>No issues found</h3><p class="note">' + (mins < 1 ? 'Watching the data. ' : mins + ' minute' + (mins === 1 ? '' : 's') + ' of data checked. ') + 'Checks run continuously while connected. For the most exact results, run the guided tests below.' + (sim ? ' This is the twin; use the fault simulator to see how an issue is reported.' : '') + '</p></div>';
    } else {
      all.forEach(f => { const el = document.querySelector('#dgList [data-f="' + f.id + '"] .evt'); if (el) el.innerHTML = (f.evidence || []).map(e => '<tr><td>' + esc(e[0]) + '</td><td>' + esc(e[1]) + '</td><td>' + srcBadge(e[2]) + '</td></tr>').join(''); });
    }
    $('#dgCov').innerHTML = COV.map(x => { const y = x[1].every(covered); return '<span class="' + (y ? 'y' : 'n') + '" title="' + (y ? 'Running' : 'Needs ' + x[1].join(', ')) + '">' + x[0] + '</span>'; }).join('');
    $('#dgTwin').style.display = sim ? '' : 'none';
    $$('#dgSymp [data-sym]').forEach(b => { const on = !!S.twin.sym[b.dataset.sym]; b.setAttribute('aria-pressed', on); b.classList.toggle('pri', on); });
    drawBike(); renderRunner();
  }
  $('#dgRef').innerHTML = '<thead><tr><th>Item</th><th>Value</th><th>Source</th></tr></thead><tbody>' + D.REF.map(r => '<tr><td>' + esc(r.k) + '</td><td style="font-family:var(--body)">' + esc(r.v) + '</td><td style="font-family:var(--body)">' + srcBadge(r.src) + ' ' + esc(r.page) + '</td></tr>').join('') + '</tbody>';
  $('#dgNa').innerHTML = D.NOT_AVAILABLE.map(r => '<li>' + esc(r.k) + ': see ' + esc(r.page) + '</li>').join('');
  const UF = [['idle', 'Warm idle speed', 'rpm', 10], ['idleTol', 'Idle tolerance ±', 'rpm', 10], ['chargeMin', 'Charging minimum', 'V', 0.1], ['chargeMax', 'Charging maximum', 'V', 0.1]];
  $('#dgUser').innerHTML = UF.map(f => '<label for="uv-' + f[0] + '">' + f[1] + ' <input class="fld" id="uv-' + f[0] + '" data-uv="' + f[0] + '" type="number" step="' + f[3] + '" style="width:84px" value="' + esc(userVals[f[0]] || '') + '"> ' + f[2] + '</label>').join('') + '<button class="btn sm" id="uvSave">Save</button>';
  $('#uvSave').onclick = () => { $$('[data-uv]').forEach(i => { const v = parseFloat(i.value); if (isNaN(v)) delete userVals[i.dataset.uv]; else userVals[i.dataset.uv] = v; }); if ((userVals.chargeMin != null) !== (userVals.chargeMax != null)) { modal('<h3>Enter both charging figures</h3><p>The charging check needs a minimum and a maximum.</p><div class="row"><button class="btn pri" data-close>OK</button></div>'); return; } S.diag.user = userVals; try { localStorage.setItem('t120.manual', JSON.stringify(userVals)); } catch (e) { } event('Saved your manual values: ' + (Object.keys(userVals).join(', ') || 'none')); $('#uvSave').textContent = 'Saved'; setTimeout(() => { $('#uvSave').textContent = 'Save'; }, 1500); };
  $('#dgSymp').innerHTML = Object.keys(T.SYMPTOMS).map(k => '<button class="btn sm" data-sym="' + k + '" aria-pressed="false">' + esc(T.SYMPTOMS[k]) + '</button>').join('');
  $('#dgSymp').onclick = e => { const b = e.target.closest('[data-sym]'); if (!b) return; const k = b.dataset.sym, on = !S.twin.sym[k]; S.twin.symptom(k, on); event((on ? 'Twin fault on: ' : 'Twin fault off: ') + T.SYMPTOMS[k], on ? 'warn' : 'info'); renderDiag(true); };
  $('#v-diagnose').addEventListener('click', e => {
    const p = e.target.closest('[data-part]'), sh = e.target.closest('[data-show]'), dm = e.target.closest('[data-dismiss]');
    if (p) { S.diagPart = S.diagPart === p.dataset.part ? null : p.dataset.part; $$('#v-diagnose .pchip').forEach(b => b.setAttribute('aria-pressed', b.dataset.part === S.diagPart)); drawBike(); }
    if (sh) { S.diagSel = sh.dataset.show; S.diagPart = null; drawBike(); if (window.innerWidth < 860) $('#bike').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (dm) { S.diag.clear(dm.dataset.dismiss); renderDiag(true); }
  });
  $('#dgList').addEventListener('toggle', e => { const a = e.target.closest('[data-f]'); if (a && e.target.open) { S.diagSel = a.dataset.f; S.diagPart = null; drawBike(); } }, true);
  $('#dgClear').onclick = () => { S.diag.list().filter(f => !f.active).forEach(f => S.diag.clear(f.id)); renderDiag(true); };

  /* guided tests */
  $('#dgTests').innerHTML = D.TESTS.map(t => '<button class="btn" data-test="' + t.id + '">' + esc(t.title) + ' <span class="note">· ' + t.time + '</span></button>').join('');
  $('#dgTests').onclick = e => { const b = e.target.closest('[data-test]'); if (!b || S.test) return; S.testSel = D.TESTS.find(t => t.id === b.dataset.test); S.testResult = null; renderRunner(true); };
  function testCtx() { const x = S.diag.ctx(diagMeta()); x.coldSoak = !S.diag.runStart && (S.live.ect || 99) < 45; return x; }
  function twinPrep(t) {
    const tw = S.twin, c = tw.ctl; S.auto = false; $('#cAuto').checked = false; S.launch = null; tw.setIgnition(true);
    if (t.id === 'koeo' || t.id === 'grip' || t.id === 'crank') { tw.stop(); c.gear = 0; c.grip = 0; c.brake = 100; }
    if (t.id === 'charge') { if (!tw.s.run) tw.start(); c.gear = 0; c.grip = 0; }
    if (t.id === 'idle') { if (tw.s.ect < 85) { tw.warm(88); event('Twin warmed to 88 °C instantly for the idle test'); } if (!tw.s.run) tw.start(); c.gear = 0; c.grip = 0; c.brake = 100; }
  }
  function twinAct(t) {
    const tw = S.twin, c = tw.ctl; let k = 0;
    if (t.id === 'crank') { S.drive = dt => { k += dt; if (k > 1.2 && !tw.s.run && tw.s.crank <= 0) tw.start(); return k < 12; }; }
    if (t.id === 'charge') { S.drive = dt => { k += dt; c.gear = 0; c.grip = Math.max(0, Math.min(40, c.grip + (3000 - tw.out.rpm) * 0.002)); return !!S.test; }; }
    if (t.id === 'grip') { S.drive = dt => { k += dt; const ph = k % 5; c.grip = k < 10 && ph < 3 ? ph / 3 * 100 : 0; return !!S.test; }; }
    if (t.id === 'idle' || t.id === 'koeo') S.drive = dt => !!S.test;
  }
  function renderRunner(force) {
    const box = $('#dgRunner'), t = S.testSel; if (!t) { box.innerHTML = ''; return; }
    const x = testCtx(), ready = t.ready(x), sim = S.source === 'twin', run = S.test, res = S.testResult;
    if (!force && run && box.querySelector('.prog i')) { box.querySelector('.prog i').style.width = Math.round(run.progress * 100) + '%'; box.querySelector('#trState').textContent = run.state; return; }
    if (!force && !run && !res && box.querySelector('#trState')) { box.querySelector('#trState').textContent = ready ? 'Ready' : t.readyText; const sb = box.querySelector('#trStart'); if (sb) sb.disabled = !ready; return; }
    if (!force && res && box.dataset.res === String(res.at)) return;
    box.dataset.res = res ? String(res.at) : '';
    box.innerHTML = '<div class="runner"><div class="row"><b style="font-size:15px">' + esc(t.title) + '</b><span class="tag">' + t.time + '</span><span class="sp" style="flex:1"></span><button class="btn sm" id="trClose">Close</button></div>' +
      '<ol>' + t.steps.map(s => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
      (res ? '<table class="res"><thead><tr><th>Check</th><th>Measured</th><th>Limit</th><th>Result</th></tr></thead><tbody>' + res.rows.map(r => '<tr><td>' + esc(r.name) + ' ' + srcBadge(r.src) + '</td><td class="mono">' + esc(r.value) + '</td><td>' + esc(r.limit) + '</td><td><span class="pill ' + (r.info ? 'idle' : r.pass ? 'pass' : 'fail') + '">' + (r.info ? 'Info' : r.pass ? '✓ Pass' : '✕ Fail') + '</span></td></tr>').join('') + '</tbody></table><p class="note">' + (res.rows.some(r => !r.pass && !r.info) ? 'Failed checks were added to the findings above with what to do next.' : 'All checks passed.') + (sim ? ' Simulated twin data.' : '') + '</p><div class="row"><button class="btn" id="trAgain">Run again</button></div>'
        : run ? '<div class="prog"><i style="width:' + Math.round(run.progress * 100) + '%"></i></div><p class="note" id="trState">' + esc(run.state) + '</p><div class="row"><button class="btn danger" id="trStop">Stop test</button></div>'
          : '<p class="note" id="trState">' + (ready ? 'Ready' : esc(t.readyText)) + '</p><div class="row"><button class="btn pri" id="trStart"' + (ready ? '' : ' disabled') + '>Start test</button>' + (sim ? '<button class="btn" id="trTwin">Set up the twin for this test</button>' : '') + '</div>') + '</div>';
    const q = s => box.querySelector(s);
    q('#trClose').onclick = () => { stopTest(); S.testSel = null; S.testResult = null; renderRunner(true); };
    if (q('#trAgain')) q('#trAgain').onclick = () => { S.testResult = null; renderRunner(true); };
    if (q('#trStop')) q('#trStop').onclick = () => { stopTest(); renderRunner(true); };
    if (q('#trTwin')) q('#trTwin').onclick = () => { twinPrep(t); setTimeout(() => renderRunner(true), 600); };
    if (q('#trStart')) q('#trStart').onclick = () => startTest(t);
  }
  function stopTest() { if (S.test) { clearInterval(S.test.timer); S.test = null; S.drive = null; } }
  function startTest(t) {
    const t0 = performance.now() / 1000, samples = [], run = S.test = { focus: t.focus, progress: 0, state: 'Collecting data', samples };
    if (S.source === 'twin') twinAct(t);
    let started = null;
    run.timer = setInterval(() => {
      const now = performance.now() / 1000, s = Object.assign(diagSample(), { t: now - t0 }); samples.push(s);
      if (t.id === 'crank') { if (started == null && s.rpm > 700) started = s.t; run.state = started != null ? 'Running. Hold on while the voltage settles.' : s.rpm > 30 ? 'Cranking…' : 'Ready. Press start now.'; run.progress = started != null ? Math.min(1, (s.t - started) / 6) : Math.min(0.5, s.t / t.duration); if ((started != null && s.t - started > 6) || s.t > t.duration) finish(); }
      else if (t.window) { const n = samples.filter(t.window).length; run.progress = Math.min(1, n / (t.duration * 8)); run.state = t.window(s) ? 'Holding 3,000 rpm' : 'Bring the engine to 3,000 rpm and hold it'; if (run.progress >= 1 || s.t > t.duration * 4) finish(); }
      else { run.progress = Math.min(1, s.t / t.duration); run.state = 'Collecting data'; if (s.t >= t.duration) finish(); }
      renderRunner();
    }, 100);
    function finish() {
      clearInterval(run.timer); S.test = null; if (S.drive) S.drive = null;
      const rows = t.analyse(samples, testCtx()); S.testResult = { rows, at: Date.now() };
      S.diag.fromTest(t, rows, (Date.now() - S.t0) / 1000, S.source);
      event(t.title + ' test: ' + rows.filter(r => !r.info && !r.pass).length + ' failed of ' + rows.filter(r => !r.info).length + (S.source === 'twin' ? ' (simulated)' : ''), rows.some(r => !r.pass && !r.info) ? 'warn' : 'good');
      renderRunner(true); renderDiag(true);
    }
    renderRunner(true);
  }

  /* report */
  function diagExport() { return S.diag.list().map(f => ({ id: f.id, title: f.title, severity: f.sev, active: f.active, origin: f.origin, system: f.system, evidence: (f.evidence || []).map(e => ({ item: e[0], value: e[1], source: e[2] })), meaning: f.meaning, causes: (f.causes || []).map(c => ({ cause: c[0], sources: c[1] })), fix: f.fix, parts: (f.parts || []).map(p => ({ part: D.PARTS[p].name, where: D.PARTS[p].where, access: D.PARTS[p].access, manual: D.PARTS[p].page, positionConfidence: D.PARTS[p].conf })), sources: Array.from(new Set(f.src || [])).filter(s => D.SOURCES[s]).map(s => ({ id: s, tier: D.TIER[D.SOURCES[s].tier], title: D.SOURCES[s].title, url: D.SOURCES[s].url })) })); }
  function diagHtml(inline) {
    const L = S.diag.list(); if (!L.length) return '<p>No issues found.</p>';
    return L.map(f => '<div style="border-left:5px solid ' + (f.active ? (f.sev === 'critical' ? '#d03b3b' : f.sev === 'warn' ? '#fab219' : '#0b6477') : '#999') + ';padding:4px 12px;margin:14px 0"><h3 style="margin:0">' + esc((f.active ? f.sev.toUpperCase() + ': ' : 'RESOLVED: ') + f.title) + '</h3><p>' + esc(f.origin) + ' · ' + esc(f.system) + '</p><table>' + (f.evidence || []).map(e => '<tr><td>' + esc(e[0]) + '</td><td>' + esc(e[1]) + '</td><td>' + esc(e[2] && D.SOURCES[e[2]] ? D.TIER[D.SOURCES[e[2]].tier] : e[2] === 'user' ? 'Your manual' : '') + '</td></tr>').join('') + '</table><p>' + esc(f.meaning) + '</p><b>Likely causes</b><ol>' + (f.causes || []).map(c => '<li>' + esc(c[0]) + '</li>').join('') + '</ol><b>How to check and fix</b><ol>' + (f.fix || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol><b>Where</b><ul>' + (f.parts || []).map(p => '<li><b>' + esc(D.PARTS[p].name) + ':</b> ' + esc(D.PARTS[p].where) + ' To reach it: ' + esc(D.PARTS[p].access) + ' (' + esc(D.PARTS[p].page) + ')</li>').join('') + '</ul><b>Sources</b><ul>' + Array.from(new Set(f.src || [])).filter(s => D.SOURCES[s]).map(s => '<li>' + esc(D.TIER[D.SOURCES[s].tier]) + ': ' + (D.SOURCES[s].url ? '<a href="' + esc(D.SOURCES[s].url) + '">' + esc(D.SOURCES[s].title) + '</a>' : esc(D.SOURCES[s].title)) + '</li>').join('') + '</ul></div>').join('');
  }
  $('#dgExport').onclick = () => exportFile('t120-diagnosis.html', 'text/html', '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T120 diagnosis</title><style>body{font:14px system-ui;max-width:820px;margin:24px auto;padding:0 16px}td{border-bottom:1px solid #ddd;padding:4px 8px}</style></head><body>' + (S.source === 'twin' ? '<p style="background:#fab219;padding:8px 12px;font-weight:700">SIMULATED DATA. Digital twin model, not readings from a motorcycle.</p>' : '') + '<h1>T120 diagnosis</h1><p>' + esc(new Date().toLocaleString()) + ' · ' + (S.source === 'twin' ? 'Digital twin' : 'Live ECU, VIN ' + esc(S.session && S.session.info.vin || '')) + '</p><p>Every finding lists its evidence and sources. Service manual pages are from your own copy\'s index; confirm values there before repair.</p>' + diagHtml() + '</body></html>');

  /* ---------- report ---------- */
  function stats() {
    const st = {}; S.hist.forEach(r => { for (const k in r) { if (k === 't') continue; const v = r[k], s = st[k] || (st[k] = { min: v, max: v, sum: 0, n: 0 }); if (v < s.min) s.min = v; if (v > s.max) s.max = v; s.sum += v; s.n++; } });
    return st;
  }
  const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  function summary(st) {
    const dur = S.hist.length ? S.hist[S.hist.length - 1].t : 0, dist = st.speed ? st.speed.sum / st.speed.n * dur / 3600 : 0, g = (k, f, dp, u) => st[k] ? st[k][f].toFixed(dp) + u : '–';
    return [['Duration', mmss(dur)], ['Distance', dist.toFixed(2) + ' km'], ['Peak rpm', g('rpm', 'max', 0, '')], ['Top speed', g('speed', 'max', 0, ' km/h')], ['Peak coolant', g('ect', 'max', 0, ' °C')], ['Lowest battery', g('vbat', 'min', 1, ' V')], ['Fault codes', String(S.dtcs.length)], ['Samples', String(S.hist.length)]];
  }
  function renderReport() {
    const st = stats(), info = S.session ? S.session.info : {};
    $('#repSub').textContent = (S.source === 'twin' ? 'Digital twin session, simulated data. ' : 'Live ECU session, VIN ' + info.vin + '. ') + 'Started ' + new Date(S.t0).toLocaleString() + '.';
    $('#repSum').innerHTML = summary(st).map(x => '<div><b>' + esc(x[1]) + '</b><span>' + x[0] + '</span></div>').join('');
    $('#repStats').innerHTML = '<thead><tr><th>Channel</th><th>Source</th><th>Min</th><th>Average</th><th>Max</th><th>Unit</th></tr></thead><tbody>' + Object.keys(st).map(k => '<tr><td>' + CH[k].name + '</td><td>' + (CH[k].src === 'pid' ? 'OBD' : 'Twin') + '</td><td>' + st[k].min.toFixed(CH[k].dp) + '</td><td>' + (st[k].sum / st[k].n).toFixed(CH[k].dp) + '</td><td>' + st[k].max.toFixed(CH[k].dp) + '</td><td>' + CH[k].unit + '</td></tr>').join('') + '</tbody>';
    $('#repEvents').innerHTML = S.events.slice().reverse().map(e => '<li class="' + (e.level === 'bad' ? 'bad' : e.level === 'good' ? 'good' : e.level === 'warn' ? 'warn' : '') + '">' + e.t.toLocaleTimeString() + '  ' + esc(e.msg) + '</li>').join('') || '<li>No events yet.</li>';
    const step = Math.max(1, Math.floor(S.hist.length / 300)), rows = S.hist.filter((r, i) => i % step === 0), x = rows.map(r => r.t), xm = x.length ? x[x.length - 1] : 1;
    const common = { x, xMin: 0, xMax: Math.max(xm, 1), xTicks: [0, xm / 2, xm], xFmt: v => mmss(v) };
    repC1.set(Object.assign({ yMin: 0, yMax: 8000, series: [{ label: 'Engine speed', color: '--s1', ys: rows.map(r => r.rpm), fmt: v => v.toFixed(0) + ' rpm' }] }, common));
    repC2.set(Object.assign({ yMin: 0, yMax: 120, series: [['ect', 'Coolant', '--s1'], ['iat', 'Intake air', '--s2'], ['oil', 'Oil', '--s3']].filter(s => avail(s[0])).map(s => ({ label: s[1], color: s[2], ys: rows.map(r => r[s[0]]), fmt: v => v.toFixed(0) + ' °C' })) }, common));
  }
  const keysLogged = () => LOGKEYS.filter(k => S.hist.some(r => r[k] != null));
  $('#expCsv').onclick = () => { const ks = keysLogged(); exportFile('t120-log.csv', 'text/csv', ['source', 'time_s'].concat(ks.map(k => k + (CH[k].unit ? '_' + CH[k].unit.replace(/[^A-Za-z%°/]/g, '') : ''))).join(',') + '\n' + S.hist.map(r => [S.source === 'twin' ? 'SIMULATED' : 'ECU', r.t.toFixed(1)].concat(ks.map(k => r[k] == null ? '' : +r[k].toFixed(3))).join(',')).join('\n')); };
  $('#expJson').onclick = () => exportFile('t120-session.json', 'application/json', JSON.stringify({ app: 'T120 Bench', source: S.source, simulated: S.source === 'twin', started: new Date(S.t0).toISOString(), ecu: S.session ? S.session.info : {}, summary: summary(stats()), faultCodes: S.dtcs, pending: S.pending, diagnosis: diagExport(), link: S.session ? S.session.link : null, acceleration: { peakG: +S.acc.peakG.toFixed(3), best: S.acc.best, runs: S.acc.runs.map(r => ({ run: r.name, seconds: +r.time.toFixed(3), peakG: +r.peakG.toFixed(3), timingUncertaintySeconds: r.period ? +r.period.toFixed(3) : null })) }, events: S.events.map(e => ({ t: e.t.toISOString(), msg: e.msg })), workingMap: S.work, validation: S.val, log: S.hist }));
  $('#expHtml').onclick = () => {
    const st = stats(), poly = k => { const step = Math.max(1, Math.floor(S.hist.length / 300)), rows = S.hist.filter((r, i) => i % step === 0), c = CH[k], xm = rows.length ? rows[rows.length - 1].t : 1; return '<svg viewBox="0 0 600 120" style="width:100%;border:1px solid #ccc"><polyline fill="none" stroke="#2a78d6" stroke-width="1.5" points="' + rows.filter(r => r[k] != null).map(r => (r.t / xm * 600).toFixed(1) + ',' + (120 - (clamp(r[k], c.min, c.max) - c.min) / (c.max - c.min) * 120).toFixed(1)).join(' ') + '"/></svg>'; };
    exportFile('t120-report.html', 'text/html', '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T120 session report</title><style>body{font:14px system-ui;max-width:800px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:5px 8px;text-align:right}td:first-child,th:first-child{text-align:left}h2{margin-top:28px}</style></head><body>' + (S.source === 'twin' ? '<p style="background:#fab219;padding:8px 12px;font-weight:700">SIMULATED DATA. Digital twin model, not readings from a motorcycle.</p>' : '') + '<h1>T120 session report</h1><p>' + esc($('#repSub').textContent) + '</p><table>' + summary(st).map(x => '<tr><td>' + x[0] + '</td><td>' + esc(x[1]) + '</td></tr>').join('') + '</table><h2>Engine speed (0 to 8000 rpm)</h2>' + poly('rpm') + (st.ect ? '<h2>Coolant (-20 to 130 °C)</h2>' + poly('ect') : '') + '<h2>Diagnosis</h2>' + diagHtml(true) + '<h2>Acceleration</h2><p>' + (S.acc.runs.length ? S.acc.runs.map(r => r.name.replace('-', ' to ') + ' km/h in ' + r.time.toFixed(2) + ' s, peak ' + r.peakG.toFixed(2) + ' g').join('<br>') : 'No timed runs') + '</p><h2>Fault codes</h2><p>' + (S.dtcs.length ? S.dtcs.map(c => c + ' ' + esc(T.DTC_TEXT[c] || '')).join('<br>') : 'None stored') + '</p><h2>Channels</h2><table><tr><th>Channel</th><th>Min</th><th>Average</th><th>Max</th><th>Unit</th></tr>' + Object.keys(st).map(k => '<tr><td>' + CH[k].name + '</td><td>' + st[k].min.toFixed(CH[k].dp) + '</td><td>' + (st[k].sum / st[k].n).toFixed(CH[k].dp) + '</td><td>' + st[k].max.toFixed(CH[k].dp) + '</td><td>' + CH[k].unit + '</td></tr>').join('') + '</table><h2>Events</h2><p>' + S.events.map(e => e.t.toLocaleTimeString() + ' ' + esc(e.msg)).join('<br>') + '</p></body></html>');
  };
  if (inFrame) $('#expPrint').hidden = true;
  $('#expPrint').onclick = () => { renderReport(); try { window.print(); } catch (e) { } };
  $('#repReset').onclick = () => { resetLog(); S.events = []; event('New session started'); renderReport(); };

  /* ---------- periodic UI ---------- */
  let nTick = 0, curCell = null;
  function tick(force) {
    nTick++; const L = S.live, slow = force || nTick % 4 === 0;
    const lat = elm() ? elm().lat : 0;
    setChip('#linkChip', !S.session ? 'warn' : S.answering ? 'good' : 'warn', !S.session ? 'Starting' : S.answering ? 'ECU answering, ' + Math.round(lat) + ' ms' : (S.source === 'twin' && tw.prog ? 'ECU in programming' : 'ECU silent'));
    setChip('#milChip', S.mil ? 'crit' : 'good', S.mil ? 'MIL on, ' + S.dtcCount + ' code' + (S.dtcCount === 1 ? '' : 's') : 'MIL off');
    if (S.source === 'twin') updDock();
    if (S.view === 'live') {
      const rpm = L.rpm || 0, lim = S.source === 'twin' ? tw.map.sc.revLimit : 7000;
      $('#tNeedle').style.transform = 'rotate(' + ang(rpm) + 'deg)'; $('#tArc').setAttribute('d', rpm > 30 ? arc(118, -225, ang(rpm)) : ''); $('#tRed').setAttribute('d', arc(118, ang(lim), 45));
      $('#tRpm').textContent = Math.round(rpm / 10) * 10; $('#gSpeed').textContent = L.speed != null ? Math.round(L.speed) : '–';
      $('#gGear').textContent = avail('gear') ? fmt('gear', L.gear) : '–';
      const loop = S.source === 'twin' ? tw.out.loop : null; $('#gLoop').textContent = loop == null ? '–' : loop === 2 ? 'Closed' : loop === 0 ? 'Off' : 'Open';
      if (slow) {
        const chips = []; if (S.source === 'twin') { chips.push(['Fan ' + (L.fan ? 'running' : 'off'), L.fan ? 'warn' : '']); chips.push(['Fuel pump ' + (L.pump ? 'running' : 'off'), L.pump ? 'good' : '']); if (L.sai) chips.push(['Secondary air open', 'good']); if (tw.ecu !== 'ok') chips.push(['ECU image corrupt', 'crit']); } else chips.push(['Gear, fan and pump state are not on standard OBD', '']);
        $('#gChips').innerHTML = chips.map(c => '<span class="chip ' + c[1] + '"><i></i><span>' + c[0] + '</span></span>').join('');
        TILES.forEach(t => { const el = $('#tile-' + t[0]), c = CH[t[0]], ok = avail(t[0]) && L[t[0]] != null, v = L[t[0]]; const stt = ok && t[2] ? t[2](v) : ['', '']; el.className = 'tile ' + (ok ? stt[0] : 'na'); el.querySelector('.v span').textContent = ok ? fmt(t[0], v) : '–'; el.querySelector('.bar i').style.width = ok ? clamp((v - c.min) / (c.max - c.min) * 100, 0, 100) + '%' : '0'; el.querySelector('.st').textContent = ok ? stt[1] : (c.src === 'pid' ? 'Not published by this ECU' : 'Not on standard OBD'); });
        drawLiveCharts();
      }
    }
    if (S.view === 'accel' && (force || nTick % 2 === 0)) renderAccel();
    if (nTick % 4 === 0 || force) renderDiag(force && S.view === 'diagnose');
    if (S.view === 'systems' && slow) {
      $$('#flow dd').forEach(dd => { const k = dd.dataset.f; dd.textContent = avail(k) && L[k] != null ? fmt(k, L[k]) + (CH[k].unit ? ' ' + CH[k].unit : '') : 'n/a'; });
      const tail = S.hist.slice(-150);
      $$('#groups tr[data-k]').forEach(tr => { const k = tr.dataset.k, c = CH[k]; if (!avail(k) || L[k] == null) return; tr.querySelector('.v').textContent = fmt(k, L[k]) + (c.unit ? ' ' + c.unit : ''); const b = tr.querySelector('.mbar i'); if (b) b.style.width = clamp((L[k] - c.min) / (c.max - c.min) * 100, 0, 100) + '%'; const pl = tr.querySelector('polyline'); if (pl && tail.length > 1) pl.setAttribute('points', tail.map((r, i) => r[k] == null ? '' : (i / (tail.length - 1) * 90).toFixed(1) + ',' + (21 - clamp((r[k] - c.min) / (c.max - c.min), 0, 1) * 20).toFixed(1)).join(' ')); });
    }
    if (S.view === 'maps' && TBL[S.table] && L.rpm != null) {
      const m = S.work, near = (xs, v) => xs.reduce((b, x, i) => Math.abs(x - v) < Math.abs(xs[b] - v) ? i : b, 0), l = near(m.load, L.tps || 0), r = near(m.rpm, L.rpm), td = (L.rpm > 400) ? $('#mapWrap td[data-l="' + l + '"][data-r="' + r + '"]') : null;
      if (td !== curCell) { if (curCell) curCell.classList.remove('cur'); if (td) td.classList.add('cur'); curCell = td; }
      $('#mapCur').textContent = L.rpm > 400 ? 'Now: ' + Math.round(L.rpm) + ' rpm, ' + Math.round(L.tps || 0) + '% throttle' : 'Engine stopped';
    }
    if (S.view === 'write-lab' && slow) updWrite();
    if (S.view === 'faults' && slow) {
      const i = S.session ? S.session.info : {}, el = elm();
      $('#ecuInfo').innerHTML = [['Source', S.source === 'twin' ? 'Digital twin (simulated)' : 'Real ECU over ' + (S.session.link === 'wifi' ? 'WiFi bridge' : 'Bluetooth LE')], ['Fast reply mode', el ? (el.fast ? 'On' : 'Not supported by adapter') : '–'], ['Adapter', i.adapter || '–'], ['Protocol', i.protocol || '–'], ['VIN', i.vin || '–'], ['Adapter voltage', S.adapterV ? S.adapterV.toFixed(1) + ' V' : '–'], ['Reply time', el ? Math.round(el.lat) + ' ms' : '–'], ['Commands sent', el ? el.tx + ', ' + el.errors + ' timed out' : '–'], ['Published PIDs', el ? String(T.PIDS.filter(p => el.supported.has(p.pid)).length) + ' decoded of ' + el.supported.size + ' reported' : '–']].map(x => '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>').join('');
    }
    if (S.view === 'reports' && (force || nTick % 16 === 0)) renderReport();
  }

  /* ---------- boot ---------- */
  accC1 = makeChart($('#accC1')); accC2 = makeChart($('#accC2')); dynoT = makeChart($('#dynoT')); dynoP = makeChart($('#dynoP')); repC1 = makeChart($('#repC1')); repC2 = makeChart($('#repC2'));
  buildStatic(); renderMap(); mapChanged(); renderDtcs(); route();
  if (window.innerWidth < 860) $('#dock').open = false;
  window.addEventListener('resize', () => { liveCharts.concat([accC1, accC2, dynoT, dynoP, repC1, repC2]).forEach(c => c.draw()); });
  setInterval(tick, 125);
  startSession('twin', new T.TwinTransport(S.twin, { latency: 5 })).then(() => route());
  window.__bench = S;
})();
