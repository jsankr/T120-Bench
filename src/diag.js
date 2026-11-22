/* T120 Bench diagnostics: sourced reference data, rules over live OBD data, guided tests.
   Pure logic, no DOM. Works in the browser (window.T120D) and in Node (module.exports).
   Every threshold names where it came from. Where no Triumph figure was available to the app,
   the threshold is marked as an app rule and the matching service-manual page is given to check. */
(function (root) {
  'use strict';

  /* ---------------- Sources ---------------- */
  const TIER = {
    triumph: 'Triumph document', manual: 'Your service manual (page from your index)', install: 'Accessory maker install guide',
    forum: 'Owner forum', standard: 'Industry reference', app: 'App rule'
  };
  const SOURCES = {
    handbook: { tier: 'triumph', title: 'Triumph Owner’s Handbook 3855663-EN, issue 1, Aug 2019 (Bonneville T100/T120)', url: 'https://api.triumphtechnicalinformation.com/handbooks/documents/6246e0045b05bf5ce5071ffc/pdf', note: 'Later than model year 2018. Confirm against the handbook supplied with your bike.' },
    tb168: { tier: 'triumph', title: 'Triumph Technical Bulletin 168 (05.2016): 168.2 Adaptive Fuel System, 168.16 Cooling Fan Fuse Kit', url: 'https://static.nhtsa.gov/odi/inv/2021/INRD-PE21017-10453P5.pdf', note: 'Copy published by NHTSA.' },
    tb205: { tier: 'triumph', title: 'Triumph Technical Bulletin 205 (02.2020): 205.1 Adaption Processes', url: 'https://static.nhtsa.gov/odi/tsbs/2020/MC-10173764-9999.pdf', note: 'Copy published by NHTSA. Lists the Bonneville T120.' },
    tb222: { tier: 'triumph', title: 'Triumph Technical Bulletin 222: 222.3 Misdetection of DTCs', url: 'https://static.nhtsa.gov/odi/tsbs/2022/MC-10207933-9999.pdf', note: 'Copy published by NHTSA. Lists the Bonneville T120.' },
    tol2016: { tier: 'triumph', title: 'Triumph TOL notice, 23 Nov 2016: New Bonneville oxygen sensor claims', url: 'https://static.nhtsa.gov/odi/tsbs/2016/MC-10122037-9999.pdf', note: 'US/Canada dealer notice. Lists Bonneville T100/T120.' },
    recall19v133: { tier: 'triumph', title: 'NHTSA recall 19V-133 / Triumph Safety Recall 560: clutch cable can damage main harness', url: 'https://static.nhtsa.gov/odi/rcl/2019/RCAK-19V133-9937.pdf', note: 'US campaign for 2016–2019 T120. Ask an Indian Triumph dealer whether your VIN is covered and done.' },
    recall627: { tier: 'triumph', title: 'Triumph Safety Recall Action Notice 627 (10/2024): alternator connector wire alignment clip', url: 'https://static.nhtsa.gov/odi/rcl/2024/RCSB-24V785-9915.pdf', note: 'Covers later VINs (T120 from AC6130), not a 2018 bike. Used here only for where the connector sits on this chassis family.' },
    recallGrips: { tier: 'triumph', title: 'US recall: 2016–2017 T120 heated grips may expand and hold the throttle open', url: 'https://www.motorcyclistonline.com/triumph-recalls-2016-2017-bonneville-t120-for-sticking-throttle-issue', note: 'Press report of a US recall. Model years 2016–2017.' },
    serviceManual: { tier: 'manual', title: 'Triumph Bonneville T120 Service Manual, 04.2016 issue 1 (your copy)', url: 'https://www.ifixit.com/Document/MTKPyTmGPKUElr4I/Triumph-Bonneville-T120-en-01.pdf', note: 'Page numbers come from the page index in your T120 workshop project. The app has not read these pages, so it quotes no values from them. 2016 edition: confirm for a 2018 VIN.' },
    repoPhotos: { tier: 'manual', title: 'Your T120 workshop project, photo map (parts placed by eye on openly licensed T120 photographs)', url: 'https://github.com/jsankr/TriumphBonnevilleT120', note: 'Approximate positions on real photographs, not measured, and not your motorcycle.' },
    repoFuses: { tier: 'manual', title: 'Your T120 workshop project, electrical reference (fuse list from service manual p.671)', url: 'https://github.com/jsankr/TriumphBonnevilleT120', note: '2016 manual values. Check the label on your fuse box cover.' },
    dynojet: { tier: 'install', title: 'Dynojet Power Commander 6 install guide, 2016–2020 Triumph T120', url: 'https://fortnine.ca/assets/pdf/dynojet/226801.pdf', note: 'Accessory maker, not Triumph. Describes connector positions on the stock bike.' },
    blRegrec: { tier: 'install', title: 'British Legends regulator/rectifier relocation kit (T120 2016+)', url: 'https://www.britishlegends.fr/en/go/product/99776301', note: 'Accessory maker. States the stock position.' },
    deusRegrec: { tier: 'install', title: 'Deus Ex Machina / Baak regulator bracket, Triumph liquid-cooled twins', url: 'https://deuscustoms.com.au/products/baak-regulator-rectifier-bracket-triumph-lc', note: 'Accessory maker. States the stock position.' },
    yuasa: { tier: 'standard', title: 'Yuasa Europe: testing motorcycle batteries', url: 'https://www.yuasaeurope.com/info/motorcycle-and-powersport/installation-testing-and-maintenance/', note: 'Battery maker. The handbook lists a YTX12-BS (Yuasa AGM type).' },
    yuasaUS: { tier: 'standard', title: 'Yuasa: battery maintenance and storage', url: 'https://www.yuasabatteries.com/resources/battery-maintenance-storage/', note: 'Battery maker.' },
    crankTest: { tier: 'standard', title: 'RevZilla Common Tread: how to test a motorcycle battery', url: 'https://www.revzilla.com/common-tread/how-to-test-a-motorcycle-battery', note: 'General motorcycle practice, not a Triumph figure.' },
    mcn: { tier: 'standard', title: 'MCN: solve your battery charging woes', url: 'https://www.pressreader.com/uk/mcn-uk/20200527/285151475659956', note: 'General motorcycle practice, not a Triumph figure.' },
    motofomo: { tier: 'standard', title: 'MotoFOMO: how to test a motorcycle charging system', url: 'https://motofomo.com/test-motorcycle-charging-system/', note: 'General motorcycle practice, not a Triumph figure.' },
    p0069: { tier: 'standard', title: 'P0069: MAP and barometric pressure must match with key on, engine off', url: 'https://www.go-parts.com/garage/obd-p0069', note: 'General OBD-II practice.' },
    fuelTrim: { tier: 'standard', title: 'ASE L1 study guide: fuel trim and oxygen sensors', url: 'https://open-exam-prep.com/study-guides/ase-l1/computerized-controls/fuel-trim-o2', note: 'General OBD-II practice, written for cars.' },
    obd: { tier: 'standard', title: 'OBD-II PIDs and generic trouble code definitions (SAE J1979 / J2012)', url: 'https://en.wikipedia.org/wiki/OBD-II_PIDs', note: 'Generic meanings. Triumph may use a code differently; the service manual DTC table (p.301–306) is the authority.' },
    forumO2: { tier: 'forum', title: 'Hitchcocks Bonneville forum: lambda sensor on the header; EFI needs a good battery', url: 'https://messageboard.hitchcocksmotorcycles.com/viewtopic.php?p=7547', note: 'Owner forum, not verified.' },
    app: { tier: 'app', title: 'T120 Bench rule', url: null, note: 'Threshold chosen by this app because no Triumph figure was available to it. Check against your service manual.' }
  };

  /* ---------------- Reference values Triumph publishes (used by rules and shown on screen) ---------------- */
  const REF = [
    { k: 'Battery', v: 'YTX12-BS, 12 V 10 Ah', src: 'handbook', page: 'p.163' },
    { k: 'Alternator output', v: '25 A at 1,000 rpm; 46.5 A at 3,000 rpm', src: 'handbook', page: 'p.163' },
    { k: 'Thermostat opens', v: '88 °C ± 2 °C', src: 'handbook', page: 'p.161–162' },
    { k: 'Normal operating temperature (liquid-cooled)', v: '90 °C', src: 'tb205', page: 'item 205.1' },
    { k: 'Coolant', v: 'Triumph HD4X Hybrid OAT, 1.558 L (T120)', src: 'handbook', page: 'p.161–162' },
    { k: 'Spark plug', v: 'NGK LMAR8A-9, gap 0.9 mm +0.0/−0.1', src: 'handbook', page: 'p.162' },
    { k: 'Fuel', v: '91 RON unleaded minimum', src: 'handbook', page: 'p.162' },
    { k: 'Cooling fan fuse', v: '15 A (raised from 10 A)', src: 'tb168', page: 'item 168.16' },
    { k: 'Engine management fuse', v: 'Fuse 4, 15 A', src: 'repoFuses', page: 'manual p.671' },
    { k: 'Ignition switch / starting fuse', v: 'Fuse 2, 10 A', src: 'repoFuses', page: 'manual p.671' },
    { k: 'Fuel adaption', v: 'Not possible while an engine DTC is present; idle adaption about 12 min after reaching temperature', src: 'tb168', page: 'item 168.2' }
  ];
  const NOT_AVAILABLE = [
    { k: 'Idle speed', page: 'service manual p.296 (idle speed and throttle data) and specifications p.46–48' },
    { k: 'Fuel pressure', page: 'service manual p.386–387 (needs gauge T3880001)' },
    { k: 'Cooling fan switch-on temperature', page: 'service manual p.455–471 and p.330' },
    { k: 'Charging voltage limits', page: 'service manual p.676–677 and p.712' },
    { k: 'Sensor resistances and voltages', page: 'service manual p.295 and the fault-code tables p.310–382' }
  ];

  /* ---------------- Where parts are ----------------
     pin: position on the app's own schematic (right-side view, 1000 x 480). null when no source places it. */
  const PARTS = {
    battery: { name: 'Battery', where: 'Under the seat. The USB socket sits on top of it.', access: 'Remove the seat.', pin: [360, 200], src: ['handbook'], conf: 'high', page: 'handbook p.16, p.72, p.76' },
    fusebox: { name: 'Fuse box', where: 'Under the seat (handbook says “on certain models”).', access: 'Remove the seat.', pin: [300, 200], src: ['handbook', 'repoFuses'], conf: 'medium', page: 'manual p.671' },
    regrec: { name: 'Regulator/rectifier', where: 'At the front, on the fork below the headlight (lower yoke area).', access: 'Visible from the front under the headlight.', pin: [738, 212], src: ['blRegrec', 'deusRegrec'], conf: 'medium', page: 'manual p.706, tests p.712–713' },
    alternator: { name: 'Alternator stator and its connector', where: 'Stator inside the engine. Its harness connector is clipped to the relay bracket on the right, behind the side panel near the rear brake fluid reservoir.', access: 'Battery, right side panel and rear brake reservoir fixing out to reach the connector.', pin: [384, 276], src: ['recall627', 'serviceManual'], conf: 'medium', page: 'manual p.702–703, tests p.708–709' },
    relayBracket: { name: 'Relay bracket', where: 'Right side, behind the side panel, next to the rear brake fluid reservoir. The gear position sensor connector attaches to it.', access: 'Seat, right side panel, then the rear brake reservoir fixing.', pin: [396, 258], src: ['recall627', 'serviceManual'], conf: 'medium', page: 'manual p.423; relay positions p.287' },
    crankConn: { name: 'Crankshaft position sensor connector', where: 'Right side, a 2-pin black connector behind the rear brake master cylinder reservoir.', access: 'Seat and right side panel off; loosening the reservoir bolt makes it easier to reach.', pin: [408, 292], src: ['dynojet'], conf: 'high', page: 'manual p.424–425 (sensor), p.310 (codes)' },
    tps: { name: 'Throttle position sensor', where: 'Grey 4-pin connector at the bottom of the throttle bodies, under the fuel tank.', access: 'Seat, fuel tank and side panels off.', pin: [430, 252], src: ['dynojet'], conf: 'high', page: 'manual p.426, p.314 (codes)' },
    injectors: { name: 'Fuel injectors', where: 'On the throttle bodies under the fuel tank; their connectors are under a rubber boot.', access: 'Seat, fuel tank and side panels off.', pin: [448, 226], src: ['dynojet'], conf: 'high', page: 'manual p.433–434, p.312 (codes)' },
    throttle: { name: 'Throttle bodies and actuator', where: 'Under the fuel tank, between the airbox and the cylinder head.', access: 'Seat, fuel tank and side panels off.', pin: [428, 234], src: ['dynojet', 'serviceManual'], conf: 'medium', page: 'manual p.427–431, p.364 (actuator codes)' },
    twistGrip: { name: 'Twist grip sensor', where: 'In the right-hand twist grip. Its connector is on the back of the harness bracket at the headlight.', access: 'Headlight unit out to reach the harness bracket.', pin: [738, 80], src: ['serviceManual'], conf: 'medium', page: 'manual p.410–414, codes p.358–362' },
    o2: { name: 'Oxygen sensors (left and right)', where: 'One in each exhaust header pipe. The left sensor must plug into the left harness connector and the right into the right.', access: 'Reachable on the headers; trace each lead back to its connector.', pin: [652, 332], src: ['tol2016', 'forumO2'], conf: 'medium', page: 'manual p.332, p.334 (heater), p.376 (reversed connection)' },
    radiator: { name: 'Radiator and cooling fan', where: 'In front of the engine, behind the front wheel.', access: 'Fan visible behind the radiator.', pin: [672, 270], src: ['repoPhotos', 'serviceManual'], conf: 'medium', page: 'manual p.457–460, fan relay codes p.330' },
    coolantCap: { name: 'Coolant pressure cap and expansion tank', where: 'Pressure cap under the fuel tank. Check the level in the expansion tank only when the engine is cold.', access: 'Fuel tank off for the pressure cap.', pin: [600, 178], src: ['handbook'], conf: 'medium', page: 'handbook p.16–17, p.78; manual p.461–462' },
    coolantSensor: { name: 'Coolant temperature sensor', where: 'Its connector is clipped to the ignition coils bracket. The sensor position is shown on the manual’s sensor-location page.', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.285, p.416, p.700; codes p.320' },
    thermostat: { name: 'Thermostat', where: 'Shown in the manual’s cooling chapter.', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.469–471' },
    iat: { name: 'Intake air temperature sensor', where: 'Shown on the manual’s sensor-location page.', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.285, p.415; codes p.324' },
    mapSensor: { name: 'Manifold pressure (MAP) sensor', where: 'Shown on the manual’s sensor-location page.', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.285, p.417; codes p.346' },
    baroSensor: { name: 'Ambient air pressure sensor', where: 'Shown on the manual’s sensor-location page.', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.285, p.418–419; codes p.344' },
    fuelPump: { name: 'Fuel pump and its relay', where: 'Pump inside the fuel tank on its mounting plate. Relay position is on the manual’s actuator page.', access: 'Fuel tank off and pump plate out (fuel handling precautions apply).', pin: [505, 168], src: ['serviceManual'], conf: 'medium', page: 'manual p.388–394, relay codes p.326, relays p.287' },
    harness: { name: 'Main harness near the clutch cable', where: 'Where the clutch cable runs past the main harness cover.', access: 'Dealer inspection under the recall procedure.', pin: null, src: ['recall19v133'], conf: 'medium', page: 'US recall 19V-133' },
    ecm: { name: 'Engine control module', where: 'Shown on the manual’s component-location page.', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.289, pinout p.292' },
    coils: { name: 'Ignition coils', where: 'On the ignition coils bracket (the coolant sensor connector also clips here).', access: 'See the manual.', pin: null, src: ['serviceManual'], conf: 'low', page: 'manual p.700–701, codes p.318' },
    gearSensor: { name: 'Gear position sensor', where: 'Its connector attaches to the relay bracket on the right.', access: 'As for the relay bracket.', pin: null, src: ['serviceManual'], conf: 'medium', page: 'manual p.422–423, codes p.348' }
  };

  /* ---------------- Fault codes ----------------
     Generic SAE meanings for the codes below, mapped to the T120 manual pages that cover each component. */
  const SYS = {
    o2h: { name: 'Oxygen sensor heater', parts: ['o2'], pages: '334' }, map: { name: 'MAP sensor', parts: ['mapSensor'], pages: '346, 417' },
    iat: { name: 'Intake air temperature sensor', parts: ['iat'], pages: '324, 415' }, ect: { name: 'Coolant temperature sensor', parts: ['coolantSensor'], pages: '320, 416, 700' },
    thermo: { name: 'Thermostat / warm-up', parts: ['thermostat', 'coolantSensor'], pages: '469–471' }, tps: { name: 'Throttle position sensor', parts: ['tps', 'throttle'], pages: '314, 426' },
    o2: { name: 'Oxygen sensor', parts: ['o2'], pages: '332, 376' }, trim: { name: 'Fuel mixture control', parts: ['throttle', 'injectors', 'fuelPump', 'o2'], pages: '386–387, 435' },
    inj: { name: 'Fuel injector', parts: ['injectors'], pages: '312, 433–434' }, pump: { name: 'Fuel pump relay / circuit', parts: ['fuelPump'], pages: '326, 393–394' },
    misfire: { name: 'Misfire', parts: ['coils', 'injectors'], pages: '318' }, crank: { name: 'Crankshaft position sensor', parts: ['crankConn'], pages: '310, 424–425' },
    coil: { name: 'Ignition coil', parts: ['coils'], pages: '318, 700–701' }, purge: { name: 'Purge valve (some markets)', parts: [], pages: '316, 447–448' },
    level: { name: 'Fuel level sensor', parts: ['fuelPump'], pages: '350, 396' }, fan: { name: 'Cooling fan relay', parts: ['radiator', 'fusebox'], pages: '330' },
    vss: { name: 'Vehicle speed sensor', parts: [], pages: '382' }, idle: { name: 'Idle air control (throttle actuator)', parts: ['throttle'], pages: '364' },
    volt: { name: 'System voltage', parts: ['battery', 'regrec', 'alternator'], pages: '328, 676–677' }, brake: { name: 'Brake switch', parts: [], pages: '370' },
    ecm: { name: 'Engine control module', parts: ['ecm'], pages: '289' }, start: { name: 'Starter relay', parts: ['relayBracket'], pages: '336, 672–674' },
    v5: { name: '5 V sensor supply', parts: ['ecm'], pages: '356' }, relay: { name: 'EMS main relay', parts: ['relayBracket'], pages: '352' },
    gear: { name: 'Gear position sensor', parts: ['gearSensor'], pages: '348, 422–423' }, act: { name: 'Throttle actuator motor', parts: ['throttle'], pages: '364' },
    grip: { name: 'Twist grip position sensor', parts: ['twistGrip'], pages: '358–362, 410–414' }, baro: { name: 'Ambient air pressure sensor', parts: ['baroSensor'], pages: '344, 418' },
    can: { name: 'CAN communication', parts: ['ecm'], pages: '340, 342' }, abs: { name: 'ABS modulator communication', parts: [], pages: '368' }
  };
  const DTC = {
    P0030: ['o2h', 'O2 sensor heater control circuit (bank 1 sensor 1)'], P0031: ['o2h', 'O2 sensor heater circuit low (bank 1 sensor 1)'], P0032: ['o2h', 'O2 sensor heater circuit high (bank 1 sensor 1)'],
    P0050: ['o2h', 'O2 sensor heater control circuit (bank 2 sensor 1)'], P0051: ['o2h', 'O2 sensor heater circuit low (bank 2 sensor 1)'], P0052: ['o2h', 'O2 sensor heater circuit high (bank 2 sensor 1)'],
    P0053: ['o2h', 'Oxygen sensor heater resistance, bank 1 sensor 1', 'tb222'],
    P0105: ['map', 'MAP sensor circuit'], P0106: ['map', 'MAP sensor range/performance'], P0107: ['map', 'MAP sensor circuit low'], P0108: ['map', 'MAP sensor circuit high'],
    P0110: ['iat', 'Intake air temperature sensor circuit'], P0112: ['iat', 'Intake air temperature sensor circuit low'], P0113: ['iat', 'Intake air temperature sensor circuit high'],
    P0115: ['ect', 'Coolant temperature sensor circuit'], P0116: ['ect', 'Coolant temperature sensor range/performance'], P0117: ['ect', 'Coolant temperature sensor circuit low'], P0118: ['ect', 'Coolant temperature sensor circuit high'],
    P011B: ['ect', 'Coolant temperature sensor correlation with intake air temperature sensor', 'tb222'], P050C: ['ect', 'Coolant temperature sensor signal high, too warm for cold-start conditions', 'tb222'],
    P0125: ['thermo', 'Coolant temperature too low for closed-loop fuel control'], P0128: ['thermo', 'Coolant temperature below thermostat regulating temperature'],
    P0120: ['tps', 'Throttle position sensor A circuit'], P0121: ['tps', 'Throttle position sensor A range/performance'], P0122: ['tps', 'Throttle position sensor A circuit low'], P0123: ['tps', 'Throttle position sensor A circuit high'],
    P0220: ['tps', 'Throttle position sensor B circuit'], P0222: ['tps', 'Throttle position sensor B circuit low'], P0223: ['tps', 'Throttle position sensor B circuit high'], P2135: ['tps', 'Throttle position sensor A/B voltage correlation'],
    P0130: ['o2', 'O2 sensor circuit (bank 1 sensor 1)'], P0131: ['o2', 'O2 sensor circuit low (bank 1 sensor 1)'], P0132: ['o2', 'O2 sensor circuit high (bank 1 sensor 1)'], P0133: ['o2', 'O2 sensor slow response (bank 1 sensor 1)'], P0134: ['o2', 'O2 sensor no activity (bank 1 sensor 1)'],
    P0150: ['o2', 'O2 sensor circuit (bank 2 sensor 1)'], P0151: ['o2', 'O2 sensor circuit low (bank 2 sensor 1)'], P0152: ['o2', 'O2 sensor circuit high (bank 2 sensor 1)'], P0153: ['o2', 'O2 sensor slow response (bank 2 sensor 1)'], P0154: ['o2', 'O2 sensor no activity (bank 2 sensor 1)'],
    P0135: ['o2h', 'O2 sensor heater circuit (bank 1 sensor 1)'], P0155: ['o2h', 'O2 sensor heater circuit (bank 2 sensor 1)'],
    P0170: ['trim', 'Fuel trim (bank 1)'], P0171: ['trim', 'System too lean (bank 1)'], P0172: ['trim', 'System too rich (bank 1)'], P0174: ['trim', 'System too lean (bank 2)'], P0175: ['trim', 'System too rich (bank 2)'],
    P0201: ['inj', 'Injector circuit, cylinder 1'], P0202: ['inj', 'Injector circuit, cylinder 2'], P0230: ['pump', 'Fuel pump primary circuit'], P0231: ['pump', 'Fuel pump secondary circuit low'], P0232: ['pump', 'Fuel pump secondary circuit high'],
    P0300: ['misfire', 'Random or multiple cylinder misfire'], P0301: ['misfire', 'Cylinder 1 misfire'], P0302: ['misfire', 'Cylinder 2 misfire'],
    P0315: ['crank', 'Crankshaft position system variation not learned. Triumph stores this after an adaption reset until the crankshaft position re-adapts.', 'tb205'],
    P0335: ['crank', 'Crankshaft position sensor circuit'], P0336: ['crank', 'Crankshaft position sensor range/performance'], P0337: ['crank', 'Crankshaft position sensor circuit low'], P0338: ['crank', 'Crankshaft position sensor circuit high'], P0339: ['crank', 'Crankshaft position sensor intermittent'],
    P0351: ['coil', 'Ignition coil A primary/secondary circuit'], P0352: ['coil', 'Ignition coil B primary/secondary circuit'],
    P0443: ['purge', 'Evaporative purge valve circuit'], P0444: ['purge', 'Evaporative purge valve circuit open'], P0445: ['purge', 'Evaporative purge valve circuit shorted'],
    P0460: ['level', 'Fuel level sensor circuit'], P0462: ['level', 'Fuel level sensor circuit low'], P0463: ['level', 'Fuel level sensor circuit high'],
    P0480: ['fan', 'Cooling fan 1 control circuit'], P0691: ['fan', 'Cooling fan 1 control circuit low'], P0692: ['fan', 'Cooling fan 1 control circuit high'],
    P0500: ['vss', 'Vehicle speed sensor'], P0501: ['vss', 'Vehicle speed sensor range/performance'], P0505: ['idle', 'Idle air control system'], P0506: ['idle', 'Idle speed lower than expected'], P0507: ['idle', 'Idle speed higher than expected'],
    P0560: ['volt', 'System voltage'], P0562: ['volt', 'System voltage low'], P0563: ['volt', 'System voltage high'],
    P0571: ['brake', 'Brake switch A circuit'], P0600: ['can', 'Serial communication link'], P0601: ['ecm', 'Control module memory checksum error'], P0604: ['ecm', 'Control module RAM error'], P0605: ['ecm', 'Control module ROM error'], P0606: ['ecm', 'Control module processor'],
    P0615: ['start', 'Starter relay circuit'], P0616: ['start', 'Starter relay circuit low'], P0617: ['start', 'Starter relay circuit high'],
    P0641: ['v5', 'Sensor reference voltage A circuit open'], P0685: ['relay', 'ECM power relay control circuit open'], P0686: ['relay', 'ECM power relay control circuit low'], P0687: ['relay', 'ECM power relay control circuit high'],
    P0705: ['gear', 'Transmission range sensor circuit'], P0914: ['gear', 'Gear shift position circuit (Triumph: gear position sensor)', 'tb205'], P0915: ['gear', 'Gear shift position circuit range/performance', 'tb205'], P0917: ['gear', 'Gear shift position circuit high', 'tb205'],
    P2100: ['act', 'Throttle actuator control motor circuit open'], P2101: ['act', 'Throttle actuator control motor circuit range/performance'], P2102: ['act', 'Throttle actuator control motor circuit low'], P2103: ['act', 'Throttle actuator control motor circuit high'], P2110: ['act', 'Throttle actuator control system, forced limited rpm'], P2119: ['act', 'Throttle actuator control throttle body range/performance'],
    P2122: ['grip', 'Twist grip (accelerator) position sensor D circuit low'], P2123: ['grip', 'Twist grip (accelerator) position sensor D circuit high'], P2127: ['grip', 'Twist grip (accelerator) position sensor E circuit low'], P2128: ['grip', 'Twist grip (accelerator) position sensor E circuit high'], P2138: ['grip', 'Twist grip (accelerator) position sensor D/E correlation'],
    P2227: ['baro', 'Barometric pressure circuit range/performance'], P2228: ['baro', 'Barometric pressure circuit low'], P2229: ['baro', 'Barometric pressure circuit high'],
    P1521: ['abs', 'ABS modulator communication (Triumph pinpoint test revised in 2019)', null]
  };
  function familyOf(code) {
    const n = parseInt(code.slice(1), 16), c = code[0];
    if (c === 'U') return 'can';
    if (c !== 'P') return null;
    const r = (a, b) => n >= parseInt(a, 16) && n <= parseInt(b, 16);
    if (r('0030', '0064')) return 'o2h'; if (r('0105', '0109')) return 'map'; if (r('0110', '0114')) return 'iat'; if (r('0115', '0119')) return 'ect';
    if (r('0120', '0124') || r('0220', '0224')) return 'tps'; if (r('0130', '0167')) return 'o2'; if (r('0170', '0175')) return 'trim'; if (r('0200', '0202') || r('0261', '0266')) return 'inj';
    if (r('0230', '0232')) return 'pump'; if (r('0300', '0302')) return 'misfire'; if (r('0335', '0339')) return 'crank'; if (r('0350', '0352')) return 'coil';
    if (r('0440', '0459')) return 'purge'; if (r('0460', '0464')) return 'level'; if (r('0480', '0482') || r('0691', '0694')) return 'fan'; if (r('0500', '0503')) return 'vss';
    if (r('0505', '0507')) return 'idle'; if (r('0560', '0563')) return 'volt'; if (r('0600', '0607')) return 'ecm'; if (r('0615', '0617')) return 'start'; if (r('0641', '0643')) return 'v5';
    if (r('0685', '0688')) return 'relay'; if (r('0914', '0917')) return 'gear'; if (r('2100', '2119')) return 'act'; if (r('2135', '2135')) return 'tps'; if (r('2120', '2138')) return 'grip'; if (r('2227', '2231')) return 'baro';
    return null;
  }
  function describeDtc(code) {
    const d = DTC[code], fam = d ? d[0] : familyOf(code), sys = fam ? SYS[fam] : null;
    return { code, sys: fam, system: sys ? sys.name : 'Unknown system', text: d ? d[1] : sys ? sys.name + ' fault (generic code family; exact meaning in the manual DTC table)' : 'Manufacturer-specific or unlisted code', src: d && d[2] ? d[2] : (d ? 'obd' : null), parts: sys ? sys.parts : [], pages: sys ? sys.pages : '301–306', known: !!d };
  }

  /* ---------------- Helpers ---------------- */
  const has = (x, k) => x && x[k] != null && !isNaN(x[k]);
  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))); };
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const SEV = { critical: 3, warn: 2, info: 1 };
  const isIdle = q => q.rpm > 500 && q.rpm < 2000 && (q.grip == null || q.grip < 2) && (q.speed == null || q.speed < 1);
  /* Samples from the current idle spell, ignoring its first 10 s while the speed settles after a blip or a start. */
  function settledIdle(w) { let i = w.length - 1; while (i >= 0 && isIdle(w[i])) i--; const spell = w.slice(i + 1); if (!spell.length) return []; const t0 = spell[0].t + 10; return spell.filter(q => q.t >= t0); }

  /* ---------------- Continuous rules ----------------
     Each check sees the recent samples (oldest first) and returns null or a hit.
     hold: seconds the condition must persist before a finding is raised. */
  const RULES = [
    {
      id: 'overheat', system: 'Cooling', title: 'Engine overheating', hold: 0,
      check: (w, x) => {
        if (!x.running) return null; const l = w[w.length - 1], t = l.t, e = w.filter(q => has(q, 'ect') && q.ect < 140);
        const last = s => e.filter(q => t - q.t <= s), all = (s, v) => { const a = last(s); return a.length >= s * 2 && a.every(q => q.ect >= v); };
        const ev = sev => [['Coolant', r1(l.ect) + ' \u00b0C', null], ['Held for', sev === 'critical' ? '5 s at 110 \u00b0C or more' : '30 s at 105 \u00b0C or more', 'app'], ['Normal operating temperature', '90 \u00b0C', 'tb205'], ['Thermostat opens', '88 \u00b1 2 \u00b0C', 'handbook']];
        if (all(5, 110)) return { sev: 'critical', ev: ev('critical') };
        if (all(30, 105)) return { sev: 'warn', ev: ev('warn') };
        return null;
      },
      meaning: 'The coolant is well above the 90 \u00b0C Triumph gives as normal. Brief rises in traffic can be normal while the fan cycles; a sustained climb is not. If the instrument warning light is on, Triumph says to stop the engine immediately and not restart it until the fault is fixed.',
      causes: [['Cooling fan not running: blown fan fuse (Triumph raised it to 15 A), relay or fan motor', ['tb168', 'serviceManual']], ['Low coolant or a leak', ['handbook']], ['Thermostat stuck closed', ['serviceManual']], ['Radiator fins blocked, or air trapped after a coolant change', ['app']]],
      fix: ['Stop the engine and let it cool. Do not open the pressure cap hot.', 'With the ignition on and coolant hot, check whether the fan runs. If not, check the cooling fan fuse (15 A) and the fan relay (manual p.330).', 'When cold, check the expansion tank level (handbook p.78) and look for leaks at hoses and the water pump.', 'If the fan and level are fine, test the thermostat (manual p.469\u2013471) and pressure-test the system (p.466).'],
      parts: ['radiator', 'fusebox', 'coolantCap', 'thermostat', 'coolantSensor'], src: ['handbook', 'tb205', 'tb168', 'serviceManual', 'app'], conf: 'high'
    },
    {
      id: 'cold-running', system: 'Cooling', title: 'Engine not reaching operating temperature', hold: 60,
      check: (w, x) => {
        if (!x.running || x.runtime < 900) return null; const l = w[w.length - 1], sp = w.filter(s => has(s, 'speed')).map(s => s.speed);
        return has(l, 'ect') && l.ect < 75 && sp.length > 20 && mean(sp) > 25 ? { sev: 'warn', ev: [['Coolant after ' + Math.round(x.runtime / 60) + ' min running', r1(l.ect) + ' °C', null], ['Thermostat opens', '88 ± 2 °C', 'handbook'], ['Average speed meanwhile', Math.round(mean(sp)) + ' km/h', null]] } : null;
      },
      meaning: 'After a quarter of an hour of riding the coolant should be near the thermostat opening point. Staying well below it usually means coolant is flowing through the radiator all the time. A cold engine runs richer and wears faster, and the fuel system will not adapt until it reaches 90 °C.',
      causes: [['Thermostat stuck open', ['handbook', 'serviceManual']], ['Coolant temperature sensor reading low', ['serviceManual']], ['Very cold weather with high-speed riding', ['app']]],
      fix: ['Compare the reading with how hot the engine actually feels after the ride.', 'Inspect or replace the thermostat (manual p.469–471).', 'If the thermostat is good, check the coolant temperature sensor (codes p.320).'],
      parts: ['thermostat', 'coolantSensor'], src: ['handbook', 'tb205', 'serviceManual', 'app'], conf: 'medium'
    },
    {
      id: 'ect-implausible', system: 'Sensors', title: 'Coolant temperature reading impossible', hold: 4,
      check: (w, x) => { const l = w[w.length - 1]; return has(l, 'ect') && (l.ect <= -39 || l.ect >= 140) ? { sev: 'warn', ev: [['Coolant reading', r1(l.ect) + ' °C', 'obd']] } : null; },
      meaning: 'The reading sits at the end of the OBD scale, which usually means an open or shorted sensor circuit rather than a real temperature. The ECM then runs on a substitute value and the fan may not be controlled correctly.',
      causes: [['Coolant temperature sensor connector off or corroded (clipped to the ignition coils bracket)', ['serviceManual']], ['Sensor failed', ['serviceManual']], ['Wiring damaged', ['serviceManual']]],
      fix: ['Check the coolant sensor connector on the ignition coils bracket (manual p.700).', 'Follow the coolant temperature sensor pinpoint test (manual p.320).', 'Ride gently and watch for overheating until fixed.'],
      parts: ['coolantSensor', 'coils'], src: ['obd', 'serviceManual'], conf: 'high'
    },
    {
      id: 'iat-implausible', system: 'Sensors', title: 'Intake air temperature reading impossible', hold: 4,
      check: (w, x) => { const l = w[w.length - 1]; return has(l, 'iat') && (l.iat <= -39 || l.iat >= 120) ? { sev: 'warn', ev: [['Intake air reading', r1(l.iat) + ' °C', 'obd']] } : null; },
      meaning: 'An end-of-scale intake air reading usually means an open or shorted circuit. Fuelling uses air temperature, so mixture can be off.',
      causes: [['Sensor connector or wiring', ['serviceManual']], ['Sensor failed', ['serviceManual']]],
      fix: ['Check the intake air temperature sensor connector and follow the pinpoint test (manual p.324).'],
      parts: ['iat'], src: ['obd', 'serviceManual'], conf: 'high'
    },
    {
      id: 'charge-low', system: 'Charging', title: 'Charging voltage low while running', hold: 10,
      check: (w, x) => {
        const s = w.filter(q => q.rpm > 2800 && has(q, 'volts')).slice(-10); if (!x.running || s.length < 6) return null;
        const v = mean(s.map(q => q.volts)); return v < x.lim.chargeMin ? { sev: 'warn', ev: [['Voltage above 2,800 rpm', r2(v) + ' V', null], ['Expected at about 3,000 rpm', 'over ' + x.lim.chargeMin + ' V', x.lim.chargeSrc], ['Alternator rating', '46.5 A at 3,000 rpm', 'handbook']] } : null;
      },
      meaning: 'With the engine near 3,000 rpm the alternator should be pushing the system above about 13 V. Lower than that means the battery is being drained while you ride.',
      causes: [['Regulator/rectifier failing', ['mcn', 'motofomo']], ['Stator winding fault', ['mcn']], ['Loose or burnt alternator connector at the relay bracket', ['recall627']], ['Poor battery terminal connection', ['app']]],
      fix: ['Confirm with a multimeter across the battery at about 3,000 rpm.', 'Check the battery terminals, then the alternator connector on the relay bracket for heat marks or loose pins.', 'Test the stator (manual p.708–709) and the regulator/rectifier (p.712–713).', 'Charge the battery fully before re-testing.'],
      parts: ['regrec', 'alternator', 'battery', 'relayBracket'], src: ['mcn', 'motofomo', 'handbook', 'recall627', 'serviceManual'], conf: 'medium'
    },
    {
      id: 'charge-high', system: 'Charging', title: 'Charging voltage too high', hold: 5,
      check: (w, x) => { const s = w.filter(q => q.rpm > 1500 && has(q, 'volts')).slice(-5); if (!x.running || s.length < 4) return null; const v = mean(s.map(q => q.volts)); return v > x.lim.chargeMax ? { sev: 'critical', ev: [['Voltage while running', r2(v) + ' V', null], ['Upper limit used', x.lim.chargeMax + ' V', x.lim.chargeSrc]] } : null; },
      meaning: 'The regulator is not limiting the alternator. Sustained over-voltage boils and swells AGM batteries and can damage lights and electronics.',
      causes: [['Regulator/rectifier failed', ['motofomo']], ['Regulator sense or earth connection poor', ['app']]],
      fix: ['Avoid long rides until fixed; switch off unneeded loads.', 'Check the regulator/rectifier connectors and earth under the headlight.', 'Test the regulator/rectifier (manual p.712–713) and replace if it fails.'],
      parts: ['regrec', 'battery'], src: ['motofomo', 'serviceManual'], conf: 'medium'
    },
    {
      id: 'battery-rest', system: 'Battery', title: 'Battery low with the engine off', hold: 6,
      check: (w, x) => { const s = w.filter(q => has(q, 'volts')).slice(-6); if (x.running || !x.ignOn || x.sinceStop < 30 || s.length < 4) return null; const v = mean(s.map(q => q.volts)); return v < 12.4 ? { sev: 'warn', ev: [['Ignition on, engine off', r2(v) + ' V', null], ['Recharge below', '12.4 V', 'yuasaUS'], ['Full AGM battery at rest', '12.8–13.0 V', 'yuasa']] } : null; },
      meaning: 'Yuasa recommends recharging below 12.4 V. With the ignition on there is some load, so the true resting voltage is a little higher; a reading this low still points to a discharged or ageing battery. EFI engines idle and start poorly on a weak battery.',
      causes: [['Battery discharged by short trips or standing', ['yuasaUS']], ['Battery ageing', ['yuasa']], ['Charging system not keeping up (see charging checks)', ['mcn']]],
      fix: ['Charge the battery with a suitable AGM charger, then re-test after 1–2 hours off charge (full is 12.8–13.0 V).', 'Run the cranking test; a battery that drops below 9.6 V when cranking should be replaced.', 'Run the charging test at 3,000 rpm.'],
      parts: ['battery', 'fusebox'], src: ['yuasa', 'yuasaUS', 'forumO2'], conf: 'medium'
    },
    {
      id: 'volt-dips', system: 'Wiring', title: 'Brief voltage drop-outs while riding', hold: 0,
      check: (w, x) => {
        if (!x.running) return null; const s = w.filter(q => has(q, 'volts')); if (s.length < 30) return null;
        /* A drop-out is a sample at least 2.5 V below the running voltage both 0.8-3 s before and 0.8-3 s after it, with the engine turning throughout. */
        let n = 0, low = 99, lastT = -99; const near = (i, a, b) => s.find(q => q.t - s[i].t >= a && q.t - s[i].t <= b), nearB = (i, a, b) => { for (let j = i - 1; j >= 0; j--) { const d = s[i].t - s[j].t; if (d > b) break; if (d >= a) return s[j]; } return null; };
        for (let i = 1; i < s.length - 1; i++) {
          const c = s[i]; if (!(c.rpm > 800) || c.t - lastT < 2) continue; const p = nearB(i, 0.8, 3), f = near(i, 0.8, 3);
          if (p && f && p.rpm > 800 && f.rpm > 800 && p.volts - c.volts >= 2.5 && f.volts - c.volts >= 2.5) { n++; low = Math.min(low, c.volts); lastT = c.t; }
        }
        const typ = mean(s.filter(q => q.rpm > 800).map(q => q.volts));
        return n >= 2 ? { sev: 'warn', ev: [['Drop-outs in the last ' + Math.round(s[s.length - 1].t - s[0].t) + ' s', String(n), 'app'], ['Lowest reading', r2(low) + ' V', null], ['Typical running voltage', r2(typ) + ' V', null]] } : null;
      },
      meaning: 'The supply voltage collapses for a moment and recovers while the engine keeps turning, which is the signature of an intermittent connection rather than a flat battery. Short drop-outs can be missed if the adapter samples voltage slowly. On 2016–2019 T120s a US recall covered the clutch cable rubbing through the main harness cover, with possible loss of power or stalling.',
      causes: [['Main harness chafed by the clutch cable (US recall 19V-133 / Triumph 560)', ['recall19v133']], ['Loose battery terminal or main earth', ['app']], ['Alternator connector pins loose (Triumph later added a wire alignment clip)', ['recall627']]],
      fix: ['Ask a Triumph dealer to check your VIN for recall 560 / 19V-133 and inspect the harness near the clutch cable.', 'Check the battery terminals are tight (handbook torque 4.5 Nm in your project data).', 'Inspect the alternator connector at the relay bracket.', 'If the engine stalls or the lights go out, stop riding until it is inspected.'],
      parts: ['harness', 'battery', 'alternator', 'relayBracket'], src: ['recall19v133', 'recall627', 'app'], conf: 'medium'
    },
    {
      id: 'fuel-trim', system: 'Fuelling', title: 'Fuel mixture correction is large', hold: 30,
      check: (w, x) => {
        if (!x.running || !x.warm) return null; const s = w.filter(q => has(q, 'stft') && has(q, 'ltft') && q.fuelSys !== 1 && q.fuelSys !== 4).slice(-30); if (s.length < 15) return null;
        const tot = mean(s.map(q => q.stft + q.ltft)); if (Math.abs(tot) < 15) return null;
        const idle = s.filter(q => (q.tps || 0) < 6), cruise = s.filter(q => (q.tps || 0) >= 6), ti = idle.length ? mean(idle.map(q => q.stft + q.ltft)) : null, tc = cruise.length ? mean(cruise.map(q => q.stft + q.ltft)) : null;
        const ev = [['Total trim (short + long)', (tot > 0 ? '+' : '') + r1(tot) + ' %', null], ['Normal steady-state', 'within ±10 %', 'fuelTrim']];
        if (ti != null) ev.push(['At idle', (ti > 0 ? '+' : '') + r1(ti) + ' %', null]); if (tc != null) ev.push(['Off idle', (tc > 0 ? '+' : '') + r1(tc) + ' %', null]);
        return { sev: Math.abs(tot) >= 22 ? 'warn' : 'warn', ev, lean: tot > 0, idleWorse: ti != null && tc != null ? Math.abs(ti) > Math.abs(tc) + 5 : null };
      },
      meaning: 'The ECM is having to add (positive) or remove (negative) a lot of fuel to hold the mixture. Triumph says an adaption that has run to its limit points to a mechanical fault, not something to clear and forget.',
      causesFn: hit => hit.lean ? [
        ['Air leak at a throttle body or the airbox' + (hit.idleWorse ? ' (lean mostly at idle fits this)' : ''), ['tb205', 'fuelTrim']], ['Low fuel pressure (pump, filter, regulator)', ['tb205', 'fuelTrim']], ['Oxygen sensors swapped left/right or a poor connection', ['tb205', 'tol2016']], ['Exhaust leak ahead of an oxygen sensor', ['fuelTrim']]
      ] : [['Oxygen sensors swapped left/right or one reading wrongly', ['tb205', 'tol2016']], ['Leaking injector', ['tb205']], ['Fuel pressure too high', ['tb205']]],
      causes: [], fix: ['Check the throttle body intake hoses and clamps and the airbox for splits (manual p.397–404).', 'Check the oxygen sensor connectors are clean and the left/right sensors are not swapped (identify by wire colour, not tape).', 'Measure fuel pressure with gauge T3880001 (manual p.386–387).', 'After the fix, reset the adaptions with a Triumph tool and let the bike re-adapt (Triumph: idle 12 min at temperature, then 12 min steady riding).'],
      parts: ['throttle', 'o2', 'injectors', 'fuelPump'], src: ['tb205', 'tb168', 'tol2016', 'fuelTrim', 'serviceManual'], conf: 'medium'
    },
    {
      id: 'o2-flat', system: 'Fuelling', title: 'Oxygen sensor signal not switching', hold: 30,
      check: (w, x) => {
        if (!x.running || !x.warm || x.runtime < 120) return null; const s = w.filter(q => has(q, 'o2') && q.rpm > 900 && q.rpm < 4500).slice(-30); if (s.length < 20) return null;
        const v = s.map(q => q.o2), lo = Math.min.apply(null, v), hi = Math.max.apply(null, v); if (hi - lo >= 0.3) return null;
        return { sev: 'warn', ev: [['O2 signal range over 30 samples', r2(lo) + '–' + r2(hi) + ' V', null], ['A working narrow-band sensor swings', 'roughly 0.1–0.9 V', 'obd'], ['Coolant', r1(s[s.length - 1].ect || 0) + ' °C', null]] };
      },
      meaning: 'A warm narrow-band oxygen sensor in closed-loop control flips between lean and rich many times a second. A flat signal means the ECM cannot correct the mixture properly. Triumph found many new-Bonneville O2 claims were connection problems, not failed sensors.',
      causes: [['Connector loose or left/right sensors swapped', ['tol2016']], ['Sensor heater not working (sensor stays cold)', ['serviceManual']], ['Sensor contaminated or failed', ['serviceManual']], ['Exhaust leak at the header near the sensor', ['fuelTrim']]],
      fix: ['Check both O2 connectors are fully latched and that the left sensor goes to the left connector (match wire colours on the wiring diagram, not the tape).', 'Follow the oxygen sensor and heater tests (manual p.332, p.334; reversed connection p.376).', 'Check the header joints for leaks.'],
      parts: ['o2'], src: ['tol2016', 'obd', 'serviceManual'], conf: 'medium'
    },
    {
      id: 'open-loop-fault', system: 'Fuelling', title: 'ECM running fuel control open-loop because of a fault', hold: 10,
      check: (w, x) => { const l = w[w.length - 1]; return x.running && (l.fuelSys === 8 || l.fuelSys === 16) ? { sev: 'warn', ev: [['Fuel system status', l.fuelSys === 8 ? 'Open loop due to system fault' : 'Closed loop with a sensor fault', 'obd']] } : null; },
      meaning: 'The ECM has stopped trusting an oxygen sensor and is fuelling from its map alone. Economy, emissions and low-speed running suffer, and adaption cannot proceed while a fault is present.',
      causes: [['Oxygen sensor or heater fault', ['serviceManual']], ['Any stored engine code blocks adaption', ['tb168']]],
      fix: ['Read the fault codes and fix those first.', 'Check the oxygen sensor connectors and heater (manual p.332, p.334).'],
      parts: ['o2'], src: ['obd', 'tb168', 'serviceManual'], conf: 'high'
    },
    {
      id: 'idle-unstable', system: 'Idle', title: 'Idle speed hunting', hold: 20,
      check: (w, x) => {
        if (!x.running || !x.warm) return null; const s = settledIdle(w).slice(-40); if (s.length < 25) return null;
        const v = s.map(q => q.rpm), d = sd(v); if (d < 45) return null;
        return { sev: 'warn', ev: [['Idle variation (standard deviation)', Math.round(d) + ' rpm', null], ['Idle range seen', Math.round(Math.min.apply(null, v)) + '–' + Math.round(Math.max.apply(null, v)) + ' rpm', null], ['App threshold', '45 rpm', 'app']] };
      },
      meaning: 'A warm, closed-throttle idle should be steady. Hunting usually comes from unmetered air, an unadapted ECM, or a weak electrical supply.',
      causes: [['Air leak at a throttle body or intake boot', ['tb205']], ['Adaptions not learned or reset (Triumph: poor idle until adapted)', ['tb168']], ['Weak battery or poor supply', ['forumO2']]],
      fix: ['Check intake hoses and clamps between airbox and throttle bodies.', 'Clear any engine codes, then let the bike idle-adapt: about 12 minutes at operating temperature without touching the throttle (Triumph TB 168.2).', 'Run the battery and charging tests.'],
      parts: ['throttle', 'battery'], src: ['tb168', 'tb205', 'forumO2', 'app'], conf: 'low'
    },
    {
      id: 'idle-spec', system: 'Idle', title: 'Warm idle speed outside your manual’s figure', hold: 20, needs: 'idleSpec',
      check: (w, x) => {
        if (!x.running || !x.warm || !x.user.idle) return null; const s = settledIdle(w).slice(-30); if (s.length < 20) return null;
        const m = mean(s.map(q => q.rpm)), u = x.user; return Math.abs(m - u.idle) > u.idleTol ? { sev: 'warn', ev: [['Average warm idle', Math.round(m) + ' rpm', null], ['Your manual value (entered by you)', u.idle + ' ± ' + u.idleTol + ' rpm', 'user']] } : null;
      },
      meaning: 'The warm idle does not match the figure you entered from your service manual.',
      causes: [['Adaptions not learned', ['tb168']], ['Air leak', ['tb205']], ['Throttle body or actuator fault', ['serviceManual']]],
      fix: ['Check for codes and air leaks, then let the bike idle-adapt for about 12 minutes at temperature.', 'If still out, follow the idle speed data checks (manual p.296).'],
      parts: ['throttle'], src: ['tb168', 'tb205', 'serviceManual'], conf: 'medium'
    },
    {
      id: 'map-baro', system: 'Sensors', title: 'Manifold pressure does not match air pressure with the engine off', hold: 4,
      check: (w, x) => {
        if (x.running || !x.ignOn || x.sinceStop < 8) return null; const s = w.filter(q => has(q, 'map') && has(q, 'baro')).slice(-4); if (s.length < 3) return null;
        const d = mean(s.map(q => q.map - q.baro)); return Math.abs(d) > 3 ? { sev: 'warn', ev: [['MAP minus barometric, engine off', (d > 0 ? '+' : '') + r1(d) + ' kPa', null], ['Expected', 'within 1–2 kPa (app allows 3 for 1 kPa steps)', 'p0069']] } : null;
      },
      meaning: 'With the engine stopped both sensors are measuring the same outside air, so they should agree. A gap means one sensor, its hose or its wiring is wrong, and fuelling will be off at all loads.',
      causes: [['MAP sensor hose split, blocked or off', ['p0069']], ['MAP or ambient pressure sensor failing', ['serviceManual']], ['Sensor connector or 5 V supply problem', ['serviceManual']]],
      fix: ['Check the MAP sensor hose and connector (manual p.417).', 'Check the ambient air pressure sensor (manual p.418–419).', 'Follow the pinpoint tests (manual p.344, p.346).'],
      parts: ['mapSensor', 'baroSensor'], src: ['p0069', 'serviceManual'], conf: 'high'
    },
    {
      id: 'mil-no-generic', system: 'Codes', title: 'Warning light on but no generic codes readable', hold: 15,
      check: (w, x) => x.mil && x.dtcRead && !x.dtcs.length && !x.pending.length ? { sev: 'info', ev: [['MIL status from ECM', 'On', 'obd'], ['Generic codes returned', 'None', 'obd']] } : null,
      meaning: 'The ECM reports the warning lamp on, but no code came back through the generic OBD request. The code is probably manufacturer-specific and needs Triumph’s diagnostic tool or TuneECU to read.',
      causes: [['Manufacturer-specific code (ABS, immobiliser, instruments)', ['obd']]],
      fix: ['Read the codes with Triumph’s dealer tool or TuneECU.', 'Check the manual DTC tables (p.301–307).'],
      parts: ['ecm'], src: ['obd', 'serviceManual'], conf: 'medium'
    }
  ];

  /* ---------------- Guided tests ---------------- */
  const TESTS = [
    {
      id: 'koeo', title: 'Key on, engine off', time: '10 s',
      steps: ['Ignition on, kill switch to run, engine stopped.', 'Do not touch the throttle.'],
      focus: ['volts', 'map', 'baro', 'ect', 'iat', 'grip', 'tps'], duration: 8,
      ready: x => !x.running && x.ignOn, readyText: 'Waiting for ignition on with the engine stopped',
      analyse(s, x) {
        const out = [], g = k => s.filter(q => has(q, k)).map(q => q[k]), v = g('volts'), m = g('map'), b = g('baro'), e = g('ect'), i = g('iat'), gr = g('grip');
        if (v.length) { const a = mean(v); out.push({ name: 'Battery with ignition on', value: r2(a) + ' V', limit: '12.4 V or more', pass: a >= 12.4, src: 'yuasaUS', rule: a < 12.4 ? 'battery-rest' : null }); }
        if (m.length && b.length) { const d = mean(m) - mean(b); out.push({ name: 'MAP vs barometric pressure', value: (d >= 0 ? '+' : '') + r1(d) + ' kPa', limit: 'within 3 kPa', pass: Math.abs(d) <= 3, src: 'p0069', rule: Math.abs(d) > 3 ? 'map-baro' : null }); }
        if (e.length) { const a = mean(e); out.push({ name: 'Coolant sensor plausible', value: r1(a) + ' °C', limit: '−30 to 130 °C', pass: a > -30 && a < 130, src: 'obd', rule: !(a > -30 && a < 130) ? 'ect-implausible' : null }); }
        if (i.length) { const a = mean(i); out.push({ name: 'Intake air sensor plausible', value: r1(a) + ' °C', limit: '−30 to 110 °C', pass: a > -30 && a < 110, src: 'obd', rule: !(a > -30 && a < 110) ? 'iat-implausible' : null }); }
        if (e.length && i.length && x.coldSoak) { const d = Math.abs(mean(e) - mean(i)); out.push({ name: 'Coolant and air agree after a cold soak', value: r1(d) + ' °C apart', limit: 'within 10 °C (app rule)', pass: d <= 10, src: 'app' }); }
        if (gr.length) { const a = Math.max.apply(null, gr); out.push({ name: 'Twist grip at rest', value: r1(a) + ' %', limit: 'below 3 % (app rule)', pass: a < 3, src: 'app' }); }
        return out;
      }
    },
    {
      id: 'crank', title: 'Cranking and start', time: 'up to 30 s',
      steps: ['Ignition on, engine stopped, in neutral.', 'Press start when the app says ready. Release once it fires.'],
      focus: ['volts', 'rpm'], duration: 30, untilDone: true,
      ready: x => !x.running && x.ignOn, readyText: 'Waiting for ignition on with the engine stopped',
      analyse(s, x) {
        const out = [], cr = s.filter(q => q.rpm > 30 && q.rpm < 500), st = s.findIndex(q => q.rpm > 700);
        if (!cr.length && st < 0) return [{ name: 'Engine cranked', value: 'No cranking seen', limit: 'Press start within 30 s', pass: false, src: 'app' }];
        const vmin = Math.min.apply(null, s.filter(q => has(q, 'volts') && (q.rpm > 0 || q.cranking)).map(q => q.volts).concat([99]));
        if (vmin < 99) out.push({ name: 'Lowest voltage while cranking', value: r2(vmin) + ' V', limit: '9.6 V or more', pass: vmin >= 9.6, src: 'crankTest', rule: vmin < 9.6 ? 'battery-crank' : null });
        const t0 = (cr[0] || s[st]).t, t1 = st >= 0 ? s[st].t : null;
        out.push({ name: 'Time from cranking to running', value: t1 != null ? r1(Math.max(0, t1 - t0)) + ' s' : 'Did not start', limit: 'under 5 s (app rule)', pass: t1 != null && t1 - t0 < 5, src: 'app' });
        if (st >= 0) { const after = s.filter(q => q.t > s[st].t + 4 && has(q, 'volts')).map(q => q.volts); if (after.length) { const a = Math.max.apply(null, after); out.push({ name: 'Voltage recovers after start', value: r2(a) + ' V', limit: 'above 13.0 V within a few seconds', pass: a > 13.0, src: 'mcn' }); } }
        return out;
      }
    },
    {
      id: 'charge', title: 'Charging at 3,000 rpm', time: '20 s',
      steps: ['Engine running, in neutral, on the stand.', 'Hold a steady 3,000 rpm until the bar fills.'],
      focus: ['volts', 'rpm'], duration: 12, window: q => q.rpm > 2700 && q.rpm < 3300,
      ready: x => x.running, readyText: 'Start the engine',
      analyse(s, x) {
        const w = s.filter(q => q.rpm > 2700 && q.rpm < 3300 && has(q, 'volts')); if (w.length < 5) return [{ name: 'Steady 3,000 rpm held', value: 'Not enough samples', limit: '2,700–3,300 rpm', pass: false, src: 'app' }];
        const a = mean(w.map(q => q.volts)), lim = x.lim;
        return [{ name: 'Voltage at 3,000 rpm', value: r2(a) + ' V', limit: lim.chargeMin + '–' + lim.chargeMax + ' V', pass: a >= lim.chargeMin && a <= lim.chargeMax, src: lim.chargeSrc, rule: a < lim.chargeMin ? 'charge-low' : a > lim.chargeMax ? 'charge-high' : null },
          { name: 'Alternator rating at this speed', value: '46.5 A', limit: 'Triumph figure', pass: true, src: 'handbook', info: true }];
      }
    },
    {
      id: 'idle', title: 'Warm idle', time: '60 s',
      steps: ['Engine at operating temperature (about 90 °C).', 'In neutral, hands off the throttle, nothing switched on beyond normal.'],
      focus: ['rpm', 'stft', 'ltft', 'o2', 'map', 'volts', 'fuelSys', 'ect', 'grip'], duration: 50,
      ready: x => x.running && x.warm, readyText: 'Warm the engine to 85 °C or more',
      analyse(s, x) {
        s = s.filter(q => q.t >= (s[0] ? s[0].t : 0) + 8); const out = [], r = s.filter(q => q.rpm > 400).map(q => q.rpm); if (r.length < 10) return [{ name: 'Engine idling', value: 'Not enough samples', limit: '', pass: false, src: 'app' }];
        const d = sd(r), avg = mean(r); out.push({ name: 'Idle steadiness', value: '±' + Math.round(d) + ' rpm (avg ' + Math.round(avg) + ')', limit: 'under ±45 rpm (app rule)', pass: d < 45, src: 'app', rule: d >= 45 ? 'idle-unstable' : null });
        if (x.user.idle) out.push({ name: 'Idle against your manual value', value: Math.round(avg) + ' rpm', limit: x.user.idle + ' ± ' + x.user.idleTol, pass: Math.abs(avg - x.user.idle) <= x.user.idleTol, src: 'user', rule: Math.abs(avg - x.user.idle) > x.user.idleTol ? 'idle-spec' : null });
        const tr = s.filter(q => has(q, 'stft') && has(q, 'ltft')).map(q => q.stft + q.ltft); if (tr.length) { const t = mean(tr); out.push({ name: 'Fuel trim at idle', value: (t > 0 ? '+' : '') + r1(t) + ' %', limit: 'within ±10 %', pass: Math.abs(t) <= 10, src: 'fuelTrim', rule: Math.abs(t) > 15 ? 'fuel-trim' : null }); }
        const o = s.filter(q => has(q, 'o2')).map(q => q.o2); if (o.length > 10) { const rg = Math.max.apply(null, o) - Math.min.apply(null, o); out.push({ name: 'O2 sensor switching', value: r2(rg) + ' V swing', limit: '0.3 V or more', pass: rg >= 0.3, src: 'obd', rule: rg < 0.3 ? 'o2-flat' : null }); }
        const fs = s.filter(q => q.fuelSys != null).map(q => q.fuelSys); if (fs.length) { const cl = fs.filter(f => f === 2).length / fs.length; out.push({ name: 'Closed-loop fuel control', value: Math.round(cl * 100) + ' % of the time', limit: 'mostly closed loop when warm', pass: cl > 0.6, src: 'obd' }); }
        const v = s.filter(q => has(q, 'volts')).map(q => q.volts); if (v.length) out.push({ name: 'Voltage at idle', value: r2(mean(v)) + ' V', limit: 'for reference', pass: true, src: null, info: true });
        return out;
      }
    },
    {
      id: 'grip', title: 'Twist grip sweep', time: '15 s',
      steps: ['Ignition on, engine OFF.', 'Roll the throttle slowly from closed to fully open over about 3 seconds, then let it snap back. Do it twice.', 'Then leave the throttle closed until the bar fills.'],
      focus: ['grip', 'thrCmd', 'tps'], duration: 14,
      ready: x => !x.running && x.ignOn, readyText: 'Ignition on, engine stopped',
      analyse(s, x) {
        const g = s.filter(q => has(q, 'grip')); if (g.length < 10) return [{ name: 'Twist grip signal', value: 'Not published by this ECU', limit: '', pass: false, src: 'obd' }];
        const v = g.map(q => q.grip), mx = Math.max.apply(null, v), rest = Math.min.apply(null, v); let drops = 0;
        for (let i = 1; i < v.length - 1; i++) if (v[i] < v[i - 1] - 20) { const ref = v[i - 1]; let j = i + 1; while (j < v.length && j <= i + 12 && v[j] < ref - 10) j++; if (j < v.length && j <= i + 12) { drops++; i = j; } }
        const out = [{ name: 'Grip travel seen', value: r1(rest) + '–' + r1(mx) + ' %', limit: 'opens well past half', pass: mx - rest > 50, src: 'app' },
          { name: 'Signal drop-outs during the sweep', value: String(drops), limit: 'none', pass: drops === 0, src: 'app', rule: drops ? 'grip-glitch' : null }];
        const end = v.slice(-8); out.push({ name: 'Returns to rest', value: r1(mean(end)) + ' %', limit: 'below 3 %', pass: mean(end) < 3, src: 'app', rule: mean(end) >= 3 ? 'grip-stuck' : null });
        return out;
      }
    }
  ];

  /* Findings that only tests raise */
  const TEST_RULES = {
    'battery-crank': {
      system: 'Battery', title: 'Battery voltage collapses when cranking', meaning: 'A healthy battery stays above about 9.6 V while the starter turns. Dropping lower means the battery cannot deliver its rated current, even if it shows a good resting voltage.',
      causes: [['Battery worn out', ['crankTest', 'yuasa']], ['Battery discharged', ['yuasaUS']], ['Corroded terminal or earth strap', ['app']]],
      fix: ['Charge fully and repeat. If it still drops below 9.6 V, replace with a YTX12-BS (12 V 10 Ah).', 'Clean and tighten the terminals and the engine earth.'],
      parts: ['battery'], src: ['crankTest', 'yuasa', 'handbook'], conf: 'high', sev: 'warn'
    },
    'grip-glitch': {
      system: 'Throttle', title: 'Twist grip signal drops out', meaning: 'The grip position signal fell away and came back while you were opening the throttle. The ride-by-wire system uses this signal to open the throttle, so drop-outs can cause hesitation or limp mode.',
      causes: [['Twist grip connector on the back of the headlight harness bracket loose or corroded', ['serviceManual']], ['Twist grip sensor worn', ['serviceManual']], ['Harness damaged at the handlebar', ['app']]],
      fix: ['Check the twist grip connector on the back of the harness bracket (manual p.413–414).', 'Follow the twist grip sensor tests (manual p.358–362).'],
      parts: ['twistGrip'], src: ['serviceManual', 'app'], conf: 'medium', sev: 'warn'
    },
    'grip-stuck': {
      system: 'Throttle', title: 'Twist grip not returning to closed', meaning: 'After release the grip still reads open. On 2016–2017 T120s a US recall covered heated grips expanding and holding the throttle open.',
      causes: [['Grip binding on the bar or heated grip swelling', ['recallGrips']], ['Return spring or sensor fault', ['serviceManual']]],
      fix: ['Do not ride until the grip snaps shut on its own.', 'Check the grip for binding (manual p.410–411) and ask a dealer about the heated grip recall if fitted.'],
      parts: ['twistGrip'], src: ['recallGrips', 'serviceManual'], conf: 'medium', sev: 'critical'
    }
  };

  /* ---------------- Engine ---------------- */
  class Diagnoser {
    constructor(opts) {
      opts = opts || {}; this.win = []; this.findings = {}; this.hold = {}; this.listeners = []; this.user = opts.user || {}; this.lastRun = null; this.lastStop = null; this.runStart = null; this.firstT = null;
    }
    on(fn) { this.listeners.push(fn); }
    reset() { this.win = []; this.findings = {}; this.hold = {}; this.lastStop = null; this.runStart = null; this.firstT = null; }
    limits() {
      const u = this.user, ok = u.chargeMin && u.chargeMax;
      return { chargeMin: ok ? +u.chargeMin : 13.0, chargeMax: ok ? +u.chargeMax : 15.0, chargeSrc: ok ? 'user' : 'mcn' };
    }
    ctx(extra) {
      const l = this.win[this.win.length - 1] || {}, t = l.t || 0, running = (l.rpm || 0) > 400;
      return Object.assign({ running, runtime: this.runStart != null && running ? t - this.runStart : 0, sinceStop: this.lastStop != null ? t - this.lastStop : (this.firstT != null ? t - this.firstT : 0), warm: (l.ect || 0) >= 80, ignOn: !!l.answering, lim: this.limits(), user: this.userNorm(), dtcs: [], pending: [], mil: false, dtcRead: false }, extra || {});
    }
    userNorm() { const u = this.user; return { idle: u.idle ? +u.idle : null, idleTol: u.idleTol ? +u.idleTol : 50 }; }
    /* sample: { t (s), rpm, ect, ..., volts, answering } ; meta: { source, dtcs, pending, mil, dtcRead } */
    feed(sample, meta) {
      if (this.firstT == null) this.firstT = sample.t;
      const prev = this.win[this.win.length - 1], running = (sample.rpm || 0) > 400, wasRunning = prev && (prev.rpm || 0) > 400;
      if (running && !wasRunning) this.runStart = sample.t; if (!running && wasRunning) this.lastStop = sample.t; if (!sample.answering && prev && prev.answering) this.lastStop = sample.t;
      this.win.push(sample); while (this.win.length && sample.t - this.win[0].t > 300) this.win.shift();
      const x = this.ctx(meta), changed = [];
      RULES.forEach(rule => {
        const w = this.win.filter(q => sample.t - q.t <= Math.max(60, (rule.hold || 0) + 30));
        let hit = null; try { hit = rule.check(w, x); } catch (e) { hit = null; }
        const h = this.hold[rule.id] || (this.hold[rule.id] = { since: null, clear: null });
        if (hit) { if (h.since == null) h.since = sample.t; h.clear = null; if (sample.t - h.since >= (rule.hold || 0)) { if (this._raise(rule, hit, sample, meta)) changed.push(rule.id); } }
        else { h.since = null; const f = this.findings[rule.id]; if (f && f.active) { if (h.clear == null) h.clear = sample.t; if (sample.t - h.clear >= 20) { f.active = false; f.resolvedAt = sample.t; changed.push(rule.id); } } }
      });
      this._dtcFindings(meta, sample, changed);
      if (changed.length) this.listeners.forEach(fn => fn(changed.map(id => this.findings[id])));
      return changed;
    }
    _raise(rule, hit, sample, meta) {
      const id = rule.id, f = this.findings[id], isNew = !f || !f.active;
      const nf = Object.assign(f || { id, firstSeen: sample.t, count: 0 }, {
        kind: 'rule', title: rule.title, system: rule.system, sev: hit.sev, evidence: hit.ev, meaning: rule.meaning,
        causes: rule.causesFn ? rule.causesFn(hit) : rule.causes, fix: rule.fix, parts: rule.parts, src: rule.src, conf: rule.conf,
        lastSeen: sample.t, active: true, origin: meta && meta.source === 'ecu' ? 'Live ECU' : 'Simulated twin'
      });
      if (isNew) nf.count++; this.findings[id] = nf; return isNew || (f && f.sev !== hit.sev);
    }
    _dtcFindings(meta, sample, changed) {
      if (!meta) return; const seen = {};
      (meta.dtcs || []).map(c => [c, 'stored']).concat((meta.pending || []).map(c => [c, 'pending'])).forEach(([code, st]) => {
        const id = 'dtc-' + code; seen[id] = 1; const d = describeDtc(code), f = this.findings[id];
        if (f && f.active && f.status === st) { f.lastSeen = sample.t; return; }
        const tb = d.src === 'tb222', ev = [['Code', code + (st === 'pending' ? ' (pending, not yet confirmed)' : ' (stored)'), d.src || 'obd'], ['Generic meaning', d.text, d.src || 'obd'], ['System', d.system, null]];
        const fix = (tb ? ['Triumph has found the ECM can set this code with no real fault. Ask a dealer to confirm the bike has the latest calibration (Triumph tool 2021-12 release or later), clear it and test ride.'] : [])
          .concat(['Look the code up in the service manual DTC table (p.301–306) to confirm Triumph’s meaning.', d.pages ? 'Follow the pinpoint test for this system (manual p.' + d.pages + ').' : 'Find the system in the manual’s fault-code tables (p.310–382).', 'Check the connector for this part first: most intermittent codes are connections.', 'Clear the code only after the fix, then confirm it stays clear on a test ride. Adaption cannot run while an engine code is present (TB 168.2).']);
        this.findings[id] = Object.assign(f || { id, firstSeen: sample.t, count: 0 }, {
          kind: 'dtc', code, status: st, title: (st === 'pending' ? 'Pending code ' : 'Fault code ') + code + ': ' + d.system, system: 'Codes', sev: st === 'pending' ? 'info' : 'warn', evidence: ev,
          meaning: (st === 'pending' ? 'The ECM has seen this fault once but not yet confirmed it. ' : 'The ECM has confirmed this fault and lit the warning lamp. ') + (d.known ? '' : 'This code is not in the app’s list, so its meaning must come from the manual.'),
          causes: tb ? [['ECM misdetection fixed by a calibration update', ['tb222']], ['A real fault in this system if it returns after the update', ['serviceManual']]] : [['Connector or wiring for ' + d.system.toLowerCase(), ['serviceManual']], ['The ' + d.system.toLowerCase() + ' itself', ['serviceManual']]],
          fix, parts: d.parts, src: [d.src || 'obd', 'serviceManual', 'tb168'].concat(tb ? ['tb222'] : []), conf: d.known ? 'high' : 'low', lastSeen: sample.t, active: true, origin: meta.source === 'ecu' ? 'Live ECU' : 'Simulated twin'
        });
        this.findings[id].count++; changed.push(id);
      });
      Object.keys(this.findings).forEach(id => { const f = this.findings[id]; if (f.kind === 'dtc' && f.active && !seen[id] && meta.dtcRead) { f.active = false; f.resolvedAt = sample.t; changed.push(id); } });
    }
    /* Called by the guided-test runner with the test result rows */
    fromTest(test, rows, t, source) {
      const changed = [];
      rows.forEach(r => {
        if (!r.rule) return; const base = TEST_RULES[r.rule] || RULES.find(q => q.id === r.rule); if (!base) return;
        const f = this.findings[r.rule], ev = [[r.name, r.value, r.src], ['Limit', r.limit, r.src], ['Found by', test.title + ' test', null]];
        this.findings[r.rule] = Object.assign(f || { id: r.rule, firstSeen: t, count: 0 }, {
          kind: 'test', title: base.title, system: base.system, sev: base.sev || (r.rule === 'charge-high' ? 'critical' : 'warn'), evidence: ev, meaning: base.meaning,
          causes: base.causes && base.causes.length ? base.causes : (base.causesFn ? base.causesFn({ lean: true }) : []), fix: base.fix, parts: base.parts, src: base.src, conf: base.conf, lastSeen: t, active: true, origin: source === 'ecu' ? 'Live ECU' : 'Simulated twin'
        });
        this.findings[r.rule].count++; changed.push(r.rule);
      });
      if (changed.length) this.listeners.forEach(fn => fn(changed.map(id => this.findings[id])));
      return changed;
    }
    list() { return Object.values(this.findings).sort((a, b) => (b.active - a.active) || (SEV[b.sev] - SEV[a.sev]) || (b.lastSeen - a.lastSeen)); }
    clear(id) { delete this.findings[id]; delete this.hold[id]; }
  }

  const api = { TIER, SOURCES, REF, NOT_AVAILABLE, PARTS, SYS, DTC, RULES, TESTS, TEST_RULES, describeDtc, familyOf, Diagnoser, SEV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.T120D = api;
})(typeof window !== 'undefined' ? window : globalThis);
