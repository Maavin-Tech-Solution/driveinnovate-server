const vehicleReportService = require('../services/vehicleReport.service');
const { reprocessVehicle } = require('../services/packetProcessor.service');

/**
 * Parse a date/datetime string as IST and return the corresponding UTC Date.
 *
 * Accepts two formats sent by the UI:
 *   'YYYY-MM-DD'       → date-only (type="date" input)
 *   'YYYY-MM-DDTHH:MM' → datetime-local (type="datetime-local" input)
 *
 * By appending an explicit +05:30 offset we are timezone-safe regardless of
 * the server's local timezone (avoids ambiguity of bare datetime strings).
 *
 * @param {string}  val    - date or datetime string from the client
 * @param {boolean} isEnd  - if true and date-only, treat as 23:59:59.999 IST
 */
function parseISTValue(val, isEnd = false) {
  if (!val) return null;
  if (val.length === 10) {
    // Date-only: YYYY-MM-DD → IST midnight or end-of-day
    return new Date(val + (isEnd ? 'T23:59:59.999+05:30' : 'T00:00:00+05:30'));
  }
  // datetime-local: "YYYY-MM-DDTHH:MM" — append IST offset if none present
  const suffix = /[Z+\-]\d{2}:?\d{2}$/.test(val) ? '' : '+05:30';
  return new Date(val + suffix);
}

function parseRange(query) {
  if (query.from) {
    const from = parseISTValue(query.from, false);
    // For date-only "to" values add end-of-day; for datetime-local use exact time.
    const toIsDateOnly = query.to && query.to.length === 10;
    const to = query.to ? parseISTValue(query.to, toIsDateOnly) : new Date();
    console.log(`[Report] IST range: ${query.from}→${query.to || 'now'} → UTC: ${from.toISOString()} – ${to.toISOString()}`);
    return { from, to };
  }
  return { from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() };
}

function parseBodyRange(body) {
  const from = body.from
    ? parseISTValue(body.from, false)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toIsDateOnly = body.to && body.to.length === 10;
  const to = body.to ? parseISTValue(body.to, toIsDateOnly) : new Date();
  return { from, to };
}

