/**
 * Generates docs/vehicle-states.xlsx — the canonical reference for what each
 * state means and which condition fires it. Mirrors the seed data in
 * server/src/services/master.service.js.
 *
 * Re-run after any change to that seed file:
 *   cd server && node scripts/gen-vehicle-states.js
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const ExcelJS = require('exceljs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const OUT_PATH  = path.join(REPO_ROOT, 'docs', 'vehicle-states.xlsx');

// ─── State spec (applied identically to every device type) ──────────────────
// Tuple shape: [priority, name, color, icon, conditionLogic, condition-summary, raw-conditions, notes]
const COMMON_STATES = [
  [10, 'Offline',  '#64748B', '📵',
    'AND',
    'No packet received in the last 2 minutes',
    'lastSeenSeconds > 120',
    'Stops the rest of the rules from firing on stale data.'],

  [20, 'Speeding', '#DC2626', '🏎️',
    'AND',
    'Current speed at or above the threshold',
    'speed >= 80',
    'Threshold default 80 km/h; editable per device type via Master Settings.'],

  [30, 'Running',  '#16A34A', '🟢',
    'AND',
    'Speed > 5 km/h in the last 3 packets continuously',
    'runningStreak >= 3',
    'runningStreak is incremented on each packet whose speed > 5 and reset to 0 otherwise. Requires 3 in a row to avoid flapping on momentary speed bumps.'],

  [40, 'Idle',     '#D97706', '⏸️',
    'AND',
    'Engine ON and speed = 0 for at least 4 minutes',
    'ignition = true AND speedZeroSeconds >= 240',
    'Industry-standard meaning: engine running but stationary (e.g. waiting at a customer site, AC running). Wastes fuel.'],

  [50, 'Stopped',  '#EF4444', '🔴',
    'AND',
    'Engine OFF for at least 5 minutes',
    'ignition = false AND ignitionOffSeconds >= 300',
    'Industry-standard meaning: vehicle is parked. The 5-minute buffer matches the user spec — the very brief window right after ignition-off (0–5 min) falls through to Online unless customised.'],

  [99, 'Online',  '#0EA5E9', '🌐',
    'AND',
    'Default fallback — device online but no other rule has matched',
    '(no conditions, isDefault = true)',
    'Anything not Offline is online. Briefly visible right after ignition-off (Stopped buffer) or while the runningStreak is building up.'],
];

// ─── Required fields (consumed by the evaluator) ──────────────────────────────
const REQUIRED_FIELDS = [
  // [field, source, surfacedBy, notes]
  ['lastSeenSeconds',     'derived', 'attachComprehensiveStatus computes `(now - state.lastPacketTime)/1000`',
    'Already in place. Drives Offline.'],
  ['speed',               'live packet', 'gpsData.speed',
    'Already in place. Drives Speeding.'],
  ['ignition',            'live state', 'state.engineOn',
    'Already in place. Used by Idle and Stopped.'],
  ['ignitionOffSeconds',  'NEW derived', 'attachComprehensiveStatus = `(now - state.engineOffSince)/1000`',
    'Drives Stopped duration. engineOffSince already tracked by packetProcessor.'],
  ['speedZeroSeconds',    'NEW tracked', 'attachComprehensiveStatus = `(now - state.speedZeroSince)/1000`',
    'Drives Idle duration. NEW column on vehicle_device_states (set when speed first becomes 0; cleared when speed > 0).'],
  ['runningStreak',       'NEW tracked', 'state.runningStreak',
    'Drives Running. NEW column on vehicle_device_states (incremented on packets with speed > 5; reset to 0 otherwise).'],
];

// ─── Workbook construction ────────────────────────────────────────────────────

function writeSummary(wb, allStates) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Priority',        key: 'pr',    width: 10 },
    { header: 'State',           key: 'st',    width: 14 },
    { header: 'Color',           key: 'co',    width: 10 },
    { header: 'Icon',            key: 'ic',    width: 7  },
    { header: 'Logic',           key: 'lg',    width: 8  },
    { header: 'When it fires',   key: 'when',  width: 50 },
    { header: 'Raw conditions',  key: 'raw',   width: 50 },
    { header: 'Notes',           key: 'notes', width: 70 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };

  allStates.forEach(([pr, st, co, ic, lg, when, raw, notes], i) => {
    const row = ws.addRow({ pr, st, co, ic, lg, when, raw, notes });
    row.alignment = { vertical: 'top', wrapText: true };
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    // Color swatch on the Color column
    row.getCell('co').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + co.replace('#', '') } };
    row.getCell('co').font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });
  ws.autoFilter = { from: 'A1', to: `H${allStates.length + 1}` };
}

function writeDeviceSheet(wb, name, states) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Priority',     key: 'pr',   width: 10 },
    { header: 'State',        key: 'st',   width: 14 },
    { header: 'Color',        key: 'co',   width: 10 },
    { header: 'Icon',         key: 'ic',   width: 7  },
    { header: 'When it fires',key: 'when', width: 50 },
    { header: 'Raw',          key: 'raw',  width: 50 },
    { header: 'Notes',        key: 'notes',width: 60 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  states.forEach(([pr, st, co, ic, _lg, when, raw, notes], i) => {
    const row = ws.addRow({ pr, st, co, ic, when, raw, notes });
    row.alignment = { vertical: 'top', wrapText: true };
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    row.getCell('co').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + co.replace('#', '') } };
    row.getCell('co').font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });
}

function writeFieldsSheet(wb) {
  const ws = wb.addWorksheet('Required Fields', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Condition Field',  key: 'f',     width: 22 },
    { header: 'Source',           key: 's',     width: 16 },
    { header: 'How it is surfaced', key: 'how', width: 60 },
    { header: 'Notes',            key: 'notes', width: 60 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  REQUIRED_FIELDS.forEach((r, i) => {
    const [f, s, how, notes] = r;
    const row = ws.addRow({ f, s, how, notes });
    row.alignment = { vertical: 'top', wrapText: true };
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    if (s.startsWith('NEW')) row.getCell('s').font = { color: { argb: 'FFB91C1C' }, bold: true };
  });
}

function writeChangesSheet(wb) {
  const ws = wb.addWorksheet('Changes from Old Spec', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Old',              key: 'old',  width: 36 },
    { header: 'New',              key: 'new',  width: 36 },
    { header: 'Reason',           key: 'r',    width: 60 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  const rows = [
    ['No Signal — lastSeenSeconds > 900 (15 min)', 'Offline — lastSeenSeconds > 120 (2 min)',
      'Tighter offline detection. Renamed for clarity.'],
    ['Overspeed — speed >= 80',                     'Speeding — speed >= 80',
      'Renamed only. Threshold unchanged; still editable per device.'],
    ['Running — ignition=true AND speed >= 5',      'Running — runningStreak >= 3',
      'Requires 3 consecutive packets above 5 km/h to avoid flapping on momentary speed bumps.'],
    ['Idle — ignition=true AND speed < 5',          'Idle — ignition=true AND speedZeroSeconds >= 240 (4 min)',
      'Standard semantics (engine ON, stationary). Now requires 4 min of zero speed before firing.'],
    ['Stopped — ignition=false',                    'Stopped — ignition=false AND ignitionOffSeconds >= 300 (5 min)',
      'Adds the 5-min buffer per spec. Brief window right after ignition-off shows Online.'],
    ['No GPS / Emergency / Unknown',                '(removed — out of scope)',
      'Trimmed to the six states defined by the user. Easy to reintroduce via Master Settings.'],
    ['(none — implicit)',                            'Online — fallback default',
      'Online fires whenever the device is reachable but no other rule has matched yet.'],
  ];
  rows.forEach((r, i) => {
    const [oldV, newV, reason] = r;
    const row = ws.addRow({ old: oldV, new: newV, r: reason });
    row.alignment = { vertical: 'top', wrapText: true };
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  });
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'driveinnovate';
  wb.created  = new Date();
  wb.subject  = 'Vehicle state definitions — applied across AIS140, FMB125, GT06';

  // Same six-state spec applies to every device type.
  writeSummary(wb, COMMON_STATES);
  writeDeviceSheet(wb, 'GT06',   COMMON_STATES);
  writeDeviceSheet(wb, 'FMB125', COMMON_STATES);
  writeDeviceSheet(wb, 'AIS140', COMMON_STATES);

  writeFieldsSheet(wb);
  writeChangesSheet(wb);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  States per device: ${COMMON_STATES.length}`);
}

main().catch(err => {
  console.error('Failed to generate workbook:', err);
  process.exit(1);
});
