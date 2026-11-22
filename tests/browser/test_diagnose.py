import asyncio, json, re
from playwright.async_api import async_playwright
import os, sys, json, pathlib, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = os.environ.get('APP_URL', (ROOT / 'index.html').as_uri())
CHROME = os.environ.get('CHROME') or None
TMP = pathlib.Path(tempfile.mkdtemp(prefix='t120-'))
R = []
def chk(name, cond, detail=''):
    R.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (('  [' + str(detail)[:300] + ']') if not cond else ''))
exec((pathlib.Path(__file__).parent / 'harness.py').read_text())
async def run_test(pg, tid, setup=True, wait=75):
    await pg.click(f'[data-test={tid}]'); await pg.wait_for_timeout(200)
    if await pg.query_selector('#trAgain'): await pg.click('#trAgain'); await pg.wait_for_timeout(200)
    if setup and await pg.query_selector('#trTwin'): await pg.click('#trTwin'); await pg.wait_for_timeout(2500)
    for _ in range(40):
        if await pg.query_selector('#trStart:not([disabled])'): break
        await pg.wait_for_timeout(500)
    await pg.click('#trStart')
    for _ in range(wait * 2):
        await pg.wait_for_timeout(500)
        if await ev(pg, S + ".testResult && !" + S + ".test"): break
    return await ev(pg, S + ".testResult ? " + S + ".testResult.rows : null")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']); errs = []
        pg = await page(b, None, ble=False, errs=errs)
        await ev(pg, "location.hash='diagnose'"); await pg.wait_for_timeout(800)
        chk('Diagnose: page renders with no findings on a healthy twin', 'no issues found' in (await pg.inner_text('#dgList')).lower() and await pg.inner_text('#diagChip') == 'No issues')
        ref = await pg.inner_text('#dgRef')
        chk('Diagnose: reference table lists Triumph figures with sources', all(k in ref for k in ['YTX12-BS', '46.5 A', '88 °C', '90 °C', '15 A']) and await ev(pg, "document.querySelectorAll('#dgRef .src.triumph').length") >= 6)
        na = await pg.inner_text('#dgNa')
        chk('Diagnose: unavailable OEM values are listed, not invented', 'Idle speed' in na and 'Fuel pressure' in na)
        cov = await ev(pg, "[...document.querySelectorAll('#dgCov span')].map(s => s.className)")
        chk('Diagnose: coverage shows every check runnable on the twin', len(cov) == 14 and all(c == 'y' for c in cov), cov)
        chk('Diagnose: drawing has pins only for sourced parts', await ev(pg, "document.querySelectorAll('#bike .pin').length") == await ev(pg, "Object.values(T120D.PARTS).filter(p => p.pin).length") == 14)
        # healthy guided tests
        for tid in ['koeo', 'crank', 'charge', 'idle', 'grip']:
            rows = await run_test(pg, tid)
            bad = [r for r in (rows or []) if not r['pass'] and not r.get('info')]
            chk(f'Test {tid}: completes and passes on a healthy twin', rows and not bad, bad or rows)
        chk('Tests: healthy runs raised no findings', await ev(pg, S + ".diag.list().length") == 0, await ev(pg, S + ".diag.list().map(f => f.id)"))
        # faults
        await pg.click('[data-sym=weakBattery]'); rows = await run_test(pg, 'crank')
        chk('Fault weak battery: crank test fails on the 9.6 V limit', any(r.get('rule') == 'battery-crank' for r in rows), rows)
        f = await ev(pg, S + ".diag.findings['battery-crank']")
        chk('Fault weak battery: finding has evidence, fix, battery location and sources', f and f['active'] and f['parts'] == ['battery'] and 'crankTest' in f['src'] and len(f['fix']) >= 2)
        await pg.click('[data-sym=weakBattery]'); await pg.click('[data-sym=gripGlitch]')
        rows = await run_test(pg, 'grip')
        chk('Fault grip drop-outs: sweep test catches them', any(r.get('rule') == 'grip-glitch' and not r['pass'] for r in rows), rows)
        await pg.click('[data-sym=gripGlitch]')
        await pg.click('[data-sym=overcharge]'); rows = await run_test(pg, 'charge')
        chk('Fault overcharging: charge test fails high', any(r.get('rule') == 'charge-high' for r in rows), rows)
        await pg.wait_for_timeout(1500)
        chk('Alert: header chip shows the critical issue', 'critical' in await pg.inner_text('#diagChip') and 'crit' in await ev(pg, "document.querySelector('#diagChip').className"))
        chk('Alert: events log the issue as simulated', await ev(pg, S + ".events.some(e => /Critical: Charging voltage too high \\(simulated\\)/.test(e.msg))"))
        await pg.click('[data-sym=overcharge]')
        # finding card interactions
        await ev(pg, S + ".diagSel = null"); await ev(pg, "document.querySelector('[data-f=\"charge-high\"] details').open = true"); await pg.wait_for_timeout(300)
        await pg.click('[data-f="charge-high"] [data-show]'); await pg.wait_for_timeout(300)
        lit = await ev(pg, "[...document.querySelectorAll('#bike .pin.on')].map(g => g.dataset.part)")
        chk('Locator: showing a finding lights its parts on the drawing', sorted(lit) == ['battery', 'regrec'], lit)
        loc = await pg.inner_text('#dgLoc')
        chk('Locator: text says where the regulator is and cites the source', 'below the headlight' in loc and 'Accessory maker' in loc, loc[:200])
        await pg.click('[data-f="battery-crank"] details summary'); await pg.wait_for_timeout(200)
        chk('Finding: cause lines carry source badges', await ev(pg, "document.querySelectorAll('[data-f=\"battery-crank\"] ol li .src').length") >= 3)
        await ev(pg, "(() => { const f = window.__bench.diag.findings; window.__bench.diag.fromTest(T120D.TESTS[0], [{ name: 'x', value: 'y', limit: 'z', src: 'app', rule: 'ect-implausible' }], 1, 'twin'); })()"); await pg.wait_for_timeout(1300)
        await ev(pg, "document.querySelector('[data-f=\"ect-implausible\"] details').open = true"); await pg.click('[data-f="ect-implausible"] .pchip.nopin'); await pg.wait_for_timeout(200)
        chk('Locator: a part with no sourced position says so and points to the manual', 'not drawn: no source gives its position' in await pg.inner_text('#dgLoc') and 'p.285' in await pg.inner_text('#dgLoc'))
        # user manual values
        await pg.fill('#uv-idle', '1300'); await pg.fill('#uv-idleTol', '50'); await pg.click('#uvSave'); await pg.wait_for_timeout(300)
        rows = await run_test(pg, 'idle')
        chk('Your manual values: idle figure checked and labelled as yours', any(r['name'] == 'Idle against your manual value' and not r['pass'] and r['src'] == 'user' for r in rows), rows)
        f = await ev(pg, S + ".diag.findings['idle-spec']"); chk('Your manual values: idle finding cites your manual', f and any(e[2] == 'user' for e in f['evidence']))
        await pg.fill('#uv-idle', ''); await pg.fill('#uv-idleTol', ''); await pg.click('#uvSave')
        # exports
        name, text = await dl(pg, '#dgExport')
        chk('Export: diagnostic report stamped simulated with findings and links', name.startswith('SIMULATED-') and 'SIMULATED DATA' in text and 'Charging voltage too high' in text and 'href="https://www.revzilla.com' in text, name)
        await ev(pg, "location.hash='reports'"); await pg.wait_for_timeout(500)
        name, text = await dl(pg, '#expJson'); sj = json.loads(text)
        chk('Export: session JSON carries diagnosis with parts and sources', len(sj['diagnosis']) >= 3 and all(d['sources'] and 'evidence' in d for d in sj['diagnosis']))
        await pg.context.close()
        # live ECU through fake BLE
        pg = await page(b, {}, errs=errs); await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(6000)
        await ev(pg, "location.hash='diagnose'"); await ev(pg, "window.__ble.bike.inject('P0117')"); await pg.wait_for_timeout(9000)
        ids = await ev(pg, S + ".diag.list().map(f => f.id + ':' + f.origin)")
        chk('Live ECU: coolant sensor fault found from data and code, labelled Live ECU', 'ect-implausible:Live ECU' in ids and 'dtc-P0117:Live ECU' in ids, ids)
        chk('Live ECU: twin simulator hidden, header reads live', await ev(pg, "getComputedStyle(document.querySelector('#dgTwin')).display") == 'none' and 'live ECU' in await pg.inner_text('#dgSum'))
        await ev(pg, "(() => { const k = window.__ble.bike; k.heal('P0117'); })()"); await ev(pg, "window.__ble.bike.symptom('overcharge', true); window.__ble.hold = true; window.__ble.bike.ctl.grip = 30")
        await pg.wait_for_timeout(9000)
        ids = await ev(pg, S + ".diag.list().filter(f => f.active).map(f => f.id)")
        chk('Live ECU: overcharging on the bike raises a critical finding', 'charge-high' in ids, ids)
        await pg.context.close()
        # phone
        ph = await (await b.new_context(viewport={'width': 390, 'height': 820}, device_scale_factor=2)).new_page(); ph.on('pageerror', lambda e: errs.append('PH ' + str(e)))
        await ph.goto(URL + '#diagnose'); await ph.wait_for_timeout(2000); await ph.click('[data-sym=overcharge]'); await ph.evaluate("window.__bench.twin.setIgnition(true); window.__bench.auto=false; window.__bench.twin.start(); window.__bench.drive = dt => { const t = window.__bench.twin; t.ctl.gear = 0; t.ctl.grip = Math.max(0, Math.min(40, t.ctl.grip + (3000 - t.out.rpm) * 0.002)); return true; }"); await ph.wait_for_timeout(9000)
        await ph.evaluate("document.querySelector('[data-f] details') && (document.querySelector('[data-f] details').open = true)"); await ph.click('[data-f] [data-show]'); await ph.wait_for_timeout(800)
        chk('Phone: no sideways scroll on Diagnose with a finding open', not await ph.evaluate("document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1"))
        await ph.screenshot(path='d-phone2.png'); await ph.evaluate("document.querySelector('[data-f]').scrollIntoView()"); await ph.screenshot(path='d-phone3.png')
        chk('No JavaScript errors', errs == [], errs[:5])
        await b.close()
    f = [r for r in R if not r[1]]; print(f'\n{len(R) - len(f)} passed, {len(f)} failed')
    out = pathlib.Path(os.environ.get('RESULTS_DIR', ROOT / 'reports'))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'results-diagnose.json').write_text(json.dumps([{'check': r[0], 'pass': r[1], 'detail': str(r[2])[:300] if not r[1] else ''} for r in R], indent=1))
    if f: sys.exit(1)
asyncio.run(main())
