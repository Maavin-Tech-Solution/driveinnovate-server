/**
 * VehicleReport Service
 * Generates reports from pre-processed SQL data (not raw MongoDB).
 *
 * Report types (matching Excel sample sheets):
 *   summary        — Sheet 2: overall stats for the period
 *   daily          — Sheet 3: per-day breakdown
 *   engineHours    — Sheet 4: each ignition session
 *   trips          — Sheet 5: logical journeys
 *   fuelFillings   — Sheet 6: fill events
 */

const { Op, fn, col, literal } = require('sequelize');
const { Vehicle, VehicleEngineSession, VehicleFuelEvent, Trip, Stop } = require('../models');

// ─── helpers ─────────────────────────────────────────────────────────────────

// IST is UTC+5:30; shift UTC timestamps by this amount when bucketing by day
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function secsToHMS(secs) {
  if (!secs && secs !== 0) return '—';
  const s = Math.round(secs);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  // For durations >= 24 h show a human-readable days format to avoid
  // confusing values like "1294:16:03" for long-running open stops.
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function dateRange(from, to) {
  return { [Op.between]: [new Date(from), new Date(to)] };
}

/**
 * Find all PARKING stops that overlap the query window [from, to].
 * A stop overlaps if it started before `to` AND ended after `from`
 * (or is still open / endTime is null).
 * This correctly catches stops whose startTime is outside the window
 * but whose duration extends into it.
 */
function overlappingStopsWhere(vehicleId, from, to) {
  return {
    vehicleId,
    stopType: 'PARKING',
    startTime: { [Op.lt]: to },           // started before window ends
    [Op.or]: [
      { endTime: { [Op.gt]: from } },     // ended after window starts
      { endTime: null },                  // still open
    ],
  };
}

/**
 * Merge overlapping/duplicate parking stop intervals into non-overlapping
 * periods, clipped to [from, to].
 *
 * Returns an array of { s, e } (milliseconds) representing distinct parking
 * windows. Summing (e - s) gives the true parked duration without
 * double-counting stops that were created for the same physical period
 * (e.g. from spurious trips caused by GPS speed drift).
 */
function mergeStopIntervals(stops, from, to) {
  const fromMs = from.getTime();
  const toMs   = to.getTime();
  const nowMs  = Date.now();

  const intervals = stops
    .map(p => ({
      s: Math.max(new Date(p.startTime).getTime(), fromMs),
      e: p.endTime
        ? Math.min(new Date(p.endTime).getTime(), toMs)
        : Math.min(nowMs, toMs),
    }))
    .filter(i => i.e > i.s)
    .sort((a, b) => a.s - b.s);

  if (!intervals.length) return [];

  const merged = [];
  let { s: curS, e: curE } = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const { s, e } = intervals[i];
    if (s <= curE) { curE = Math.max(curE, e); }
    else { merged.push({ s: curS, e: curE }); curS = s; curE = e; }
  }
  merged.push({ s: curS, e: curE });
  return merged;
}

async function getVehicle(vehicleId) {
  return Vehicle.findByPk(vehicleId, {
    attributes: ['id', 'vehicleNumber', 'imei', 'deviceType'],
  });
}

// ─── 1. SUMMARY ──────────────────────────────────────────────────────────────
/**
 * Sheet 2: Overall statistics for a vehicle over the period.
 */
