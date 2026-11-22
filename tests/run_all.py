"""Run every test suite and write reports/test-report.md and reports/test-report.html.

Usage: python tests/run_all.py     (env CHROME=/path/to/chrome optional; needs node and playwright)
"""
import subprocess, json, pathlib, datetime, os, re, sys, html, time
ROOT = pathlib.Path(__file__).resolve().parents[1]; REP = ROOT / 'reports'; REP.mkdir(exist_ok=True)
env = dict(os.environ, RESULTS_DIR=str(REP))

def node_suite(name, path):
    t0 = time.time(); p = subprocess.run(['node', path], cwd=ROOT, capture_output=True, text=True, timeout=900)
    rows = []
    for line in p.stdout.splitlines():
        m = re.match(r'^(ok|FAIL)\s+(.*)$', line)
        if m: rows.append({'check': m.group(2), 'pass': m.group(1) == 'ok', 'detail': ''})
        elif line.startswith('   ') and rows and not rows[-1]['pass']: rows[-1]['detail'] += line.strip() + ' '
    return {'suite': name, 'kind': 'Logic (Node)', 'rows': rows, 'secs': round(time.time() - t0), 'exit': p.returncode, 'notes': [l.strip() for l in p.stdout.splitlines() if l.startswith('    ') and not l.startswith('     ')]}

def browser_suite(name, script, out):
    t0 = time.time(); p = subprocess.run([sys.executable, script], cwd=ROOT, capture_output=True, text=True, timeout=1500, env=env)
    f = REP / out; rows = json.loads(f.read_text()) if f.exists() else []
    if not rows: rows = [{'check': 'Suite ran', 'pass': False, 'detail': (p.stdout + p.stderr)[-600:]}]
    notes = [l.strip() for l in p.stdout.splitlines() if l.startswith('     ')]
    return {'suite': name, 'kind': 'Browser (Chrome, headless)', 'rows': rows, 'secs': round(time.time() - t0), 'exit': p.returncode, 'notes': notes}

def ver(cmd):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception: return 'unknown'

suites = [node_suite('Protocol, twin, flash rehearsal, acceleration', 'tests/test.js'),
          node_suite('Diagnostic rules against simulated faults', 'tests/diagtest.js'),
          browser_suite('Whole app: twin, Bluetooth, WiFi bridge, exports', 'tests/browser/test_app.py', 'results-app.json'),
          browser_suite('Diagnose page: guided tests, alerts, locator', 'tests/browser/test_diagnose.py', 'results-diagnose.json')]
total = sum(len(s['rows']) for s in suites); passed = sum(sum(r['pass'] for r in s['rows']) for s in suites)
commit = ver(['git', '-C', str(ROOT), 'rev-parse', '--short', 'HEAD']); when = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
envs = [('Run', when), ('Commit', commit), ('Node', ver(['node', '-v'])), ('Chrome', ver([os.environ.get('CHROME') or 'google-chrome', '--version'])), ('Python', sys.version.split()[0])]
scope = ['Every test runs against the digital twin or against test adapters: a fake Bluetooth LE adapter and a fake WiFi adapter, each backed by a separate simulated bike.',
         'No test has run against a real OBD adapter, a real ECU or a real motorcycle.', 'Web Bluetooth on real phones and the iPhone Bluefy browser are not covered.']

md = ['# T120 Bench test report', '', f'**{passed} of {total} checks passed.**', '', '| | |', '|---|---|'] + [f'| {k} | {v} |' for k, v in envs] + ['', '## Scope', ''] + ['- ' + s for s in scope] + ['', '## Suites', '', '| Suite | Type | Passed | Time |', '|---|---|---|---|']
md += [f"| {s['suite']} | {s['kind']} | {sum(r['pass'] for r in s['rows'])} / {len(s['rows'])} | {s['secs']} s |" for s in suites]
for s in suites:
    md += ['', f"## {s['suite']}", '']
    if s['notes']: md += ['Measured during the run:', ''] + ['- ' + n for n in s['notes']] + ['']
    md += ['| Result | Check |', '|---|---|'] + [f"| {'PASS' if r['pass'] else 'FAIL'} | {r['check'].replace('|', '/')}{(' — ' + r['detail'].replace('|', '/')) if r['detail'] else ''} |" for r in s['rows']]
(REP / 'test-report.md').write_text('\n'.join(md) + '\n')

e = html.escape
h = ['<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T120 Bench test report</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#12181b}h1{margin-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0 18px}td,th{border-bottom:1px solid #d5dbd8;padding:6px 8px;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:#7c8588}.p{color:#006300;font-weight:600}.f{color:#a82424;font-weight:600}.big{font-size:28px;font-weight:700}.note{color:#4a5357}</style></head><body>',
     f'<h1>T120 Bench test report</h1><p class="big">{passed} of {total} checks passed</p><table>' + ''.join(f'<tr><th>{e(k)}</th><td>{e(v)}</td></tr>' for k, v in envs) + '</table>',
     '<h2>Scope</h2><ul>' + ''.join(f'<li>{e(s)}</li>' for s in scope) + '</ul>',
     '<h2>Suites</h2><table><tr><th>Suite</th><th>Type</th><th>Passed</th><th>Time</th></tr>' + ''.join(f"<tr><td>{e(s['suite'])}</td><td>{e(s['kind'])}</td><td>{sum(r['pass'] for r in s['rows'])} / {len(s['rows'])}</td><td>{s['secs']} s</td></tr>" for s in suites) + '</table>']
for s in suites:
    h.append(f"<h2>{e(s['suite'])}</h2>" + (('<p class="note">Measured during the run: ' + '; '.join(e(n) for n in s['notes']) + '</p>') if s['notes'] else '') + '<table><tr><th>Result</th><th>Check</th></tr>' + ''.join(f"<tr><td class=\"{'p' if r['pass'] else 'f'}\">{'PASS' if r['pass'] else 'FAIL'}</td><td>{e(r['check'])}{('<br><span class=note>' + e(r['detail']) + '</span>') if r['detail'] else ''}</td></tr>" for r in s['rows']) + '</table>')
(REP / 'test-report.html').write_text(''.join(h) + '</body></html>')
print(f'{passed}/{total} passed'); sys.exit(0 if passed == total else 1)
