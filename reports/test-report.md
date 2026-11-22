# T120 Bench test report

**187 of 187 checks passed.**

| | |
|---|---|
| Run | 2026-11-22 15:12 UTC |
| Commit | aeba590 |
| Node | v22.23.4 |
| Chrome | Google Chrome for Testing 153.0.8010.12 |
| Python | 3.13.18 |

## Scope

- Every test runs against the digital twin or against test adapters: a fake Bluetooth LE adapter and a fake WiFi adapter, each backed by a separate simulated bike.
- No test has run against a real OBD adapter, a real ECU or a real motorcycle.
- Web Bluetooth on real phones and the iPhone Bluefy browser are not covered.

## Suites

| Suite | Type | Passed | Time |
|---|---|---|---|
| Protocol, twin, flash rehearsal, acceleration | Logic (Node) | 20 / 20 | 2 s |
| Diagnostic rules against simulated faults | Logic (Node) | 27 / 27 | 5 s |
| Whole app: twin, Bluetooth, WiFi bridge, exports | Browser (Chrome, headless) | 110 / 110 | 238 s |
| Diagnose page: guided tests, alerts, locator | Browser (Chrome, headless) | 30 / 30 | 273 s |

## Protocol, twin, flash rehearsal, acceleration

Measured during the run:

- peak 104.5 Nm @ 3250, 79.4 PS @ 6500
- idle soak peak 103.0 °C, fan seen true
- top speed 175 km/h, ect 90
- twin 0-100 in 3.94 s
- max 128 km/h, ect max 89, stalls 0

| Result | Check |
|---|---|
| PASS | PID encode/decode round trips |
| PASS | DTC byte coding |
| PASS | parser handles spaces, noise, multi-frame and errors |
| PASS | image round trip and CRC tamper detection |
| PASS | engine model matches published T120 figures |
| PASS | baseline map passes validation; unsafe edits fail |
| PASS | twin starts, idles, warms up and cycles the fan |
| PASS | twin rides: accelerates, hits rev limiter, top speed plausible |
| PASS | closed loop trims out the fuel error at cruise |
| PASS | ELM client over twin transport: init, PIDs, VIN, DTC read and clear |
| PASS | client times out cleanly when the link drops a frame |
| PASS | client resyncs after a late reply instead of pairing answers with the wrong question |
| PASS | fast single-reply mode is used when the adapter supports it and skipped when it does not |
| PASS | acceleration timing from a whole-km/h speed signal |
| PASS | twin standing start is physically plausible |
| PASS | flash rehearsal: success changes twin behaviour |
| PASS | flash rehearsal: refuses with engine running or low battery, ECU untouched |
| PASS | flash rehearsal: link drop bricks the twin, backup recovers it |
| PASS | flash rehearsal: voltage sag mid-write is caught |
| PASS | ride scenario runs 5 minutes without stalling or overheating |

## Diagnostic rules against simulated faults

Measured during the run:

- end coolant 88 C, ltft 3.0

| Result | Check |
|---|---|
| PASS | every rule, test and part cites only known sources |
| PASS | DTC lookup: known, family-only and unknown codes |
| PASS | healthy twin: 20 minute ride from cold raises nothing |
| PASS | healthy twin: long warm idle raises nothing |
| PASS | healthy twin: key on, engine off for 2 minutes raises nothing |
| PASS | charging fault without a code is found |
| PASS | regulator overcharging is found and critical |
| PASS | weak battery found at rest |
| PASS | air leak found as lean trim |
| PASS | air leak causes idle hunting |
| PASS | thermostat stuck open found on a cruise |
| PASS | dead cooling fan found as overheating, warning first |
| PASS | dead cooling fan escalates to critical |
| PASS | lazy O2 sensor found |
| PASS | chafed harness voltage drop-outs found |
| PASS | coolant sensor open circuit found from data before the code |
| PASS | stored code becomes a finding and clears when the ECM clears it |
| PASS | O2 heater fault code also shows open-loop fault status |
| PASS | TB 222 code carries the calibration advice |
| PASS | MAP/baro mismatch at key on is found |
| PASS | user idle figure enables the idle-spec rule |
| PASS | engine starts, stops and rev changes are not counted as drop-outs |
| PASS | findings resolve when the fault goes away |
| PASS | test: key-on analyser passes healthy and flags weak battery and MAP gap |
| PASS | test: cranking analyser uses the 9.6 V limit |
| PASS | test: grip sweep finds drop-outs and a stuck grip |
| PASS | test results become findings with evidence |