async function getSummary(vehicleId, from, to) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  const tripWhere = {
    [Op.or]: [
      { vehicleId },
      ...(vehicle.imei ? [{ imei: vehicle.imei }] : []),
    ],
    startTime: dateRange(from, to),
  };

  const [trips, sessions, parkingStops, fuelFills, fuelDrains] = await Promise.all([
    Trip.findAll({
      where: tripWhere,
      attributes: ['distance', 'duration', 'avgSpeed', 'maxSpeed', 'fuelConsumed'],
    }),
    VehicleEngineSession.findAll({
      where: { vehicleId, startTime: dateRange(from, to), status: 'completed' },
      attributes: ['durationSeconds'],
    }),
    Stop.findAll({
      where: overlappingStopsWhere(vehicleId, from, to),
      attributes: ['startTime', 'endTime', 'duration'],
    }),
    VehicleFuelEvent.findAll({
      where: { vehicleId, eventTime: dateRange(from, to), eventType: 'fill' },
      attributes: ['fuelChangePct'],
    }),
    VehicleFuelEvent.findAll({
      where: { vehicleId, eventTime: dateRange(from, to), eventType: 'drain' },
      attributes: ['fuelChangePct'],
    }),
  ]);

  const totalDistance = trips.reduce((s, t) => s + parseFloat(t.distance || 0), 0);
  const engineSecs = sessions.reduce((s, e) => s + (e.durationSeconds || 0), 0);
  const maxSpeed = trips.reduce((m, t) => Math.max(m, parseFloat(t.maxSpeed || 0)), 0);
  const speedTrips = trips.filter(t => parseFloat(t.avgSpeed) > 0);
  const avgSpeed = speedTrips.length
    ? speedTrips.reduce((s, t) => s + parseFloat(t.avgSpeed), 0) / speedTrips.length
    : 0;
  const mergedParking = mergeStopIntervals(parkingStops, from, to);
  const parkingSecs = mergedParking.reduce((s, i) => s + Math.floor((i.e - i.s) / 1000), 0);
  const totalFilled = fuelFills.reduce((s, f) => s + parseFloat(f.fuelChangePct || 0), 0);
  const totalDrained = fuelDrains.reduce((s, f) => s + parseFloat(f.fuelChangePct || 0), 0);
  const totalConsumed = trips.reduce((s, t) => s + parseFloat(t.fuelConsumed || 0), 0);

  return {
    unit: vehicle.vehicleNumber,
    imei: vehicle.imei,
    intervalBeginning: from,
    intervalEnd: to,
    mileage: parseFloat(totalDistance.toFixed(3)),
    engineHours: secsToHMS(engineSecs),
    engineHoursSecs: engineSecs,
    consumedByFls: parseFloat(totalConsumed.toFixed(2)),
    maxSpeedInTrips: parseFloat(maxSpeed.toFixed(2)),
    avgSpeedInTrips: parseFloat(avgSpeed.toFixed(6)),
    parkingTime: secsToHMS(parkingSecs),
    parkingTimeSecs: parkingSecs,
    parkingsCount: mergedParking.length,
    totalFilled: parseFloat(totalFilled.toFixed(2)),
    totalFillings: fuelFills.length,
    totalDrained: parseFloat(totalDrained.toFixed(2)),
    totalDrains: fuelDrains.length,
    tripsCount: trips.length,
  };
}

// ─── 2. DAILY STATISTICS ─────────────────────────────────────────────────────
/**
 * Sheet 3: Per-day breakdown (distance, engine hours, fuel, parking).
 */
