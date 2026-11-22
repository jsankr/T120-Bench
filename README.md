# T120 Bench

A browser tool for the 2018 Triumph Bonneville T120 (liquid-cooled). It reads live engine data from an OBD-II adapter, diagnoses faults with sourced checks, times acceleration, and rehearses ECU writes on a digital twin before anything touches the bike.

Open it: **https://jsankr.github.io/t120-bench/**

> **Simulated data is labelled.** Until an adapter is connected, everything you see comes from a digital twin model, and an amber "SIMULATED DATA" strip sits at the top. The strip disappears only when a real ECU answers.

## What it does

| Section | What you get |
|---|---|
| Live | Tachometer, 16 live tiles, 90-second charts |
| Diagnose | Continuous checks, five guided tests, alerts, fix steps, part locations on a schematic, every claim tagged with its source |
| Accel | 0–60, 0–100, 60–100 and 80–120 km/h timing from the road-speed signal, with timing uncertainty shown |
| Systems | Every channel by system; which come from the ECU and which only exist in the twin |
| Maps | Fuel, ignition, throttle and limit tables of the twin, safety checks, virtual dyno |
| Write lab | Backup, checks, pre-flight and a full write rehearsal on the twin, including link-drop and low-voltage failures and recovery |
| Faults | Read and clear fault codes, ECU and adapter details |
| Report | CSV, JSON and HTML exports |

## What it does not do

- **It does not write maps to a real ECU.** The T120 Keihin flash protocol is proprietary and not implemented here; real writes are limited to clearing fault codes.
- **The map tables are a model, not Triumph calibration data.**
- **Some Triumph values are not in the app** (idle speed, fuel pressure, fan switch-on temperature, sensor resistances). The Diagnose page lists the service manual pages to check, and lets you enter your own figures.
- Only data the ECU publishes over standard OBD-II is shown live. Channels it does not publish are marked, never filled in.

## Connecting

| Device | Bluetooth LE adapter | WiFi adapter |
|---|---|---|
| Android, Windows, macOS, ChromeOS (Chrome or Edge) | Yes | Through the bridge |
| iPhone / iPad, Safari, Chrome or Firefox | No (Apple's engine has no Web Bluetooth) | Through the bridge on a laptop |
| iPhone / iPad, Bluefy browser | Yes | Through the bridge |

Classic Bluetooth adapters cannot be reached from a browser; it must be a BLE type.

### WiFi adapters

Browsers cannot open the raw TCP connection WiFi adapters use, so a small relay runs on a laptop:

```bash
node tools/t120-wifi-bridge.js            # this computer only
node tools/t120-wifi-bridge.js --lan      # also phones on the same network
node tools/t120-wifi-bridge.js --adapter 192.168.0.10:35000 --port 8765
```

Join the laptop to the adapter's WiFi network, run the bridge, open `http://localhost:8765/` (or `http://<laptop IP>:8765/` from a phone), choose **Connect → WiFi**. Node 16 or newer, no dependencies. The bridge only accepts the page it serves unless you add `--allow-origin https://jsankr.github.io`.

## Sources

Diagnostic checks use Triumph's owner's handbook and technical bulletins (public NHTSA copies), page references from the 2016 service manual, accessory maker install guides, and general OBD and battery references. Each finding names its sources and their type. Where no Triumph figure was available, the threshold is marked as an app rule.

## Build and test

`index.html` is a single self-contained file built from `src/`.

```bash
node src/build.js         # rebuilds index.html
node tests/test.js        # protocol, twin, flash rehearsal, acceleration (20 tests)
node tests/diagtest.js    # diagnostic rules against simulated faults (27 tests)
```

Not yet tested against a real adapter or motorcycle.

## Safety

Diagnostic output is guidance, not a workshop verdict. Confirm values against your own service manual before repair, and stop riding if the app or the instruments show a critical warning.

## Licence

MIT, see [LICENSE](LICENSE).