exports.getSummary = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const data = await vehicleReportService.getSummary(req.params.id, from, to);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDailyStats = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const data = await vehicleReportService.getDailyStats(req.params.id, from, to);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEngineHours = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const limit  = parseInt(req.query.limit)  || 100;
    const offset = parseInt(req.query.offset) || 0;
    const data = await vehicleReportService.getEngineHours(req.params.id, from, to, limit, offset);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTrips = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const limit  = parseInt(req.query.limit)  || 100;
    const offset = parseInt(req.query.offset) || 0;
    const data = await vehicleReportService.getTrips(req.params.id, from, to, limit, offset);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getFuelFillings = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const data = await vehicleReportService.getFuelFillings(req.params.id, from, to);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.exportReport = async (req, res) => {
  try {
    const { type } = req.query;
    const { from, to } = parseRange(req.query);
    const id = req.params.id;

    let csv = '';
    let filename = `report_${Date.now()}.csv`;

    switch (type) {
      case 'summary': {
        const data = await vehicleReportService.getSummary(id, from, to);
        csv = vehicleReportService.summaryToCsv(data);
        filename = `summary_${id}_${Date.now()}.csv`;
        break;
      }
      case 'daily': {
        const data = await vehicleReportService.getDailyStats(id, from, to);
        csv = vehicleReportService.dailyToCsv(data);
        filename = `daily_${id}_${Date.now()}.csv`;
        break;
      }
      case 'engineHours': {
        const data = await vehicleReportService.getEngineHours(id, from, to, 10000, 0);
        csv = vehicleReportService.engineHoursToCsv(data);
        filename = `engine_hours_${id}_${Date.now()}.csv`;
        break;
      }
      case 'trips': {
        const data = await vehicleReportService.getTrips(id, from, to, 10000, 0);
        csv = vehicleReportService.tripsToCsv(data);
        filename = `trips_${id}_${Date.now()}.csv`;
        break;
      }
      case 'fuelFillings': {
        const data = await vehicleReportService.getFuelFillings(id, from, to);
        csv = vehicleReportService.fuelFillingsToCsv(data);
        filename = `fuel_fillings_${id}_${Date.now()}.csv`;
        break;
      }
      default:
        return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.exportExcel = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const id = req.params.id;
    const buffer = await vehicleReportService.exportAllToExcel(id, from, to);
    const vehicle = await require('../models').Vehicle.findByPk(id, { attributes: ['vehicleNumber'] });
    const name = vehicle?.vehicleNumber || id;
    const filename = `report_${name}_${req.query.from || 'all'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/:id/raw-packets?from=DATETIME&to=DATETIME[&fmt=csv|json|xlsx]
 *
 * Returns all raw MongoDB location packets for the vehicle in the given time window.
 * from/to accept both date-only ('YYYY-MM-DD') and datetime-local ('YYYY-MM-DDTHH:MM')
 * values — both interpreted as IST via parseISTValue().
 *
 * fmt=csv  (default) — CSV attachment
 * fmt=json           — JSON array
 * fmt=xlsx           — Excel workbook attachment (debug-friendly)
 */
exports.getRawPackets = async (req, res) => {
  try {
    const { Vehicle } = require('../models');
    const { getMongoDb } = require('../config/mongodb');

    if (!req.query.from || !req.query.to) {
      return res.status(400).json({ success: false, message: '`from` and `to` are required' });
    }

    const vehicle = await Vehicle.findByPk(req.params.id, {
      attributes: ['id', 'imei', 'vehicleNumber', 'deviceType'],
    });
    if (!vehicle || !vehicle.imei) {
      return res.status(404).json({ success: false, message: 'Vehicle not found or has no IMEI' });
    }

    // Use the same IST-aware parser as all other report endpoints
    const { from: fromDate, to: toDate } = parseRange(req.query);

    const imeis = [vehicle.imei];
    if (vehicle.imei.startsWith('0')) imeis.push(vehicle.imei.slice(1));
    else imeis.push('0' + vehicle.imei);

    const dtype = (vehicle.deviceType || '').toUpperCase();
    const collections = dtype.startsWith('FMB')
      ? [`${dtype.toLowerCase()}locations`]
      : dtype === 'GT06'
        ? ['gt06locations']
        : ['gt06locations', 'fmb125locations'];

    const db = getMongoDb();
    const docs = [];
    for (const colName of collections) {
      try {
        const cursor = db.collection(colName)
          .find({ imei: { $in: imeis }, timestamp: { $gte: fromDate, $lte: toDate } })
          .sort({ timestamp: 1 });
        for await (const doc of cursor) docs.push(doc);
      } catch (_) { /* collection may not exist */ }
    }

    const fmt = (req.query.fmt || 'csv').toLowerCase();
    const vnum = vehicle.vehicleNumber || req.params.id;
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const toISTStr = (d) => {
      if (!d) return '';
      return new Date(new Date(d).getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 19) + ' IST';
    };

    // Shared column definitions
    const COLS = [
      { key: 'timestamp',  label: 'Timestamp (IST)',  get: d => toISTStr(d.timestamp) },
      { key: 'packetType', label: 'Packet Type',       get: d => d.packetType || '' },
      { key: 'protocol',   label: 'Protocol',          get: d => d.protocol   || '' },
      { key: 'latitude',   label: 'Latitude',          get: d => d.latitude   ?? '' },
      { key: 'longitude',  label: 'Longitude',         get: d => d.longitude  ?? '' },
      { key: 'speed',      label: 'Speed (km/h)',      get: d => d.speed      ?? '' },
      { key: 'acc',        label: 'ACC/Ignition',      get: d => d.acc        != null ? String(d.acc) : '' },
      { key: 'gpsFixed',   label: 'GPS Fixed',         get: d => d.gpsFixed   != null ? String(d.gpsFixed) : '' },
      { key: 'satellites', label: 'Satellites',        get: d => d.satellites ?? '' },
      { key: 'course',     label: 'Course (°)',        get: d => d.course     ?? '' },
      { key: 'mcc',        label: 'MCC',               get: d => d.mcc        ?? '' },
      { key: 'mnc',        label: 'MNC',               get: d => d.mnc        ?? '' },
      { key: 'lac',        label: 'LAC',               get: d => d.lac        ?? '' },
      { key: 'cellId',     label: 'Cell ID',           get: d => d.cellId     ?? '' },
      { key: 'alarm',      label: 'Alarm',             get: d => d.alarm      || '' },
      { key: 'raw',        label: 'Raw Hex',           get: d => d.raw        || '' },
    ];

    if (fmt === 'json') {
      return res.json({ success: true, count: docs.length, data: docs });
    }

    if (fmt === 'xlsx') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'DriveInnovate';
      const ws = wb.addWorksheet('Packets');

      ws.columns = COLS.map(c => ({ header: c.label, key: c.key, width: 22 }));

      // Style header row
      const hdr = ws.getRow(1);
      hdr.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
        cell.alignment = { horizontal: 'center' };
      });

      for (const d of docs) {
        const row = {};
        for (const c of COLS) row[c.key] = c.get(d);
        ws.addRow(row);
      }

      // Freeze header, auto-filter
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + COLS.length)}1` };

      const filename = `packets_${vnum}_${req.query.from.slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const buf = await wb.xlsx.writeBuffer();
      return res.send(buf);
    }

    // ── CSV (default) ──
    const rows = [COLS.map(c => c.label).join(',')];
    for (const d of docs) {
      rows.push(COLS.map(c => `"${String(c.get(d)).replace(/"/g, '""')}"`).join(','));
    }
    const filename = `packets_${vnum}_${req.query.from.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.join('\r\n'));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.reprocess = async (req, res) => {
  try {
    if (!req.body.from || !req.body.to) {
      return res.status(400).json({ success: false, message: '`from` and `to` dates are required' });
    }
    const { from, to } = parseBodyRange(req.body);
    const result = await reprocessVehicle(req.params.id, from, to);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Background reprocess job queue (in-memory, keyed by vehicleId+range) ──────
// Jobs survive for 2 hours then are cleared.
const bgJobs = new Map(); // key: `${vehicleId}|${from}|${to}` → { status, startedAt, finishedAt, processed, error }
const JOB_TTL_MS = 2 * 60 * 60 * 1000;

function jobKey(vehicleId, from, to) {
  // Round "to" to the nearest minute so repeated calls for "now" reuse the same key
  const roundedTo = new Date(Math.floor(new Date(to).getTime() / 60000) * 60000).toISOString();
  return `${vehicleId}|${new Date(from).toISOString()}|${roundedTo}`;
}

exports.reprocessBg = (req, res) => {
  try {
    if (!req.body.from || !req.body.to) {
      return res.status(400).json({ success: false, message: '`from` and `to` dates are required' });
    }
    const { from, to } = parseBodyRange(req.body);
    const key = jobKey(req.params.id, from, to);

    const existing = bgJobs.get(key);
    if (existing && existing.status === 'running') {
      return res.json({ success: true, data: { status: 'running', startedAt: existing.startedAt } });
    }

    // Stale or no job — start fresh
    const job = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, processed: 0, error: null };
    bgJobs.set(key, job);

    // Fire-and-forget — no await
    reprocessVehicle(req.params.id, from, to)
      .then(result => {
        job.status    = 'done';
        job.processed = result.processed;
        job.finishedAt = new Date().toISOString();
        setTimeout(() => bgJobs.delete(key), JOB_TTL_MS);
      })
      .catch(err => {
        job.status = 'error';
        job.error  = err.message;
        job.finishedAt = new Date().toISOString();
      });

    res.json({ success: true, data: { status: 'running', startedAt: job.startedAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.reprocessStatus = (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const key = jobKey(req.params.id, from, to);
    const job = bgJobs.get(key);
    if (!job) return res.json({ success: true, data: { status: 'idle' } });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