async function getDailyStats(vehicleId, from, to) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  const tripWhere = {
    [Op.or]: [
      { vehicleId },
      ...(vehicle.imei ? [{ imei: vehicle.imei }] : []),
    ],
    startTime: dateRange(from, to),
  };

  const [trips, sessions, parkingStops, fills] = await Promise.all([
    Trip.findAll({ where: tripWhere, order: [['startTime', 'ASC']] }),
    VehicleEngineSession.findAll({ where: { vehicleId, startTime: dateRange(from, to), status: 'completed' }, order: [['startTime', 'ASC']] }),
    Stop.findAll({ where: overlappingStopsWhere(vehicleId, from, to), order: [['startTime', 'ASC']] }),
    VehicleFuelEvent.findAll({ where: { vehicleId, eventTime: dateRange(from, to), eventType: 'fill' }, order: [['eventTime', 'ASC']] }),
  ]);

  // Build day-keyed maps — bucket by IST calendar date, not UTC
  const dayMap = {};
  const dayKey = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const ensureDay = (key) => {
    if (!dayMap[key]) dayMap[key] = { date: key, distanceKm: 0, engineSecs: 0, parkingSecs: 0, parkingCount: 0, filled: 0, drained: 0, consFls: 0, fuelStart: null, fuelEnd: null };
  };

  trips.forEach(t => {
    const k = dayKey(t.startTime);
    ensureDay(k);
    dayMap[k].distanceKm += parseFloat(t.distance || 0);
    dayMap[k].consFls += parseFloat(t.fuelConsumed || 0);
  });
  sessions.forEach(e => {
    const k = dayKey(e.startTime);
    ensureDay(k);
    dayMap[k].engineSecs += e.durationSeconds || 0;
    if (dayMap[k].fuelStart === null) dayMap[k].fuelStart = parseFloat(e.startFuelLevel || 0);
    dayMap[k].fuelEnd = parseFloat(e.endFuelLevel ?? dayMap[k].fuelEnd ?? 0);
  });
  // Merge overlapping stops before distributing — prevents double-counting
  // when multiple stop rows cover the same parking period.
  mergeStopIntervals(parkingStops, from, to).forEach(({ s: stopStart, e: stopEnd }) => {
    // Distribute the merged interval across every IST calendar day it spans.
    let cursor = stopStart;
    let counted = false;
    while (cursor < stopEnd) {
      const istCursor   = new Date(cursor + IST_OFFSET_MS);
      const istDayStart = new Date(Date.UTC(
        istCursor.getUTCFullYear(), istCursor.getUTCMonth(), istCursor.getUTCDate()
      ) - IST_OFFSET_MS);
      const istDayEnd   = new Date(istDayStart.getTime() + 24 * 60 * 60 * 1000);

      const sliceStart = Math.max(cursor,     from.getTime(), istDayStart.getTime());
      const sliceEnd   = Math.min(stopEnd, to.getTime(),   istDayEnd.getTime());
      const sliceSecs  = Math.max(0, Math.floor((sliceEnd - sliceStart) / 1000));

      if (sliceSecs > 0) {
        const k = dayKey(sliceStart);
        ensureDay(k);
        dayMap[k].parkingSecs += sliceSecs;
        if (!counted) { dayMap[k].parkingCount += 1; counted = true; }
      }

      cursor = istDayEnd.getTime();
    }
  });
  fills.forEach(f => {
    const k = dayKey(f.eventTime);
    ensureDay(k);
    dayMap[k].filled += parseFloat(f.fuelChangePct || 0);
  });

  const days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  // Totals row
  const totals = days.reduce((acc, d) => {
    acc.distanceKm += d.distanceKm;
    acc.engineSecs += d.engineSecs;
    acc.parkingSecs += d.parkingSecs;
    acc.parkingCount += d.parkingCount;
    acc.filled += d.filled;
    acc.consFls += d.consFls;
    return acc;
  }, { distanceKm: 0, engineSecs: 0, parkingSecs: 0, parkingCount: 0, filled: 0, consFls: 0 });

  return {
    unit: vehicle.vehicleNumber,
    rows: days.map((d, i) => ({
      no: i + 1,
      date: d.date,
      distance: parseFloat(d.distanceKm.toFixed(3)),
      consFls: parseFloat(d.consFls.toFixed(2)),
      kmpl: d.consFls > 0 ? parseFloat((d.distanceKm / d.consFls).toFixed(2)) : null,
      parkingDuration: secsToHMS(d.parkingSecs),
      parkingCount: d.parkingCount,
      startFuelLevel: d.fuelStart,
      endFuelLevel: d.fuelEnd,
      filled: parseFloat(d.filled.toFixed(2)),
      engineHours: secsToHMS(d.engineSecs),
    })),
    totals: {
      distance: parseFloat(totals.distanceKm.toFixed(3)),
      consFls: parseFloat(totals.consFls.toFixed(2)),
      parkingDuration: secsToHMS(totals.parkingSecs),
      parkingCount: totals.parkingCount,
      filled: parseFloat(totals.filled.toFixed(2)),
      engineHours: secsToHMS(totals.engineSecs),
    },
  };
}

// ─── 3. ENGINE HOURS ─────────────────────────────────────────────────────────
/**
 * Sheet 4: Every individual ignition session.
 */
