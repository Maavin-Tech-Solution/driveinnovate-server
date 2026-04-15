/**
 * Packet Normalizer Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts a raw MongoDB document (inserted by any device parser) into a
 * uniform "NormalizedPacket" that the packetProcessor state machine can work
 * with regardless of device type.
 *
 * ── Normalized Packet Shape ───────────────────────────────────────────────────
 * {
 *   // Identity
 *   imei:          string,
 *   deviceType:    string,   // 'GT06' | 'FMB125' | 'FMB920' | 'AIS140' | ...
 *
 *   // Timing
 *   timestamp:     Date,
 *
 *   // GPS
 *   lat:           number | null,
 *   lng:           number | null,
 *   altitude:      number | null,   // metres
 *   speed:         number,          // km/h (0 when not available)
 *   course:        number | null,   // degrees 0–359
 *   satellites:    number | null,
 *   gpsFixed:      boolean | null,
 *
 *   // Ignition (normalized from any source)
 *   ignition:      boolean | null,  // null = device has no ignition signal
 *
 *   // Sensors (null when device doesn't support)
 *   fuel:          number | null,   // % 0–100
 *   odometer:      number | null,   // device hardware km
 *   battery:       number | null,   // V or % (device-specific)
 *   externalVoltage: number | null, // vehicle 12V rail (V)
 *   gsmSignal:     number | null,   // raw RSSI or 0–5 bar
 *
 *   // Extensibility
 *   packetType:    string | null,   // protocol-level type code
 *   ioElements:    object | null,   // raw IO map (FMB devices)
 *   raw:           string | null,   // original hex frame
 *
 *   // Flags derived by normalizer
 *   hasGps:        boolean,         // true when lat/lng are valid non-zero values
 *   isStatusOnly:  boolean,         // true for packets with no GPS (GT06 STATUS 0x13, etc.)
 * }
 *
 * ── Adding support for a new device ──────────────────────────────────────────
 * 1. Add the device to deviceCapabilities.js.
 * 2. Add a case in normalizePacket() below (or rely on the generic fallback).
 * 3. The state machine in packetProcessor.service.js works automatically.
 */

const { getCapabilities } = require('../config/deviceCapabilities');

// ─── Per-device normalizers ───────────────────────────────────────────────────

/**
 * GT06 — binary protocol tracker.
 * Packets have different shapes depending on type code:
 *   0x12 (LOCATION) / 0x22 (COMBINED) → GPS + ACC bit
 *   0x13 (STATUS)                      → ACC bit only, no GPS
 *   0x17 (HEARTBEAT)                   → nothing meaningful for state machine
 */
function normalizeGT06(doc) {
  const lat = parseFloat(doc.latitude) || null;
  const lng = parseFloat(doc.longitude) || null;
  const hasGps = lat !== null && lat !== 0 && lng !== null && lng !== 0;

  // acc is the ignition source for GT06
  const ignition = doc.acc !== undefined && doc.acc !== null ? !!doc.acc : null;

  return {
    imei:        doc.imei,
    deviceType:  'GT06',
    timestamp:   new Date(doc.timestamp || doc.serverTimestamp || Date.now()),

    lat:         hasGps ? lat : null,
    lng:         hasGps ? lng : null,
    altitude:    null,
    speed:       parseFloat(doc.speed) || 0,
    course:      doc.course != null ? parseInt(doc.course, 10) : null,
    satellites:  doc.satellites != null ? parseInt(doc.satellites, 10) : null,
    gpsFixed:    doc.gpsFixed !== undefined ? !!doc.gpsFixed : (hasGps ? true : null),

    ignition,

    fuel:            null,
    odometer:        null,
    battery:         doc.battery != null ? parseFloat(doc.battery) : null,
    externalVoltage: null,
    gsmSignal:       doc.gsm != null ? parseInt(doc.gsm, 10) : null,

    packetType:  doc.packetType || null,
    ioElements:  null,
    raw:         doc.raw || null,

    hasGps,
    isStatusOnly: !hasGps,
  };
}