## Whole app: twin, Bluetooth, WiFi bridge, exports

Measured during the run:

- wifi speed samples/s through local bridge: 42.3

| Result | Check |
|---|---|
| PASS | BLE: connects and switches to live ECU |
| PASS | BLE: requested the serial-style services |
| PASS | BLE: writes chunked to 20 bytes or less |
| PASS | BLE: VIN read from the bike over multi-frame reply |
| PASS | BLE: protocol and adapter identified |
| PASS | BLE: fast single-reply mode negotiated |
| PASS | BLE: handled SEARCHING... noise on first query |
| PASS | BLE: live rpm, coolant, battery match the bike |
| PASS | BLE: simulated banner hidden, chip says Live ECU |
| PASS | BLE: twin controls hidden |
| PASS | BLE: no twin-model channel in live data |
| PASS | BLE: twin-only tiles show as unavailable |
| PASS | BLE: PID tiles show values |
| PASS | BLE systems: unpublished rows labelled, none carry a value |
| PASS | BLE systems: published rows carry values |
| PASS | BLE faults: code set on bike is read and MIL shown |
| PASS | BLE faults: code described in list |
| PASS | BLE faults: no twin fault-injection buttons on a real ECU |
| PASS | BLE faults: clear blocked while engine runs |
| PASS | BLE faults: confirmation names the real ECU |
| PASS | BLE faults: clear reaches the bike |
| PASS | BLE faults: PID grid shows 19 data PIDs plus 2 range markers |
| PASS | BLE write lab: rehearsal ran on the twin only, bike flash untouched |
| PASS | BLE write lab: real write shown as locked |
| PASS | BLE report: CSV not stamped simulated, rows tagged ECU |
| PASS | BLE report: CSV has no twin-model columns |
| PASS | BLE report: subtitle says live ECU with VIN |
| PASS | BLE report: HTML report has no simulated banner |
| PASS | BLE: unplug falls back to twin with banner |
| PASS | BLE: unplug logged as event |
| PASS | BLE: twin polling resumed after unplug |
| PASS | BLE cancel: chooser dismissed quietly, twin keeps running |
| PASS | BLE wrong device: clear error, twin keeps running |
| PASS | BLE ignition off: says ECU did not answer |
| PASS | BLE ignition off: twin polling resumed, single loop |
| PASS | BLE slow link, 7-byte fragments: connects and reads correctly |
| PASS | BLE adapter without fast mode: falls back and still reads |
| PASS | BLE goes silent: link-lost message and fallback to twin |
| PASS | No Web Bluetooth: guidance shown instead of failing |
| PASS | Live: tach text tracks rpm, all 16 tiles populated |
| PASS | Live: four charts drawn with data |
| PASS | Live: legends list every series with a value |
| PASS | Twin controls: manual neutral idle near 1000 rpm |
| PASS | Twin controls: ignition off stops engine and ECU goes silent |
| PASS | Twin controls: restart works |
| PASS | Systems: 37 channels, 4 marked not published, rest have values, flow filled, 14 tagged twin model |
| PASS | Systems: sparklines drawn |
| PASS | Maps: shift-click selects a 3x4 block |
| PASS | Maps: fuel edit applied to selection only |
| PASS | Maps: set value |
| PASS | Maps: change view shows signed deltas |
| PASS | Maps: revert selection restores baseline |
| PASS | Maps: lean full-throttle row fails safety checks |
| PASS | Write lab: unsafe map blocks the rehearsal |
| PASS | Maps: non-monotonic throttle curve fails |
| PASS | Maps: rev limit 7600 fails |
| PASS | Maps: mild edit passes, dyno recomputed |
| PASS | Maps: export stamped simulated with origin note |
| PASS | Maps: import round trip restores the edit |
| PASS | Maps: bad file rejected with message |
| PASS | Maps: dyno charts drawn |
| PASS | Write lab: battery sag fails the write and corrupts twin |
| PASS | Write lab: corrupt twin will not start, rehearse disabled |
| PASS | Write lab: recovery restores baseline calibration |
| PASS | Write lab: clean write verified, 64 blocks, counter 1 |
| PASS | Write lab: twin now idles at the written 1150 rpm |
| PASS | Write lab: twin now cuts at the written 6500 rpm limit |
| PASS | Faults: all four injected codes read back |
| PASS | Faults: sensor effects visible in live data |
| PASS | Faults: cleared after faults removed and engine stopped |
| PASS | Faults: ECU info filled |
| PASS | Report: summary tiles filled |
| PASS | Report: statistics for every logged channel, min <= avg <= max |
| PASS | Report: events include flash, faults and clear |
| PASS | Report CSV: stamped, rectangular, row count matches log |
| PASS | Report CSV: peak rpm equals summary peak |
| PASS | Report JSON: parses, flagged simulated, carries log, map, validation, events |
| PASS | Report HTML: banner, tables and charts present |
| PASS | Report HTML: opens standalone and renders |
| PASS | Report print: only the report and banner are visible |
| PASS | Report: new session clears log and events |
| PASS | Embedded preview: export falls back to copy box with content |
| PASS | Accel: focus polling gives 8 or more speed samples per second on the twin |
| PASS | Accel: launch button locks while running |
| PASS | Accel: simulated launch completes and four runs are timed |
| PASS | Accel: 0-60 matches the twin ground truth |
| PASS | Accel: 0-100 matches the twin ground truth |
| PASS | Accel: 60-100 roll-on matches ground truth |
| PASS | Accel: 80-120 roll-on matches ground truth |
| PASS | Accel: peak g plausible and below the twin traction cap |
| PASS | Accel: table and history show the runs, marked simulated |
| PASS | Accel: charts drawn |
| PASS | Accel: runs logged as events |
| PASS | Accel: session JSON carries runs with timing uncertainty |
| PASS | Accel: HTML report lists the runs |
| PASS | Accel: reset clears results |
| PASS | WiFi: bridge serves the app |
| PASS | WiFi: bridge address prefilled from the page origin |
| PASS | WiFi: connects through the bridge to the TCP adapter |
| PASS | WiFi: labelled Live ECU · WiFi, banner hidden, fast mode on |
| PASS | WiFi: acceleration page samples speed from the real link |
| PASS | WiFi: ECU info names the WiFi bridge |
| PASS | WiFi: second page told the adapter is in use |
| PASS | WiFi: page from another origin is refused by the bridge |
| PASS | WiFi: adapter dropping out falls back to twin with a reason |
| PASS | WiFi: adapter unreachable gives a clear message |
| PASS | WiFi bridge log: shows link, refusal and end of session |
| PASS | Phone 390px, dark theme: no sideways page scroll on any section |
| PASS | Dark theme: palette applied |
| PASS | No JavaScript errors in any scenario |

