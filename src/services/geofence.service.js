const { Geofence, GeofenceAssignment, Vehicle, VehicleGroup, VehicleGroupMember } = require('../models');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Standard includes so every geofence response carries its assignments */
const ASSIGNMENT_INCLUDE = {
  model: GeofenceAssignment,
  as: 'assignments',
  include: [
    {
      model: Vehicle,
      as: 'vehicle',
      attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'],
    },
    {
      model: VehicleGroup,
      as: 'group',
      attributes: ['id', 'name', 'color'],
    },
  ],
};

/** Throw a 404 if the geofence doesn't exist / belong to this client */
const findOwned = async (id, clientId) => {
  const geo = await Geofence.findOne({ where: { id, clientId }, include: [ASSIGNMENT_INCLUDE] });
  if (!geo) {
    const err = new Error('Geofence not found');
    err.status = 404;
    throw err;
  }
  return geo;
};

/** Haversine distance in metres between two lat/lng points */
const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6_371_000; // Earth radius metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Point-in-polygon using the ray-casting algorithm.
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{lat:number,lng:number}>} polygon
 */
const pointInPolygon = (lat, lng, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

const getGeofences = async (clientId) => {
  return Geofence.findAll({
    where: { clientId },
    include: [ASSIGNMENT_INCLUDE],
    order: [['created_at', 'DESC']],
  });
};

const getGeofenceById = async (id, clientId) => findOwned(id, clientId);

const createGeofence = async (clientId, data) => {
  const { name, description, type, centerLat, centerLng, radiusMeters, coordinates, color, isActive } = data;

  if (!name?.trim()) {
    const err = new Error('Geofence name is required');
    err.status = 400;
    throw err;
  }
  if (!type || !['CIRCULAR', 'POLYGON'].includes(type)) {
    const err = new Error('type must be CIRCULAR or POLYGON');
    err.status = 400;
    throw err;
  }

  if (type === 'CIRCULAR') {
    if (centerLat == null || centerLng == null || radiusMeters == null) {
      const err = new Error('CIRCULAR geofence requires centerLat, centerLng, and radiusMeters');
      err.status = 400;
      throw err;
    }
    if (Number(radiusMeters) <= 0) {
      const err = new Error('radiusMeters must be greater than 0');
      err.status = 400;
      throw err;
    }
  }

  if (type === 'POLYGON') {
    if (!Array.isArray(coordinates) || coordinates.length < 3) {
      const err = new Error('POLYGON geofence requires at least 3 coordinate points');
      err.status = 400;
      throw err;
    }
  }

  return Geofence.create({
    clientId,
    name: name.trim(),
    description: description?.trim() || null,
    type,
    centerLat: type === 'CIRCULAR' ? centerLat : null,
    centerLng: type === 'CIRCULAR' ? centerLng : null,
    radiusMeters: type === 'CIRCULAR' ? radiusMeters : null,
    coordinates: type === 'POLYGON' ? coordinates : null,
    color: color || '#3b82f6',
    isActive: isActive !== undefined ? isActive : true,
  });
};

const updateGeofence = async (id, clientId, data) => {
  const geo = await findOwned(id, clientId);
  const { name, description, type, centerLat, centerLng, radiusMeters, coordinates, color } = data;

  const newType = type || geo.type;

  if (newType === 'CIRCULAR' && (centerLat != null || centerLng != null || radiusMeters != null)) {
    if (centerLat == null || centerLng == null || radiusMeters == null) {
      const err = new Error('CIRCULAR geofence requires centerLat, centerLng, and radiusMeters');
      err.status = 400;
      throw err;
    }
  }

  if (newType === 'POLYGON' && coordinates != null) {
    if (!Array.isArray(coordinates) || coordinates.length < 3) {
      const err = new Error('POLYGON geofence requires at least 3 coordinate points');
      err.status = 400;
      throw err;
    }
  }

  await geo.update({
    ...(name && { name: name.trim() }),
    ...(description !== undefined && { description: description?.trim() || null }),
    ...(type && { type }),
    ...(centerLat != null && { centerLat }),
    ...(centerLng != null && { centerLng }),
    ...(radiusMeters != null && { radiusMeters }),
    ...(coordinates != null && { coordinates }),
    ...(color && { color }),
  });

  return findOwned(id, clientId);
};

const deleteGeofence = async (id, clientId) => {
  const geo = await findOwned(id, clientId);
  // Remove all assignments first
  await GeofenceAssignment.destroy({ where: { geofenceId: id } });
  await geo.destroy();
  return { message: 'Geofence deleted successfully' };
};

const toggleGeofence = async (id, clientId) => {
  const geo = await findOwned(id, clientId);
  await geo.update({ isActive: !geo.isActive });
  return geo;
};

// ─────────────────────────────────────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────────────────────────────────────

const addAssignment = async (geofenceId, clientId, data) => {
  // Verify the geofence belongs to this client
  const geo = await Geofence.findOne({ where: { id: geofenceId, clientId } });
  if (!geo) {
    const err = new Error('Geofence not found');
    err.status = 404;
    throw err;
  }

  const { scope, vehicleId, groupId, alertOnEntry, alertOnExit } = data;

  if (!scope || !['VEHICLE', 'GROUP'].includes(scope)) {
    const err = new Error('scope must be VEHICLE or GROUP');
    err.status = 400;
    throw err;
  }

  if (scope === 'VEHICLE') {
    if (!vehicleId) {
      const err = new Error('vehicleId is required when scope is VEHICLE');
      err.status = 400;
      throw err;
    }
    // Verify vehicle belongs to same client
    const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
    if (!vehicle) {
      const err = new Error('Vehicle not found');
      err.status = 404;
      throw err;
    }
    // Check duplicate
    const exists = await GeofenceAssignment.findOne({ where: { geofenceId, vehicleId, scope: 'VEHICLE' } });
    if (exists) {
      const err = new Error('This vehicle is already assigned to this geofence');
      err.status = 409;
      throw err;
    }
  }

  if (scope === 'GROUP') {
    if (!groupId) {
      const err = new Error('groupId is required when scope is GROUP');
      err.status = 400;
      throw err;
    }
    const group = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    const exists = await GeofenceAssignment.findOne({ where: { geofenceId, groupId, scope: 'GROUP' } });
    if (exists) {
      const err = new Error('This group is already assigned to this geofence');
      err.status = 409;
      throw err;
    }
  }

  return GeofenceAssignment.create({
    geofenceId,
    scope,
    vehicleId: scope === 'VEHICLE' ? vehicleId : null,
    groupId: scope === 'GROUP' ? groupId : null,
    alertOnEntry: alertOnEntry !== undefined ? alertOnEntry : true,
    alertOnExit: alertOnExit !== undefined ? alertOnExit : true,
  });
};

const removeAssignment = async (geofenceId, assignmentId, clientId) => {
  // Verify geofence ownership
  const geo = await Geofence.findOne({ where: { id: geofenceId, clientId } });
  if (!geo) {
    const err = new Error('Geofence not found');
    err.status = 404;
    throw err;
  }

  const assignment = await GeofenceAssignment.findOne({ where: { id: assignmentId, geofenceId } });
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  await assignment.destroy();
  return { message: 'Assignment removed successfully' };
};

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle-centric query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all active geofences that apply to a given vehicle — either directly
 * assigned or through any group the vehicle belongs to.
 */
const getVehicleGeofences = async (vehicleId, clientId) => {
  // Verify vehicle ownership
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  // All group IDs this vehicle belongs to
  const memberships = await VehicleGroupMember.findAll({ where: { vehicleId }, attributes: ['groupId'] });
  const groupIds = memberships.map((m) => m.groupId);

  // Assignments targeting this vehicle directly
  const directAssignments = await GeofenceAssignment.findAll({
    where: { scope: 'VEHICLE', vehicleId },
  });

  // Assignments targeting any of the vehicle's groups
  const groupAssignments =
    groupIds.length > 0
      ? await GeofenceAssignment.findAll({ where: { scope: 'GROUP', groupId: groupIds } })
      : [];

  const allGeofenceIds = [
    ...new Set([
      ...directAssignments.map((a) => a.geofenceId),
      ...groupAssignments.map((a) => a.geofenceId),
    ]),
  ];

  if (allGeofenceIds.length === 0) return [];

  return Geofence.findAll({
    where: { id: allGeofenceIds, isActive: true },
    include: [ASSIGNMENT_INCLUDE],
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Geo-check utilities (used by the alert engine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given point (lat, lng) is inside the geofence.
 * @param {object} geofence  — Geofence model instance or plain object
 * @param {number} lat
 * @param {number} lng
 */
const isPointInsideGeofence = (geofence, lat, lng) => {
  if (geofence.type === 'CIRCULAR') {
    const dist = haversineMeters(
      parseFloat(geofence.centerLat),
      parseFloat(geofence.centerLng),
      lat,
      lng
    );
    return dist <= parseFloat(geofence.radiusMeters);
  }

  if (geofence.type === 'POLYGON') {
    return pointInPolygon(lat, lng, geofence.coordinates);
  }

  return false;
};

module.exports = {
  getGeofences,
  getGeofenceById,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  toggleGeofence,
  addAssignment,
  removeAssignment,
  getVehicleGeofences,
  isPointInsideGeofence,
};
