const vehicleReportService = require('../services/vehicleReport.service');
const { reprocessVehicle } = require('../services/packetProcessor.service');

// IST is UTC+5:30 = 330 minutes ahead of UTC
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Parse a 'YYYY-MM-DD' date string as an IST calendar day and return
 * the corresponding UTC boundary times for database queries.
 *
 * 'YYYY-MM-DD' from date picker is always IST midnight (00:00 IST).
 *   IST midnight  = UTC midnight − 5h30m → subtract IST_OFFSET_MS
 * For the "to" date we want end-of-day IST (23:59:59.999 IST):
 *   IST EoD       = IST midnight + 24h − 1ms
 */
function parseRange(query) {
  if (query.from) {
    // new Date('YYYY-MM-DD') gives UTC midnight; subtract offset → IST midnight in UTC
    const from = new Date(new Date(query.from).getTime() - IST_OFFSET_MS);
    const to   = query.to
      ? new Date(new Date(query.to).getTime() - IST_OFFSET_MS + 24 * 60 * 60 * 1000 - 1)
      : new Date();
    console.log(`[Report] IST range: ${query.from}→${query.to || 'now'} → UTC: ${from.toISOString()} – ${to.toISOString()}`);
    return { from, to };
  }
  // Default: last 7 days
  return {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to:   new Date(),
  };
}

/**
 * Same IST-aware conversion for reprocess (from request body).
 */
function parseBodyRange(body) {
  const from = body.from
    ? new Date(new Date(body.from).getTime() - IST_OFFSET_MS)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = body.to
    ? new Date(new Date(body.to).getTime() - IST_OFFSET_MS + 24 * 60 * 60 * 1000 - 1)
    : new Date();
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