async function getEngineHours(vehicleId, from, to, limit = 500, offset = 0) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  const { count, rows: sessions } = await VehicleEngineSession.findAndCountAll({
    where: { vehicleId, startTime: dateRange(from, to) },
    order: [['startTime', 'ASC']],
    limit,
    offset,
  });

  // Totals
  const all = await VehicleEngineSession.findAll({
    where: { vehicleId, startTime: dateRange(from, to), status: 'completed' },
    attributes: ['durationSeconds', 'distanceKm', 'fuelConsumed', 'startFuelLevel', 'endFuelLevel', 'startTime', 'endTime'],
  });
  const totalSecs = all.reduce((s, e) => s + (e.durationSeconds || 0), 0);
  const totalDist = all.reduce((s, e) => s + parseFloat(e.distanceKm || 0), 0);
  const totalFuel = all.reduce((s, e) => s + parseFloat(e.fuelConsumed || 0), 0);

  return {
    unit: vehicle.vehicleNumber,
    total: count,
    rows: sessions.map((s, i) => ({
      no: offset + i + 1,
      beginning: s.startTime,
      end: s.endTime,
      startLocation: s.startLocation || `${s.startLatitude},${s.startLongitude}`,
      endLocation: s.endLocation || (s.endLatitude ? `${s.endLatitude},${s.endLongitude}` : '—'),
      engineHours: secsToHMS(s.durationSeconds),
      engineHoursSecs: s.durationSeconds,
      mileage: parseFloat(s.distanceKm || 0).toFixed(3),
      consFls: parseFloat(s.fuelConsumed || 0).toFixed(2),
      startFuelLevel: s.startFuelLevel,
      endFuelLevel: s.endFuelLevel,
    })),
    totals: {
      beginning: all[0]?.startTime,
      end: all[all.length - 1]?.endTime,
      engineHours: secsToHMS(totalSecs),
      mileage: parseFloat(totalDist.toFixed(3)),
      consFls: parseFloat(totalFuel.toFixed(2)),
    },
  };
}

// ─── 4. TRIPS ────────────────────────────────────────────────────────────────
/**
 * Sheet 5: Logical journeys.
 */
async function getTrips(vehicleId, from, to, limit = 200, offset = 0) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  // Match by vehicleId OR imei so trips are found even when the vehicle was
  // re-registered (new DB id, same IMEI) — avoids silently returning 0 rows
  // for a device that has trips stored under an older vehicleId.
  const tripWhere = {
    [Op.or]: [
      { vehicleId },
      ...(vehicle.imei ? [{ imei: vehicle.imei }] : []),
    ],
    startTime: dateRange(from, to),
  };

  const { count, rows: trips } = await Trip.findAndCountAll({
    where: tripWhere,
    order: [['startTime', 'ASC']],
    limit,
    offset,
  });

  const all = await Trip.findAll({
    where: tripWhere,
    attributes: ['distance', 'duration', 'maxSpeed', 'avgSpeed', 'fuelConsumed'],
  });
  const totalDist  = all.reduce((s, t) => s + parseFloat(t.distance || 0), 0);
  const totalSecs  = all.reduce((s, t) => s + (t.duration || 0), 0);
  const totalFuel  = all.reduce((s, t) => s + parseFloat(t.fuelConsumed || 0), 0);
  const maxSpd     = all.reduce((m, t) => Math.max(m, parseFloat(t.maxSpeed || 0)), 0);
  const speedTrips = all.filter(t => parseFloat(t.avgSpeed) > 0);
  const avgSpd     = speedTrips.length
    ? speedTrips.reduce((s, t) => s + parseFloat(t.avgSpeed), 0) / speedTrips.length : 0;

  return {
    unit: vehicle.vehicleNumber,
    total: count,
    rows: trips.map((t, i) => ({
      no: offset + i + 1,
      status: t.status || 'completed',
      beginning: t.startTime,
      end: t.endTime,
      startLocation: t.startLocation || `${t.startLatitude},${t.startLongitude}`,
      endLocation: t.endLocation || (t.endLatitude ? `${t.endLatitude},${t.endLongitude}` : '—'),
      duration: secsToHMS(t.duration),
      durationSecs: t.duration,
      mileage: parseFloat(t.distance || 0).toFixed(3),
      avgSpeed: parseFloat(t.avgSpeed || 0).toFixed(6),
      maxSpeed: parseFloat(t.maxSpeed || 0).toFixed(2),
      consFls: parseFloat(t.fuelConsumed || 0).toFixed(2),
      startFuelLevel: t.startFuelLevel ?? null,
      endFuelLevel: t.endFuelLevel ?? null,
    })),
    totals: {
      beginning: all[0]?.startTime,
      end: all[all.length - 1]?.endTime,
      duration: secsToHMS(totalSecs),
      mileage: parseFloat(totalDist.toFixed(3)),
      avgSpeed: parseFloat(avgSpd.toFixed(6)),
      maxSpeed: parseFloat(maxSpd.toFixed(2)),
      consFls: parseFloat(totalFuel.toFixed(2)),
    },
  };
}