/**
 * Teltonika FMB125 — Codec 8/8E.
 * Always carries GPS. Ignition from IO element 239. Fuel from IO element 9.
 * Odometer from IO element 16 (totalOdometer field).
 */
function normalizeFMB125(doc) {
  const lat = parseFloat(doc.latitude) || null;
  const lng = parseFloat(doc.longitude) || null;
  const hasGps = lat !== null && lat !== 0 && lng !== null && lng !== 0;

  const ignition = doc.ignition !== undefined
    ? !!doc.ignition
    : (doc.acc !== undefined ? !!doc.acc : null);

  return {
    imei:        doc.imei,
    deviceType:  'FMB125',
    timestamp:   new Date(doc.timestamp || doc.serverTimestamp || Date.now()),

    lat:         hasGps ? lat : null,
    lng:         hasGps ? lng : null,
    altitude:    doc.altitude != null ? parseFloat(doc.altitude) : null,
    speed:       parseFloat(doc.speed) || 0,
    course:      doc.course != null ? parseInt(doc.course, 10) : null,
    satellites:  doc.satellites != null ? parseInt(doc.satellites, 10) : null,
    gpsFixed:    hasGps,

    ignition,

    fuel:            doc.fuelLevel != null ? parseFloat(doc.fuelLevel) : null,
    odometer:        doc.totalOdometer != null ? parseFloat(doc.totalOdometer) : null,
    battery:         doc.battery != null ? parseFloat(doc.battery) : null,
    externalVoltage: doc.externalVoltage != null ? parseFloat(doc.externalVoltage) : null,
    gsmSignal:       doc.gsm != null ? parseInt(doc.gsm, 10) : null,

    packetType:  doc.packetType || null,
    ioElements:  doc.ioElements || null,
    raw:         doc.raw || null,

    hasGps,
    isStatusOnly: !hasGps,
  };
}

/**
 * Teltonika FMB920 — same Codec 8E protocol as FMB125, no fuel sensor.
 */
function normalizeFMB920(doc) {
  const pkt = normalizeFMB125(doc); // same wire format
  pkt.deviceType = 'FMB920';
  pkt.fuel = null; // FMB920 typically has no fuel sensor
  return pkt;
}

/**
 * AIS-140 (Indian VLTD standard — Roadpoint vendor implementation).
 * Field names match the ais140/ TCP server's MongoDB schema exactly.
 *
 * Key fields saved by the device server:
 *   latitude, longitude, altitude, speed, heading (course), satellites
 *   ignition (0/1), batteryVoltage (V), mainPowerVoltage (V)
 *   gsmSignal, odometer, emergencyStatus, tamperAlert
 *   packetType: LGN | NMR | HBT | EMG | ALT | AKN
 */
function normalizeAIS140(doc) {
  const lat = parseFloat(doc.latitude) || null;
  const lng = parseFloat(doc.longitude) || null;
  const hasGps = lat !== null && lat !== 0 && lng !== null && lng !== 0
               && doc.gpsValid !== false;

  // ignition is stored as 0/1 integer by the device server
  const ignition = doc.ignition != null ? Boolean(doc.ignition) : null;

  return {
    imei:        doc.imei,
    deviceType:  'AIS140',
    timestamp:   new Date(doc.timestamp || Date.now()),

    lat:         hasGps ? lat : null,
    lng:         hasGps ? lng : null,
    altitude:    doc.altitude  != null ? parseFloat(doc.altitude)  : null,
    speed:       parseFloat(doc.speed) || 0,
    course:      doc.heading   != null ? parseInt(doc.heading, 10) : null,
    satellites:  doc.satellites != null ? parseInt(doc.satellites, 10) : null,
    gpsFixed:    hasGps,

    ignition,

    fuel:            null,
    odometer:        doc.odometer != null ? parseFloat(doc.odometer) : null,
    battery:         doc.batteryVoltage   != null ? parseFloat(doc.batteryVoltage)   : null,
    externalVoltage: doc.mainPowerVoltage != null ? parseFloat(doc.mainPowerVoltage) : null,
    gsmSignal:       doc.gsmSignal != null ? parseInt(doc.gsmSignal, 10) : null,

    // AIS-140 specific — carried through for the Emergency state check
    emergency:   doc.emergencyStatus ? true : false,
    tamper:      doc.tamperAlert     ? true : false,

    packetType:  doc.packetType || null,
    ioElements:  null,
    raw:         doc.raw || null,

    hasGps,
    isStatusOnly: !hasGps,
  };
}

