const { Op } = require('sequelize');
const { VehicleGroup, VehicleGroupMember, Vehicle, Trip } = require('../models');

// IST is UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Convert a 'YYYY-MM-DD' IST date string into a UTC Date range that covers
 * the full IST calendar day, matching the same logic used by vehicleReport.controller.
 * new Date('2026-03-23') = 2026-03-23T00:00:00Z (UTC midnight = 05:30 IST).
 * Subtract IST offset → 2026-03-22T18:30:00Z = IST midnight 00:00.
 */
function parseISTRange(from, to) {
  const fromDate = new Date(new Date(from).getTime() - IST_OFFSET_MS);
  const toDate   = new Date(new Date(to).getTime()   - IST_OFFSET_MS + 24 * 60 * 60 * 1000 - 1);
  return { fromDate, toDate };
}

const getGroups = async (clientId) => {
  return VehicleGroup.findAll({
    where: { clientId },
    include: [
      {
        model: Vehicle,
        as: 'vehicles',
        attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon', 'status'],
        through: { attributes: [] },
      },
    ],
    order: [['name', 'ASC']],
  });
};

const getGroupById = async (id, clientId) => {
  const group = await VehicleGroup.findOne({
    where: { id, clientId },
    include: [
      {
        model: Vehicle,
        as: 'vehicles',
        attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon', 'status', 'imei', 'deviceType'],
        through: { attributes: [] },
      },
    ],
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  return group;
};

const createGroup = async (clientId, { name, description, color }) => {
  return VehicleGroup.create({
    clientId,
    name: name.trim(),
    description: description || null,
    color: color || '#3b82f6',
  });
};

const updateGroup = async (id, clientId, { name, description, color }) => {
  const group = await VehicleGroup.findOne({ where: { id, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  await group.update({
    name: name ? name.trim() : group.name,
    description: description !== undefined ? description : group.description,
    color: color || group.color,
  });
  return group;
};

const deleteGroup = async (id, clientId) => {
  const group = await VehicleGroup.findOne({ where: { id, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  await VehicleGroupMember.destroy({ where: { groupId: id } });
  await group.destroy();
  return { message: 'Group deleted successfully' };
};

const addVehicleToGroup = async (groupId, clientId, vehicleId) => {
  const group = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const [member, created] = await VehicleGroupMember.findOrCreate({
    where: { groupId, vehicleId },
  });
  if (!created) {
    const err = new Error('Vehicle is already in this group');
    err.status = 409;
    throw err;
  }
  return member;
};

const removeVehicleFromGroup = async (groupId, clientId, vehicleId) => {
  const group = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  const deleted = await VehicleGroupMember.destroy({ where: { groupId, vehicleId } });
  if (!deleted) {
    const err = new Error('Vehicle is not in this group');
    err.status = 404;
    throw err;
  }
  return { message: 'Vehicle removed from group successfully' };
};

/**
 * Aggregate summary report for all vehicles in a group over a date range.
 * Queries the trips table for totals.
 */
const getGroupReportSummary = async (id, clientId, from, to) => {
  const group = await VehicleGroup.findOne({
    where: { id, clientId },
    include: [{ model: Vehicle, as: 'vehicles', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'], through: { attributes: [] } }],
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const vehicleIds = group.vehicles.map((v) => v.id);

  if (vehicleIds.length === 0) {
    return {
      group: { id: group.id, name: group.name, color: group.color },
      vehicles: [],
      totals: { vehicleCount: 0, tripCount: 0, totalDistance: 0, totalDuration: 0, totalFuel: 0, maxSpeed: 0, avgSpeed: 0 },
      perVehicle: [],
    };
  }

  const { fromDate, toDate } = parseISTRange(from, to);

  // Get per-vehicle trip aggregates
  const perVehicle = await Promise.all(
    group.vehicles.map(async (v) => {
      const trips = await Trip.findAll({
        where: { vehicleId: v.id, startTime: { [Op.between]: [fromDate, toDate] } },
        attributes: ['id', 'distance', 'duration', 'avgSpeed', 'maxSpeed', 'fuelConsumed', 'startTime', 'endTime'],
      });
      const totDist = trips.reduce((s, t) => s + Number(t.distance || 0), 0);
      const totDur = trips.reduce((s, t) => s + Number(t.duration || 0), 0);
      const totFuel = trips.reduce((s, t) => s + Number(t.fuelConsumed || 0), 0);
      const mxSpeed = trips.reduce((m, t) => Math.max(m, Number(t.maxSpeed || 0)), 0);
      const avgSpd = trips.length > 0 ? trips.reduce((s, t) => s + Number(t.avgSpeed || 0), 0) / trips.length : 0;
      return {
        vehicleId: v.id,
        vehicleNumber: v.vehicleNumber,
        vehicleName: v.vehicleName,
        vehicleIcon: v.vehicleIcon,
        tripCount: trips.length,
        totalDistance: Math.round(totDist * 10) / 10,
        totalDuration: totDur,
        totalFuel: Math.round(totFuel * 10) / 10,
        maxSpeed: Math.round(mxSpeed * 10) / 10,
        avgSpeed: Math.round(avgSpd * 10) / 10,
      };
    })
  );

  const totals = perVehicle.reduce(
    (acc, pv) => ({
      vehicleCount: group.vehicles.length,
      tripCount: acc.tripCount + pv.tripCount,
      totalDistance: Math.round((acc.totalDistance + pv.totalDistance) * 10) / 10,
      totalDuration: acc.totalDuration + pv.totalDuration,
      totalFuel: Math.round((acc.totalFuel + pv.totalFuel) * 10) / 10,
      maxSpeed: Math.max(acc.maxSpeed, pv.maxSpeed),
      avgSpeed: 0, // computed below
    }),
    { vehicleCount: 0, tripCount: 0, totalDistance: 0, totalDuration: 0, totalFuel: 0, maxSpeed: 0 }
  );

  const activeVehicles = perVehicle.filter((pv) => pv.tripCount > 0);
  totals.avgSpeed =
    activeVehicles.length > 0
      ? Math.round((activeVehicles.reduce((s, pv) => s + pv.avgSpeed, 0) / activeVehicles.length) * 10) / 10
      : 0;

  return {
    group: { id: group.id, name: group.name, color: group.color, description: group.description },
    from,
    to,
    totals,
    perVehicle,
  };
};

/**
 * Get all trips for vehicles in a group within a date range.
 * Returns paginated results with vehicle info attached.
 */
const getGroupReportTrips = async (id, clientId, from, to, limit = 50, offset = 0) => {
  const group = await VehicleGroup.findOne({
    where: { id, clientId },
    include: [{ model: Vehicle, as: 'vehicles', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'], through: { attributes: [] } }],
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const vehicleIds = group.vehicles.map((v) => v.id);
  if (vehicleIds.length === 0) {
    return { trips: [], total: 0 };
  }

  const { fromDate, toDate } = parseISTRange(from, to);

  const { count, rows } = await Trip.findAndCountAll({
    where: { vehicleId: { [Op.in]: vehicleIds }, startTime: { [Op.between]: [fromDate, toDate] } },
    include: [{ model: Vehicle, as: 'vehicle', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'] }],
    order: [['startTime', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  return { trips: rows, total: count };
};

/**
 * Export group report as an Excel (.xlsx) buffer.
 * Sheet 1 — Summary (totals + per-vehicle breakdown)
 * Sheet 2 — All Trips (sorted by startTime asc)
 */
const exportGroupReportExcel = async (id, clientId, from, to) => {
  const ExcelJS = require('exceljs');

  const [summaryData, tripsData] = await Promise.all([
    getGroupReportSummary(id, clientId, from, to),
    getGroupReportTrips(id, clientId, from, to, 100000, 0),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DriveInnovate';
  wb.created = new Date();

  // ── helpers ──────────────────────────────────────────────────────────────────
  const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2F6B' } };
  const hdrFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const addHeader = (ws, cols) => {
    const row = ws.addRow(cols.map((c) => c.header));
    row.eachCell((cell) => { cell.fill = hdrFill; cell.font = hdrFont; cell.alignment = { vertical: 'middle', horizontal: 'center' }; });
    ws.columns = cols.map((c) => ({ key: c.key, width: c.width || 18 }));
    ws.getRow(1).height = 22;
  };
  const secsToHMS = (s) => {
    if (!s) return '0:00:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  const fmtIST = (d) => {
    if (!d) return '';
    const ist = new Date(new Date(d).getTime() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().replace('T', ' ').substring(0, 19) + ' IST';
  };

  // ── Sheet 1: Summary ─────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Summary');

  // Group info block
  ws1.addRow(['Group Name', summaryData.group.name]);
  ws1.addRow(['Description', summaryData.group.description || '—']);
  ws1.addRow(['Report Period', `${from} to ${to}`]);
  ws1.addRow([]);

  // Totals block
  const t = summaryData.totals;
  ws1.addRow(['FLEET TOTALS', '']);
  ws1.addRow(['Total Vehicles', t.vehicleCount]);
  ws1.addRow(['Total Trips', t.tripCount]);
  ws1.addRow(['Total Distance (km)', Number(t.totalDistance).toFixed(2)]);
  ws1.addRow(['Total Duration', secsToHMS(t.totalDuration)]);
  ws1.addRow(['Total Fuel (L)', Number(t.totalFuel).toFixed(2)]);
  ws1.addRow(['Max Speed (km/h)', Number(t.maxSpeed).toFixed(1)]);
  ws1.addRow(['Avg Speed (km/h)', Number(t.avgSpeed).toFixed(1)]);
  ws1.addRow([]);

  // Per-vehicle header
  ws1.addRow(['VEHICLE BREAKDOWN', '', '', '', '', '', '', '']);
  addHeader(ws1, [
    { header: 'Vehicle Number', key: 'vnum',    width: 20 },
    { header: 'Vehicle Name',   key: 'vname',   width: 22 },
    { header: 'Trips',          key: 'trips',   width: 10 },
    { header: 'Distance (km)',  key: 'dist',    width: 16 },
    { header: 'Duration',       key: 'dur',     width: 14 },
    { header: 'Fuel (L)',       key: 'fuel',    width: 12 },
    { header: 'Max Speed',      key: 'maxspd',  width: 14 },
    { header: 'Avg Speed',      key: 'avgspd',  width: 14 },
  ]);
  for (const pv of summaryData.perVehicle) {
    ws1.addRow({
      vnum: pv.vehicleNumber, vname: pv.vehicleName || '—',
      trips: pv.tripCount, dist: Number(pv.totalDistance).toFixed(2),
      dur: secsToHMS(pv.totalDuration), fuel: Number(pv.totalFuel).toFixed(2),
      maxspd: `${Number(pv.maxSpeed).toFixed(1)} km/h`,
      avgspd: `${Number(pv.avgSpeed).toFixed(1)} km/h`,
    });
  }

  // ── Sheet 2: Trips ───────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Trips');
  addHeader(ws2, [
    { header: 'Vehicle Number', key: 'vnum',    width: 20 },
    { header: 'Vehicle Name',   key: 'vname',   width: 22 },
    { header: 'Start Time',     key: 'start',   width: 24 },
    { header: 'End Time',       key: 'end',     width: 24 },
    { header: 'Duration',       key: 'dur',     width: 14 },
    { header: 'Distance (km)',  key: 'dist',    width: 16 },
    { header: 'Avg Speed',      key: 'avgspd',  width: 14 },
    { header: 'Max Speed',      key: 'maxspd',  width: 14 },
    { header: 'Fuel (L)',       key: 'fuel',    width: 12 },
  ]);
  for (const trip of tripsData.trips) {
    ws2.addRow({
      vnum:   trip.vehicle?.vehicleNumber || trip.vehicleId,
      vname:  trip.vehicle?.vehicleName || '—',
      start:  fmtIST(trip.startTime),
      end:    fmtIST(trip.endTime),
      dur:    secsToHMS(trip.duration),
      dist:   Number(trip.distance).toFixed(2),
      avgspd: trip.avgSpeed ? `${Number(trip.avgSpeed).toFixed(1)} km/h` : '—',
      maxspd: trip.maxSpeed ? `${Number(trip.maxSpeed).toFixed(1)} km/h` : '—',
      fuel:   trip.fuelConsumed ? Number(trip.fuelConsumed).toFixed(2) : '—',
    });
  }

  return wb.xlsx.writeBuffer();
};

module.exports = {
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  addVehicleToGroup,
  removeVehicleFromGroup,
  getGroupReportSummary,
  getGroupReportTrips,
  exportGroupReportExcel,
};