// ─── 5. FUEL FILLINGS ────────────────────────────────────────────────────────
/**
 * Sheet 6: Fill events.
 */
async function getFuelFillings(vehicleId, from, to) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  const fills = await VehicleFuelEvent.findAll({
    where: { vehicleId, eventTime: dateRange(from, to), eventType: 'fill' },
    order: [['eventTime', 'ASC']],
  });

  const totalFilled = fills.reduce((s, f) => s + parseFloat(f.fuelChangePct || 0), 0);

  return {
    unit: vehicle.vehicleNumber,
    rows: fills.map((f, i) => ({
      no: i + 1,
      time: f.eventTime,
      location: f.location || (f.latitude ? `${f.latitude},${f.longitude}` : '—'),
      fuelBefore: parseFloat(f.fuelBefore || 0).toFixed(2),
      filled: parseFloat(f.fuelChangePct || 0).toFixed(2),
      fuelAfter: parseFloat(f.fuelAfter || 0).toFixed(2),
    })),
    totals: {
      fuelBefore: fills[0] ? parseFloat(fills[0].fuelBefore || 0).toFixed(2) : '—',
      filled: parseFloat(totalFilled.toFixed(2)),
      fuelAfter: fills.length ? parseFloat(fills[fills.length - 1].fuelAfter || 0).toFixed(2) : '—',
      count: fills.length,
    },
  };
}

// ─── EXCEL EXPORT (all sheets in one workbook) ───────────────────────────────

const ExcelJS = require('exceljs');

const EXCEL_IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30 (local alias for Excel helpers)

/** Convert UTC Date to IST-shifted Date for Excel cell display */
function toIST(d) {
  if (!d) return '';
  return new Date(new Date(d).getTime() + EXCEL_IST_OFFSET_MS);
}

/** Format UTC date as readable IST string */
function fmtIST(d) {
  if (!d) return '';
  return toIST(d).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
}

function styleHeader(row, fillColor = '1e3a5f') {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + fillColor } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD0D7DE' } },
    };
  });
}

function styleTotals(row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2d5ba3' } };
  });
}

function autoWidth(sheet, minWidth = 10) {
  sheet.columns.forEach(col => {
    let max = minWidth;
    col.eachCell({ includeEmpty: false }, cell => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 50);
  });
}

/**
 * Build a complete Excel workbook with one sheet per report type.
 * Returns a Buffer ready to send as HTTP response.
 */
