"""Capture the README screenshots and sample reports.

Everything here runs against the digital twin or against test adapters (a fake BLE adapter and a fake
WiFi adapter, each backed by a separate simulated bike). No screenshot shows a real motorcycle.
Usage: python tests/browser/screenshots.py   (env CHROME=/path/to/chrome optional)
"""
import asyncio, os, json, pathlib, subprocess, time, tempfile
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = os.environ.get('APP_URL', (ROOT / 'index.html').as_uri())
CHROME = os.environ.get('CHROME') or None
SHOTS = ROOT / 'docs' / 'screenshots'; SAMPLES = ROOT / 'reports' / 'samples'
SHOTS.mkdir(parents=True, exist_ok=True); SAMPLES.mkdir(parents=True, exist_ok=True)
exec((pathlib.Path(__file__).parent / 'harness.py').read_text())
S = 'window.__bench'

async def shot(pg, name, full=False):
    await pg.wait_for_timeout(400); await pg.screenshot(path=str(SHOTS / (name + '.png')), full_page=full); print('shot', name)

async def save_dl(pg, sel):
    async with pg.expect_download() as d: await pg.click(sel)
    x = await d.value; await x.save_as(str(SAMPLES / x.suggested_filename)); print('sample', x.suggested_filename)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        # ---------- laptop, twin ----------
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1.5, accept_downloads=True); pg = await ctx.new_page()
        await pg.goto(URL); await pg.wait_for_timeout(9000)
        await shot(pg, 'laptop-live')
        await pg.click('#btnConnect'); await shot(pg, 'laptop-connect-chooser'); await pg.click('#modalBox [data-close]')
        await pg.evaluate("location.hash='accel'"); await pg.click('#accLaunch'); await pg.wait_for_timeout(27000); await shot(pg, 'laptop-acceleration')
        await pg.evaluate("location.hash='maps'"); await pg.wait_for_timeout(800)
        await pg.click('#segTable [data-t="ign"]'); await pg.click('th[data-row="11"]'); await pg.click('#mapTools [data-a="+s"]'); await pg.click('#mapTools [data-a="+s"]'); await pg.click('#segMode [data-m="1"]'); await shot(pg, 'laptop-maps')
        await pg.click('#segMode [data-m="0"]')
        await pg.evaluate("location.hash='write-lab'"); await pg.wait_for_timeout(600); await pg.click('#bkBtn'); await pg.click('#pfStop'); await pg.wait_for_timeout(4000)
        await pg.select_option('#rhFault', 'drop'); await pg.click('#rhBtn'); await pg.wait_for_timeout(3500); await shot(pg, 'laptop-write-lab-failure')
        await pg.click('#rhRec'); await pg.wait_for_timeout(2500); await pg.select_option('#rhFault', ''); await pg.click('#rhBtn'); await pg.wait_for_timeout(4500)
        # diagnose: guided test + a simulated fault
        await pg.evaluate("location.hash='diagnose'"); await pg.wait_for_timeout(600)
        await pg.click('[data-sym=overcharge]'); await pg.click('[data-test=charge]'); await pg.click('#trTwin'); await pg.wait_for_timeout(3000)
        for _ in range(40):
            if await pg.query_selector('#trStart:not([disabled])'): break
            await pg.wait_for_timeout(500)
        await pg.click('#trStart')
        for _ in range(80):
            await pg.wait_for_timeout(500)
            if await pg.evaluate(S + '.testResult && !' + S + '.test'): break
        await pg.evaluate("document.querySelector('[data-f=\"charge-high\"] details').open = true"); await pg.click('[data-f="charge-high"] [data-show]')
        await pg.evaluate("document.querySelector('#v-diagnose').scrollIntoView()"); await shot(pg, 'laptop-diagnose-finding')
        await pg.evaluate("document.querySelector('#dgRunner').scrollIntoView({block:'center'})"); await shot(pg, 'laptop-diagnose-test-result')
        await save_dl(pg, '#dgExport')
        await pg.click('[data-sym=overcharge]')
        await pg.evaluate("location.hash='reports'"); await pg.wait_for_timeout(1500); await shot(pg, 'laptop-report')
        for sel in ['#expCsv', '#expJson', '#expHtml']: await save_dl(pg, sel)
        await ctx.close()
        # ---------- laptop, Bluetooth (fake BLE adapter + separate simulated bike) ----------
        pg = await page(b, {}, w=1440, h=900)
        await pg.click('#btnConnect'); await pg.click('#cnBle'); await pg.wait_for_timeout(7000); await shot(pg, 'laptop-bluetooth-connected')
        await pg.evaluate("location.hash='faults'"); await pg.wait_for_timeout(1500); await shot(pg, 'laptop-bluetooth-ecu-info')
        await pg.context.close()
        # ---------- laptop, WiFi through the bridge (fake TCP adapter) ----------
        fake = subprocess.Popen(['node', 'tests/fake-wifi-adapter.js', '35000'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        br = subprocess.Popen(['node', 'tools/t120-wifi-bridge.js', '--adapter', '127.0.0.1:35000', '--port', '8765'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.2)
        try:
            ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1.5); pg = await ctx.new_page()
            await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(2500)
            await pg.click('#btnConnect'); await pg.wait_for_timeout(300); await shot(pg, 'laptop-wifi-address')
            await pg.click('#cnWifi'); await pg.wait_for_timeout(6000); await shot(pg, 'laptop-wifi-connected')
            await ctx.close()
            # phone on the same network as the bridge (Android or iPhone, any browser)
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True); ph = await ctx.new_page()
            await ph.goto('http://localhost:8765/'); await ph.wait_for_timeout(2500); await ph.click('#btnConnect'); await ph.wait_for_timeout(300); await shot(ph, 'phone-wifi-address')
            await ph.click('#cnWifi'); await ph.wait_for_timeout(6000); await shot(ph, 'phone-wifi-connected')
            await ctx.close()
        finally:
            fake.kill(); br.kill()
        # ---------- phone, Bluetooth (Android Chrome or iPhone Bluefy) ----------
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True, accept_downloads=True)
        await ctx.add_init_script('window.__bleCfg = {};'); await ctx.add_init_script(FAKE_BLE.replace('navigator.bluetooth = ', 'Object.defineProperty(navigator, "bluetooth", { configurable: true, value: ').replace('  return dev;\n} };', '  return dev;\n} } });'))
        ph = await ctx.new_page(); await ph.goto(URL); await ph.wait_for_timeout(2500)
        await ph.click('#btnConnect'); await shot(ph, 'phone-connect-chooser'); await ph.click('#cnBle'); await ph.wait_for_timeout(7000); await shot(ph, 'phone-bluetooth-connected')
        await ph.evaluate("location.hash='diagnose'"); await ph.wait_for_timeout(1500); await shot(ph, 'phone-diagnose')
        await ctx.close()
        # ---------- phone without Web Bluetooth (iPhone Chrome, Safari, Firefox) ----------
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ph = await ctx.new_page(); await ph.goto(URL); await ph.wait_for_timeout(5000); await shot(ph, 'phone-live-twin')
        await ph.click('#btnConnect'); await ph.click('#cnBle'); await ph.wait_for_timeout(500); await shot(ph, 'phone-no-web-bluetooth')
        await ctx.close(); await b.close()
asyncio.run(main())