## Diagnose page: guided tests, alerts, locator

| Result | Check |
|---|---|
| PASS | Diagnose: page renders with no findings on a healthy twin |
| PASS | Diagnose: reference table lists Triumph figures with sources |
| PASS | Diagnose: unavailable OEM values are listed, not invented |
| PASS | Diagnose: coverage shows every check runnable on the twin |
| PASS | Diagnose: drawing has pins only for sourced parts |
| PASS | Test koeo: completes and passes on a healthy twin |
| PASS | Test crank: completes and passes on a healthy twin |
| PASS | Test charge: completes and passes on a healthy twin |
| PASS | Test idle: completes and passes on a healthy twin |
| PASS | Test grip: completes and passes on a healthy twin |
| PASS | Tests: healthy runs raised no findings |
| PASS | Fault weak battery: crank test fails on the 9.6 V limit |
| PASS | Fault weak battery: finding has evidence, fix, battery location and sources |
| PASS | Fault grip drop-outs: sweep test catches them |
| PASS | Fault overcharging: charge test fails high |
| PASS | Alert: header chip shows the critical issue |
| PASS | Alert: events log the issue as simulated |
| PASS | Locator: showing a finding lights its parts on the drawing |
| PASS | Locator: text says where the regulator is and cites the source |
| PASS | Finding: cause lines carry source badges |
| PASS | Locator: a part with no sourced position says so and points to the manual |
| PASS | Your manual values: idle figure checked and labelled as yours |
| PASS | Your manual values: idle finding cites your manual |
| PASS | Export: diagnostic report stamped simulated with findings and links |
| PASS | Export: session JSON carries diagnosis with parts and sources |
| PASS | Live ECU: coolant sensor fault found from data and code, labelled Live ECU |
| PASS | Live ECU: twin simulator hidden, header reads live |
| PASS | Live ECU: overcharging on the bike raises a critical finding |
| PASS | Phone: no sideways scroll on Diagnose with a finding open |
| PASS | No JavaScript errors |