/**
 * Generic fallback — tries common field name patterns so new devices degrade
 * gracefully without a custom normalizer.
 */
function normalizeGeneric(doc, deviceType) {
  const caps = getCapabilities(deviceType);
  const latRaw = doc[caps.latField] ?? doc.latitude ?? doc.lat;
  const lngRaw = doc[caps.lngField] ?? doc.longitude ?? doc.lng;
  const lat = parseFloat(latRaw) || null;
  const lng = parseFloat(lngRaw) || null;
  const hasGps = lat !== null && lat !== 0 && lng !== null && lng !== 0;

  const ignRaw = caps.ignitionField ? doc[caps.ignitionField] : undefined;
  const accRaw = caps.accField      ? doc[caps.accField]      : undefined;
  const ignition = ignRaw !== undefined
    ? !!ignRaw
    : (accRaw !== undefined ? !!accRaw : null);

  return {
    imei:        doc.imei,
    deviceType,
    timestamp:   new Date(doc.timestamp || doc.serverTimestamp || Date.now()),

    lat:         hasGps ? lat : null,
    lng:         hasGps ? lng : null,
    altitude:    caps.altitudeField && doc[caps.altitudeField] != null
                   ? parseFloat(doc[caps.altitudeField]) : null,
    speed:       parseFloat(doc.speed) || 0,
    course:      doc.course != null ? parseInt(doc.course, 10) : null,
    satellites:  caps.satellitesField && doc[caps.satellitesField] != null
                   ? parseInt(doc[caps.satellitesField], 10) : null,
    gpsFixed:    hasGps,

    ignition,

    fuel:            caps.fuelField && doc[caps.fuelField] != null
                       ? parseFloat(doc[caps.fuelField]) : null,
    odometer:        caps.odometerField && doc[caps.odometerField] != null
                       ? parseFloat(doc[caps.odometerField]) : null,
    battery:         caps.batteryField && doc[caps.batteryField] != null
                       ? parseFloat(doc[caps.batteryField]) : null,
    externalVoltage: caps.externalVoltageField && doc[caps.externalVoltageField] != null
                       ? parseFloat(doc[caps.externalVoltageField]) : null,
    gsmSignal:       caps.signalField && doc[caps.signalField] != null
                       ? parseInt(doc[caps.signalField], 10) : null,

    packetType:  caps.packetTypeField ? (doc[caps.packetTypeField] || null) : null,
    ioElements:  doc.ioElements || null,
    raw:         doc.raw || null,

    hasGps,
    isStatusOnly: !hasGps,
  };
}

// ─── Dispatch table ───────────────────────────────────────────────────────────
const NORMALIZERS = {
  GT06:   normalizeGT06,
  FMB125: normalizeFMB125,
  FMB920: normalizeFMB920,
  AIS140: normalizeAIS140,
};

/**
 * Normalize a raw MongoDB packet document into a standard NormalizedPacket.
 *
 * @param {object} doc         Raw MongoDB document from any device collection
 * @param {string} deviceType  e.g. 'GT06', 'FMB125', 'FMB920', 'AIS140'
 * @returns {NormalizedPacket}
 */
function normalizePacket(doc, deviceType) {
  const key = (deviceType || '').toUpperCase().trim();
  const fn  = NORMALIZERS[key] || ((d) => normalizeGeneric(d, key));
  return fn(doc);
}

module.exports = { normalizePacket };
