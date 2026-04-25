/**
 * Generates docs/device-attributes.xlsx — a reference of every attribute
 * each of our 3 device servers (AIS140, FMB125, GT06) captures from its
 * telemetry stream.
 *
 * Source-of-truth is the Mongo schema plus the parser in each device- dir.
 * When either changes, update the arrays below and re-run this script:
 *
 *   cd server && node scripts/gen-device-attributes.js
 *
 * Output path is relative to the repo root (..//docs/device-attributes.xlsx).
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const ExcelJS = require('exceljs');

const REPO_ROOT  = path.join(__dirname, '..', '..');
const OUT_PATH   = path.join(REPO_ROOT, 'docs', 'device-attributes.xlsx');

// ─── AIS140 ───────────────────────────────────────────────────────────────────
// Sources: device-ais140/models/Location.js, device-ais140/parser.js
// Production devices use the CSV (ROADRPA) format — pipe path is legacy.
const AIS140 = [
  // field,              type,     unit,       parser,          populatedBy,            notes
  ['imei',               'String', '',         'CSV + pipe',    'LGN/NMR/ALT/EMG/HBT',  'Primary device identifier'],
  ['vehicleRegNo',       'String', '',         'CSV + pipe',    'NMR/ALT',              'Registration number from device, e.g. "RJ06GB7731"'],
  ['vendorId',           'String', '',         'CSV + pipe',    'all',                  'Vendor id — "ROADRPA" for all Indian devices'],
  ['firmwareVersion',    'String', '',         'CSV + pipe',    'all',                  'e.g. "1.4.0"'],
  ['latitude',           'Number', 'deg',      'CSV + pipe',    'LGN/NMR/ALT',          'Decimal degrees, signed'],
  ['longitude',          'Number', 'deg',      'CSV + pipe',    'LGN/NMR/ALT',          'Decimal degrees, signed'],
  ['latDir',             'String', 'N/S',      'CSV + pipe',    'NMR/ALT',              ''],
  ['lngDir',             'String', 'E/W',      'CSV + pipe',    'NMR/ALT',              ''],
  ['altitude',           'Number', 'm',        'CSV + pipe',    'NMR/ALT',              ''],
  ['speed',              'Number', 'km/h',     'CSV + pipe',    'NMR/ALT',              ''],
  ['heading',            'Number', 'deg',      'CSV + pipe',    'NMR/ALT',              '0–359'],
  ['satellites',         'Number', '',         'CSV + pipe',    'NMR/ALT',              ''],
  ['hdop',               'Number', '',         'CSV + pipe',    'NMR/ALT',              ''],
  ['pdop',               'Number', '',         'CSV + pipe',    'NMR/ALT',              ''],
  ['gpsValid',           'Boolean','',         'CSV + pipe',    'all',                  'true when device reports "A" / "1"'],
  ['mcc',                'String', '',         'CSV + pipe',    'NMR/ALT',              'Mobile country code'],
  ['mnc',                'String', '',         'CSV + pipe',    'NMR/ALT',              'Mobile network code'],
  ['lac',                'String', 'hex',      'CSV + pipe',    'NMR/ALT',              'Location area code — ROADRPA sends as hex string'],
  ['cellId',             'String', 'hex',      'CSV + pipe',    'NMR/ALT',              'Cell ID — ROADRPA sends as hex string'],
  ['gsmSignal',          'Number', '0–31',     'CSV + pipe',    'NMR/ALT',              ''],
  ['operatorName',       'String', '',         'CSV + pipe',    'NMR/ALT',              'e.g. "Airtel"'],
  ['ignition',           'Number', '0/1',      'CSV + pipe',    'NMR/ALT',              '1 = ACC on'],
  ['mainPowerStatus',    'Number', '0/1',      'CSV + pipe',    'NMR/ALT',              '1 = external power present'],
  ['mainPowerVoltage',   'Number', 'V',        'CSV + pipe',    'NMR/ALT',              ''],
  ['batteryVoltage',     'Number', 'V',        'CSV + pipe',    'NMR/ALT',              'Internal battery'],
  ['emergencyStatus',    'Number', '0/1',      'CSV + pipe',    'NMR/ALT/EMG',          '1 = panic button'],
  ['tamperAlert',        'Number', '0/1',      'pipe only',     'NMR/ALT',              'CSV parser does not populate this'],
  ['odometer',           'Number', 'km',       'CSV + pipe',    'NMR/ALT',              'Total odometer'],
  ['di1',                'Number', '0/1',      'pipe only',     'NMR/ALT',              'Digital input 1 — NOT populated by CSV parser'],
  ['di2',                'Number', '0/1',      'pipe only',     'NMR/ALT',              'Digital input 2 — NOT populated by CSV parser'],
  ['di3',                'Number', '0/1',      'pipe only',     'NMR/ALT',              'Digital input 3 — NOT populated by CSV parser'],
  ['di4',                'Number', '0/1',      'pipe only',     'NMR/ALT',              'Digital input 4 — NOT populated by CSV parser'],
  ['do1',                'Number', '0/1',      'pipe only',     'NMR/ALT',              'Digital output 1 — NOT populated by CSV parser'],
  ['do2',                'Number', '0/1',      'pipe only',     'NMR/ALT',              'Digital output 2 — NOT populated by CSV parser'],
  ['ai1',                'Number', 'mV',       'pipe only',     'NMR/ALT',              'Analog input 1 — typically fuel sensor. NOT populated by CSV parser.'],
  ['ai2',                'Number', 'mV',       'pipe only',     'NMR/ALT',              'Analog input 2. NOT populated by CSV parser.'],
  ['alertType',          'String', '',         'pipe only',     'EMG/ALT',              'Tokens like "DOOR", "TOW", "SPEED"'],
  ['timestamp',          'Date',   '',         'CSV + pipe',    'all',                  'From DDMMYYYY + HHMMSS fields (UTC)'],
  ['packetType',         'String', '',         'CSV + pipe',    'all',                  'LGN / NMR / ALT / EMG / HBT / AKN'],
  ['packetStatus',       'String', 'L/H',      'CSV + pipe',    'all',                  'L = live, H = historical/buffered'],
  ['replyNumber',        'Number', '',         'CSV + pipe',    'all',                  'Device sequence counter'],
  ['raw',                'String', '',         'CSV + pipe',    'all',                  'Original ASCII packet, for audit/debug'],
];

// ─── FMB125 ───────────────────────────────────────────────────────────────────
// Sources: device-fmb125/models/Location.js (Codec 8/8E/16 binary + I/O elements).
const FMB125 = [
  // Identification
  ['imei',               'String', '',         'Codec 8/8E/16', 'all',                  'Primary device identifier'],
  ['deviceType',         'String', '',         '',              'all',                  'FMB125 / FMB120 / FMB130 / FMB140'],
  // Timestamps / protocol
  ['timestamp',          'Date',   '',         'header',        'all',                  'GPS timestamp (UTC from device)'],
  ['serverTimestamp',    'Date',   '',         'server',        'all',                  'Time packet was received'],
  ['priority',           'Number', '0/1/2',    'header',        'all',                  '0=Low, 1=High, 2=Panic'],
  ['codecType',          'Number', '',         'header',        'all',                  '8 / 0x8E / 16'],
  ['recordCount',        'Number', '',         'header',        'all',                  'Records in this TCP packet'],
  ['recordIndex',        'Number', '',         '',              'all',                  '0-based index within packet'],
  // GPS
  ['latitude',           'Number', 'deg',      'GPS block',     'all',                  'Decimal degrees'],
  ['longitude',          'Number', 'deg',      'GPS block',     'all',                  'Decimal degrees'],
  ['altitude',           'Number', 'm',        'GPS block',     'all',                  ''],
  ['angle',              'Number', 'deg',      'GPS block',     'all',                  'Heading 0–360'],
  ['satellites',         'Number', '',         'GPS block',     'all',                  ''],
  ['speed',              'Number', 'km/h',     'GPS block',     'all',                  ''],
  ['hdop',               'Number', '',         'IO',            'varies',               'IO 181'],
  ['pdop',               'Number', '',         'IO',            'varies',               'IO 182'],
  ['gpsValid',           'Boolean','',         'GPS block',     'all',                  ''],
  // Fuel
  ['fuelLevel',          'Number', '%',        'IO',            'varies',               'IO 48 (LLS sensor %)'],
  ['fuelUsed',           'Number', 'L',        'IO',            'varies',               'Total fuel consumed'],
  ['fuelRate',           'Number', 'L/h',      'IO',            'varies',               'Current consumption rate'],
  ['fuelSensorVoltage',  'Number', 'mV',       'IO',            'varies',               'Raw LLS voltage'],
  ['fuelTankCapacity',   'Number', 'L',        'config',        'config',               'Set in device configuration, not a telemetry field'],
  // Vehicle status
  ['ignition',           'Boolean','',         'IO',            'all',                  'IO 239'],
  ['movement',           'Boolean','',         'IO',            'all',                  'IO 240'],
  ['engineSpeed',        'Number', 'rpm',      'IO',            'varies',               'IO 85 (OBD RPM)'],
  ['engineTemp',         'Number', '°C',       'IO',            'varies',               'IO 32'],
  ['engineLoad',         'Number', '%',        'IO',            'varies',               'IO 31'],
  ['engineHours',        'Number', 'h',        'IO',            'varies',               ''],
  // Odometer
  ['totalOdometer',      'Number', 'm',        'IO',            'varies',               'IO 16 or 199 depending on firmware'],
  ['tripOdometer',       'Number', 'm',        'IO',            'varies',               ''],
  // Power
  ['externalVoltage',    'Number', 'mV',       'IO',            'all',                  'IO 66'],
  ['batteryVoltage',     'Number', 'mV',       'IO',            'all',                  'IO 67 (internal battery)'],
  ['batteryCurrent',     'Number', 'mA',       'IO',            'all',                  'IO 68'],
  ['batteryLevel',       'Number', '%',        'IO',            'all',                  'IO 113'],
  // Network
  ['gsmSignal',          'Number', '0–5/0–31', 'IO',            'all',                  'IO 21 (firmware varies)'],
  ['cellId',             'Number', '',         'IO',            'varies',               'IO 10'],
  ['areaCode',           'Number', '',         'IO',            'varies',               'IO 9 (LAC)'],
  ['operator',           'String', '',         'IO',            'varies',               'IO 241 (MCC+MNC)'],
  ['dataMode',           'Number', '',         'IO',            'varies',               ''],
  // I/O
  ['digitalInput1',      'Boolean','',         'IO',            'varies',               'IO 1'],
  ['digitalInput2',      'Boolean','',         'IO',            'varies',               'IO 2'],
  ['digitalInput3',      'Boolean','',         'IO',            'varies',               'IO 3'],
  ['digitalOutput1',     'Boolean','',         'IO',            'varies',               'IO 179'],
  ['digitalOutput2',     'Boolean','',         'IO',            'varies',               'IO 180'],
  ['analogInput1',       'Number', 'mV',       'IO',            'varies',               'IO 9 (typical fuel sensor wiring)'],
  ['analogInput2',       'Number', 'mV',       'IO',            'varies',               'IO 6'],
  // CAN
  ['canEngineSpeed',     'Number', 'rpm',      'IO',            'varies',               'CAN-only IO element'],
  ['canFuelLevel',       'Number', '%',        'IO',            'varies',               'IO 87 (CAN fuel %)'],
  ['canFuelUsed',        'Number', 'L',        'IO',            'varies',               ''],
  ['canMileage',         'Number', 'km',       'IO',            'varies',               'CAN odometer'],
  ['canAxleWeight',      'Number', 'kg',       'IO',            'varies',               ''],
  ['canEngineTemp',      'Number', '°C',       'IO',            'varies',               ''],
  ['canEngineLoad',      'Number', '%',        'IO',            'varies',               ''],
  // Driver
  ['iButtonId',          'String', '',         'IO',            'varies',               'IO 78 (Dallas key / RFID)'],
  ['driverName',         'String', '',         'server',        'server',                'Mapped from iButtonId'],
  // Accelerometer
  ['axisX',              'Number', 'mG',       'IO',            'all',                  'IO 17'],
  ['axisY',              'Number', 'mG',       'IO',            'all',                  'IO 18'],
  ['axisZ',              'Number', 'mG',       'IO',            'all',                  'IO 19'],
  // Sleep / status
  ['sleepMode',          'Number', '',         'IO',            'varies',               ''],
  ['deepSleep',          'Boolean','',         'IO',            'varies',               ''],
  ['gnssStatus',         'Number', '',         'IO',            'varies',               ''],
  ['eventType',          'String', '',         'IO',            'eventful',             'Human label derived from the triggering IO id'],
  ['alarmType',          'String', '',         'IO',            'eventful',             'Populated when an alarm IO fires'],
  ['ioElements',         'Map',    '',         'IO',            'all',                  'Raw catch-all: every IO id → value'],
  ['rawPacket',          'String', 'hex',      'raw',           'all',                  'Hex dump of incoming TCP bytes (debug)'],
  ['packetLength',       'Number', 'B',        'raw',           'all',                  ''],
];

// ─── GT06 ─────────────────────────────────────────────────────────────────────
// Sources: device-gt06/models/Location.js, device-gt06/index.js
const GT06 = [
  ['imei',               'String', '',         'login packet',  'all',                  'Primary device identifier'],
  ['deviceId',           'String', '',         'login packet',  'login',                'Terminal ID'],
  ['deviceModel',        'String', '',         'login packet',  'login',                ''],
  // GPS
  ['latitude',           'Number', 'deg',      'GPS packet',    'GPS',                  'Decimal degrees'],
  ['longitude',          'Number', 'deg',      'GPS packet',    'GPS',                  'Decimal degrees'],
  ['altitude',           'Number', 'm',        'GPS packet',    'GPS',                  ''],
  ['speed',              'Number', 'km/h',     'GPS packet',    'GPS',                  ''],
  ['course',             'Number', 'deg',      'GPS packet',    'GPS',                  '0–359'],
  ['heading',            'Number', 'deg',      'GPS packet',    'GPS',                  ''],
  ['satellites',         'Number', '',         'GPS packet',    'GPS',                  ''],
  ['hdop',               'Number', '',         'GPS packet',    'GPS',                  ''],
  ['gpsFixed',           'Boolean','',         'GPS packet',    'GPS',                  'Decoded from courseStatus bit 14 (inverted)'],
  // LBS
  ['mcc',                'Number', '',         'LBS/STATUS',    'varies',               ''],
  ['mnc',                'Number', '',         'LBS/STATUS',    'varies',               ''],
  ['lac',                'Number', '',         'LBS/STATUS',    'varies',               ''],
  ['cellId',             'Number', '',         'LBS/STATUS',    'varies',               ''],
  ['gsmSignal',          'Number', '',         'STATUS',        'varies',               ''],
  // WiFi
  ['wifiCount',          'Number', '',         'WiFi packet',   'rare',                 ''],
  ['wifiData',           'String', '',         'WiFi packet',   'rare',                 'Serialized APs'],
  // Timestamp
  ['timestamp',          'Date',   '',         'GPS/STATUS',    'all',                  'Device local time; server converts via GT06_TZ_OFFSET_MIN env'],
  ['timezoneOffset',     'Number', 'min',      'GPS packet',    'GPS',                  ''],
  // Metadata
  ['raw',                'String', 'hex',      'raw',           'all',                  ''],
  ['packetType',         'String', '',         'header',        'all',                  'LOGIN / GPS / STATUS / HEARTBEAT / ALARM …'],
  ['protocol',           'String', 'hex',      'header',        'all',                  'e.g. "0x12", "0x22"'],
  ['deviceType',         'String', '',         '',              'all',                  'GT06'],
  ['serialNumber',       'Number', '',         'header',        'all',                  ''],
  // Status flags
  ['acc',                'Boolean','',         'STATUS',        'STATUS',               'Ignition (ACC) on/off'],
  ['defense',            'Boolean','',         'STATUS',        'STATUS',               'Defense / immobilizer active'],
  ['charge',             'Boolean','',         'STATUS',        'STATUS',               'Device charging'],
  ['gpsTracking',        'Boolean','',         'STATUS',        'STATUS',               'GPS on/off'],
  ['oil',                'Boolean','',         'STATUS',        'STATUS',               'Oil/fuel CUT relay state (NOT fuel level)'],
  ['electric',           'Boolean','',         'STATUS',        'STATUS',               'Electric circuit CUT relay state'],
  ['door',               'Boolean','',         'STATUS',        'STATUS',               ''],
  // Alarms
  ['alarm',              'String', '',         'ALARM',         'alarm',                ''],
  ['alarmLanguage',      'String', '',         'ALARM',         'alarm',                ''],
  // Vehicle / device info
  ['mileage',            'Number', 'm',        'STATUS',        'varies',               'Trip mileage'],
  ['odometer',           'Number', 'km',       'STATUS/INFO',   'varies',               'Total odometer'],
  ['voltage',            'Number', 'V',        'STATUS',        'varies',               'External power'],
  ['batteryLevel',       'Number', '%',        'STATUS',        'STATUS',               'Internal battery %'],
  ['batteryVoltage',     'Number', 'V',        'STATUS',        'varies',               ''],
  // Terminal
  ['terminalInfo',       'Number', '',         'STATUS',        'STATUS',               'Raw byte holding acc/oil/electric bits'],
  ['languageIdentifier', 'Number', '',         'STATUS',        'varies',               ''],
  ['fuelLevel',          'Number', '%',        'vendor ext',    'rare',                 'Vendor extension; most GT06 firmware does NOT send this'],
  ['temperature',        'Number', '°C',       'vendor ext',    'rare',                 ''],
  ['positioningType',    'String', '',         'derived',       'all',                  "Computed: 'GPS' | 'LBS' | 'WIFI' | 'UNKNOWN'"],
  ['realTime',           'Boolean','',         'GPS packet',    'GPS',                  'courseStatus bit 15'],
];

// ─── Fuel comparison (one row per device) ─────────────────────────────────────
// Per product decision: fuel sensors are NOT supported on AIS140 or GT06 in
// our fleet. FMB125 is the only device family surfaced to fuel reports and
// fuel-theft alerts.
const FUEL_MATRIX = [
  ['AIS140',
    'No — out of scope',
    'ai1 / ai2 only (raw mV from analog inputs), and only on the legacy pipe parser. Production CSV parser discards these fields.',
    'Fleet devices do not have fuel-level sensors wired. AIS140 spec has no fuelLevel field.',
    'Not supported. Exclude AIS140 from fuel features.'],
  ['FMB125',
    'Yes',
    'fuelLevel (%), fuelUsed (L), fuelRate (L/h), fuelSensorVoltage (mV), canFuelLevel, canFuelUsed, analogInput1 (raw mV). Full schema support plus ioElements catch-all.',
    'Depends on how the device was configured at Teltonika Configurator — needs IO 48 or 87 (CAN) or an analog input enabled. Tank capacity is set in device config, not in packet.',
    'Ready to consume. Fuel reports + theft alerts run against fmb125locations directly.'],
  ['GT06',
    'No — out of scope',
    'fuelLevel field exists in the schema but GT06 firmware does not send it. oil boolean is a CUT-relay state, not fuel level.',
    'Fleet devices do not have fuel-level sensors wired.',
    'Not supported. Exclude GT06 from fuel features.'],
];

// ─── Build the workbook ───────────────────────────────────────────────────────

const HEADER_COLS = [
  { header: 'Attribute',        key: 'field',      width: 24 },
  { header: 'Type',             key: 'type',       width: 10 },
  { header: 'Unit',             key: 'unit',       width: 10 },
  { header: 'Parser / Source',  key: 'source',     width: 22 },
  { header: 'Populated By',     key: 'populated',  width: 22 },
  { header: 'Notes',            key: 'notes',      width: 90 },
];

function writeDeviceSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = HEADER_COLS;
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  ws.getRow(1).alignment = { vertical: 'middle' };

  rows.forEach((r, i) => {
    const [field, type, unit, source, populated, notes] = r;
    const row = ws.addRow({ field, type, unit, source, populated, notes });
    if (i % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }
    // Highlight rows where the field is NOT populated in production (critical gaps)
    if (/NOT populated|NOT populate|does NOT send|Tank capacity set in device/i.test(notes)) {
      row.getCell('notes').font = { color: { argb: 'FFB91C1C' } };
    }
  });
  ws.autoFilter = { from: 'A1', to: `F${rows.length + 1}` };
}

function writeSummarySheet(wb) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Device',              key: 'dev',    width: 12 },
    { header: 'Mongo Collection',    key: 'col',    width: 22 },
    { header: 'Wire Format',         key: 'fmt',    width: 36 },
    { header: 'Attribute Count',     key: 'cnt',    width: 18 },
    { header: 'Fuel Level Support',  key: 'fuel',   width: 20 },
    { header: 'Primary Source File', key: 'src',    width: 36 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  ws.addRow({ dev: 'AIS140', col: 'ais140locations', fmt: 'ASCII CSV ($...*) + legacy pipe',    cnt: AIS140.length, fuel: 'No',       src: 'device-ais140/parser.js' });
  ws.addRow({ dev: 'FMB125', col: 'fmb125locations', fmt: 'Binary (Codec 8 / 8E / 16)',         cnt: FMB125.length, fuel: 'Yes',      src: 'device-fmb125/index.js'  });
  ws.addRow({ dev: 'GT06',   col: 'gt06locations',   fmt: 'Binary (GT06 protocol, hex frames)', cnt: GT06.length,   fuel: 'Partial',  src: 'device-gt06/index.js'    });
}

function writeFuelSheet(wb) {
  const ws = wb.addWorksheet('Fuel Support', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Device',                   key: 'dev',   width: 12 },
    { header: 'Fuel Level?',              key: 'ok',    width: 14 },
    { header: 'Fields Available',         key: 'f',     width: 60 },
    { header: 'Known Limitations',        key: 'lim',   width: 60 },
    { header: 'To Enable / Fix',          key: 'fix',   width: 60 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  FUEL_MATRIX.forEach(r => {
    const [dev, ok, f, lim, fix] = r;
    const row = ws.addRow({ dev, ok, f, lim, fix });
    row.alignment = { vertical: 'top', wrapText: true };
    const okCell = row.getCell('ok');
    if (ok === 'Yes')     okCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    if (ok === 'No')      okCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    if (ok === 'Partial') okCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  });
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'driveinnovate';
  wb.created  = new Date();
  wb.subject  = 'Device attributes — AIS140, FMB125, GT06';

  writeSummarySheet(wb);
  writeDeviceSheet(wb, 'AIS140', AIS140);
  writeDeviceSheet(wb, 'FMB125', FMB125);
  writeDeviceSheet(wb, 'GT06',   GT06);
  writeFuelSheet(wb);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await wb.xlsx.writeFile(OUT_PATH);

  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  AIS140: ${AIS140.length} attributes`);
  console.log(`  FMB125: ${FMB125.length} attributes`);
  console.log(`  GT06:   ${GT06.length} attributes`);
}

main().catch(err => {
  console.error('Failed to generate workbook:', err);
  process.exit(1);
});