async function exportAllToExcel(vehicleId, from, to) {
  const [summary, daily, engineHours, trips, fuelFillings] = await Promise.all([
    getSummary(vehicleId, from, to),
    getDailyStats(vehicleId, from, to),
    getEngineHours(vehicleId, from, to, 10000, 0),
    getTrips(vehicleId, from, to, 10000, 0),
    getFuelFillings(vehicleId, from, to),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DriveInnovate';
  wb.created = new Date();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const s1 = wb.addWorksheet('Summary');
  s1.columns = [{ width: 36 }, { width: 28 }];
  const h1 = s1.addRow(['Field', 'Value']);
  styleHeader(h1);
  const summaryRows = [
    ['Unit', summary.unit],
    ['IMEI', summary.imei],
    ['Interval Beginning (IST)', fmtIST(summary.intervalBeginning)],
    ['Interval End (IST)', fmtIST(summary.intervalEnd)],
    ['Mileage (km)', summary.mileage],
    ['Engine Hours', summary.engineHours],
    ['Max Speed in Trips (km/h)', summary.maxSpeedInTrips],
    ['Avg Speed in Trips (km/h)', summary.avgSpeedInTrips],
    ['Parking Time', summary.parkingTime],
    ['Parkings Count', summary.parkingsCount],
    ['Trips Count', summary.tripsCount],
    ['Total Fuel Filled', summary.totalFilled],
    ['Total Fillings', summary.totalFillings],
    ['Total Fuel Drained', summary.totalDrained],
    ['Total Drains', summary.totalDrains],
  ];
  summaryRows.forEach(r => s1.addRow(r));

  // ── Sheet 2: Daily Stats ──────────────────────────────────────────────────
  const s2 = wb.addWorksheet('Daily Stats');
  const h2 = s2.addRow(['No.', 'Date (IST)', 'Distance (km)', 'Engine Hours', 'Parking Duration', 'Parking Count', 'Cons FLS', 'KMPL', 'Fuel Start', 'Fuel End', 'Filled']);
  styleHeader(h2);
  daily.rows.forEach(r => s2.addRow([r.no, r.date, r.distance, r.engineHours, r.parkingDuration, r.parkingCount, r.consFls, r.kmpl ?? '', r.startFuelLevel ?? '', r.endFuelLevel ?? '', r.filled]));
  const dt = daily.totals;
  styleTotals(s2.addRow(['—', 'TOTAL', dt.distance, dt.engineHours, dt.parkingDuration, dt.parkingCount, dt.consFls, '', '', '', dt.filled]));
  autoWidth(s2);

  // ── Sheet 3: Engine Hours ─────────────────────────────────────────────────
  const s3 = wb.addWorksheet('Engine Hours');
  const h3 = s3.addRow(['No.', 'Beginning (IST)', 'End (IST)', 'Engine Hours', 'Distance (km)', 'Initial Location', 'Final Location', 'Start Fuel', 'End Fuel', 'Cons FLS']);
  styleHeader(h3);
  engineHours.rows.forEach(r => s3.addRow([r.no, fmtIST(r.beginning), fmtIST(r.end), r.engineHours, r.mileage, r.startLocation, r.endLocation, r.startFuelLevel ?? '', r.endFuelLevel ?? '', r.consFls]));
  const et = engineHours.totals;
  styleTotals(s3.addRow(['—', fmtIST(et.beginning), fmtIST(et.end), et.engineHours, et.mileage, '', '', '', '', et.consFls]));
  autoWidth(s3);

  // ── Sheet 4: Trips ────────────────────────────────────────────────────────
  const s4 = wb.addWorksheet('Trips');
  const h4 = s4.addRow(['No.', 'Beginning (IST)', 'End (IST)', 'Duration', 'Distance (km)', 'Avg Speed (km/h)', 'Max Speed (km/h)', 'Initial Location', 'Final Location', 'Cons FLS']);
  styleHeader(h4);
  trips.rows.forEach(r => s4.addRow([r.no, fmtIST(r.beginning), fmtIST(r.end), r.duration, r.mileage, r.avgSpeed, r.maxSpeed, r.startLocation, r.endLocation, r.consFls]));
  const tt = trips.totals;
  styleTotals(s4.addRow(['—', fmtIST(tt.beginning), fmtIST(tt.end), tt.duration, tt.mileage, tt.avgSpeed, tt.maxSpeed, '', '', tt.consFls]));
  autoWidth(s4);

  // ── Sheet 5: Fuel Fillings ────────────────────────────────────────────────
  const s5 = wb.addWorksheet('Fuel Fillings');
  const h5 = s5.addRow(['No.', 'Time (IST)', 'Location', 'Fuel Before', 'Filled', 'Fuel After']);
  styleHeader(h5);
  fuelFillings.rows.forEach(r => s5.addRow([r.no, fmtIST(r.time), r.location, r.fuelBefore, r.filled, r.fuelAfter]));
  const ft = fuelFillings.totals;
  styleTotals(s5.addRow(['—', '—', '—', ft.fuelBefore, ft.filled, ft.fuelAfter]));
  autoWidth(s5);

  return wb.xlsx.writeBuffer();
}

// ─── CSV EXPORTERS ───────────────────────────────────────────────────────────

function csvRow(cells) {
  return cells.map(c => {
    const v = c === null || c === undefined ? '' : String(c);
    return v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  }).join(',');
}

function summaryToCsv(data) {
  const rows = [
    ['Field', 'Value'],
    ['Unit', data.unit],
    ['IMEI', data.imei],
    ['Interval Beginning', data.intervalBeginning],
    ['Interval End', data.intervalEnd],
    ['Mileage (km)', data.mileage],
    ['Engine Hours', data.engineHours],
    ['Consumed by FLS', data.consumedByFls],
    ['Max. Speed in Trips (km/h)', data.maxSpeedInTrips],
    ['Average Speed in Trips (km/h)', data.avgSpeedInTrips],
    ['Parking Time', data.parkingTime],
    ['Parkings Count', data.parkingsCount],
    ['Total Filled', data.totalFilled],
    ['Total Fillings', data.totalFillings],
    ['Total Drained', data.totalDrained],
    ['Total Drains', data.totalDrains],
  ];
  return rows.map(csvRow).join('\n');
}

function dailyToCsv(data) {
  const header = csvRow(['No.', 'Date', 'Distance (km)', 'Cons FLS', 'KMPL', 'Parking Duration', 'Parking Count', 'Start Fuel Level', 'End Fuel Level', 'Filled', 'Engine Hours']);
  const rows = data.rows.map(r => csvRow([r.no, r.date, r.distance, r.consFls, r.kmpl ?? '-----', r.parkingDuration, r.parkingCount, r.startFuelLevel, r.endFuelLevel, r.filled, r.engineHours]));
  const total = csvRow(['-----', 'Total', data.totals.distance, data.totals.consFls, '', data.totals.parkingDuration, data.totals.parkingCount, '', '', data.totals.filled, data.totals.engineHours]);
  return [header, ...rows, total].join('\n');
}

function engineHoursToCsv(data) {
  const header = csvRow(['No.', 'Beginning', 'End', 'Initial Location', 'Final Location', 'Engine Hours', 'Mileage (km)', 'Cons FLS', 'Initial Fuel Level', 'Final Fuel Level']);
  const rows = data.rows.map(r => csvRow([r.no, r.beginning, r.end, r.startLocation, r.endLocation, r.engineHours, r.mileage, r.consFls, r.startFuelLevel, r.endFuelLevel]));
  const t = data.totals;
  const total = csvRow(['-----', t.beginning, t.end, '', '', t.engineHours, t.mileage, t.consFls, '', '']);
  return [header, ...rows, total].join('\n');
}

function tripsToCsv(data) {
  const header = csvRow(['No.', 'Beginning', 'End', 'Initial Location', 'Final Location', 'Duration', 'Mileage (km)', 'Avg Speed (km/h)', 'Max Speed (km/h)', 'Cons FLS', 'Initial Fuel Level', 'Final Fuel Level']);
  const rows = data.rows.map(r => csvRow([r.no, r.beginning, r.end, r.startLocation, r.endLocation, r.duration, r.mileage, r.avgSpeed, r.maxSpeed, r.consFls, r.startFuelLevel, r.endFuelLevel]));
  const t = data.totals;
  const total = csvRow(['-----', t.beginning, t.end, '', '', t.duration, t.mileage, t.avgSpeed, t.maxSpeed, t.consFls, '', '']);
  return [header, ...rows, total].join('\n');
}

function fuelFillingsToCsv(data) {
  const header = csvRow(['No.', 'Time', 'Location', 'Fuel Before Filling', 'Filled', 'Final Fuel Level']);
  const rows = data.rows.map(r => csvRow([r.no, r.time, r.location, r.fuelBefore, r.filled, r.fuelAfter]));
  const t = data.totals;
  const total = csvRow(['-----', '-----', '-----', t.fuelBefore, t.filled, t.fuelAfter]);
  return [header, ...rows, total].join('\n');
}

// ─── 6. FUEL TIME-SERIES REPORT ──────────────────────────────────────────────
/**
 * Fuel-level readings over time for a single vehicle.
 *
 * FMB-only — AIS140 and GT06 do not report fuel level in our fleet. Vehicle
 * must have fuelSupported=true and a non-null fuelTankCapacity. Data is read
 * from fmb125locations, filtered to points that actually carry a fuelLevel.
 *
 * If the range is dense (>MAX_POINTS) the series is downsampled by striding,
 * which keeps wall-clock transfer cost bounded while preserving shape.
 * Consumers that need the raw packets can query the Debug → Packet Explorer.
 */
const MAX_FUEL_POINTS = 1000;

async function getFuelReport(vehicleId, from, to) {
  // Lazy-load to avoid circular imports during bootstrap (models pull in
  // sequelize, which pulls in config, which re-imports services in dev).
  const { FMB125Location } = require('../config/mongodb');
  const { Vehicle } = require('../models');

  const vehicle = await Vehicle.findByPk(vehicleId);
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  if (!vehicle.fuelSupported) {
    return {
      unit: vehicle.vehicleNumber,
      supported: false,
      message: 'Fuel sensor not configured for this vehicle. Enable "Fuel sensor wired" in Edit Vehicle and set the tank capacity.',
      summary: null,
      readings: [],
    };
  }
  const tankCapacity = parseInt(vehicle.fuelTankCapacity, 10) || null;

  const imei     = String(vehicle.imei || '').trim();
  const imeiVars = imei ? [imei, imei.replace(/^0+/, ''), '0' + imei].filter(Boolean) : [];

  const raw = await FMB125Location.find({
    imei: { $in: imeiVars },
    timestamp: { $gte: new Date(from), $lte: new Date(to) },
    fuelLevel: { $exists: true, $ne: null },
  })
    .sort({ timestamp: 1 })
    .select('timestamp fuelLevel ignition speed latitude longitude')
    .lean();

  if (raw.length === 0) {
    return {
      unit: vehicle.vehicleNumber,
      supported: true,
      tankCapacity,
      summary: { count: 0, startPct: null, endPct: null, minPct: null, maxPct: null, totalDrop: 0, totalFill: 0 },
      readings: [],
    };
  }

  // Downsample for UI transfer — keep the first and last points, stride the rest.
  const stride = Math.max(1, Math.ceil(raw.length / MAX_FUEL_POINTS));
  const readings = [];
  for (let i = 0; i < raw.length; i += stride) readings.push(raw[i]);
  if (readings[readings.length - 1] !== raw[raw.length - 1]) readings.push(raw[raw.length - 1]);

  // Summary metrics are computed off the FULL raw series (not the downsampled
  // one) so min/max and drop/fill totals are accurate regardless of stride.
  let minPct = Infinity;
  let maxPct = -Infinity;
  let totalDrop = 0;
  let totalFill = 0;
  for (let i = 0; i < raw.length; i++) {
    const lvl = raw[i].fuelLevel;
    if (lvl < minPct) minPct = lvl;
    if (lvl > maxPct) maxPct = lvl;
    if (i > 0) {
      const delta = lvl - raw[i - 1].fuelLevel;
      if (delta > 0) totalFill += delta;
      else           totalDrop += -delta;
    }
  }

  const toL = (pct) => (tankCapacity && pct != null ? (pct / 100) * tankCapacity : null);

  return {
    unit: vehicle.vehicleNumber,
    supported: true,
    tankCapacity,
    summary: {
      count: raw.length,
      startPct: raw[0].fuelLevel,
      endPct:   raw[raw.length - 1].fuelLevel,
      minPct,
      maxPct,
      totalDrop,
      totalFill,
      startL: toL(raw[0].fuelLevel),
      endL:   toL(raw[raw.length - 1].fuelLevel),
      totalDropL: toL(totalDrop),
      totalFillL: toL(totalFill),
    },
    readings: readings.map(r => ({
      timestamp: r.timestamp,
      levelPct:  r.fuelLevel,
      levelL:    toL(r.fuelLevel),
      ignition:  r.ignition ?? null,
      speed:     r.speed    ?? null,
      lat:       r.latitude  ?? null,
      lng:       r.longitude ?? null,
    })),
  };
}

module.exports = {
  getSummary,
  getDailyStats,
  getEngineHours,
  getTrips,
  getFuelFillings,
  getFuelReport,
  exportAllToExcel,
  summaryToCsv,
  dailyToCsv,
  engineHoursToCsv,
  tripsToCsv,
  fuelFillingsToCsv,
};
