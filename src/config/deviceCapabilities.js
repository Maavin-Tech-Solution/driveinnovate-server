/**
 * Device Capability Registry
 * ─────────────────────────────────────────────────────────────────────────────
 * Central registry of what each GPS device type is capable of reporting.
 *
 * This is the single source of truth that drives:
 *  - packetNormalizer  → which fields to extract from each device's raw packet
 *  - packetProcessor   → which ignition-detection strategy to apply
 *  - UI                → which columns/sensors to show per vehicle
 *  - Reports           → which report sections are available for a device
 *
 * ── Adding a new device type ──────────────────────────────────────────────────
 * 1. Add an entry here in DEVICE_CAPABILITIES.
 * 2. Add a parser entry in di-<deviceName>/index.js (TCP server + MongoDB insert).
 * 3. Add the device to master.service.js BUILT_INS array.
 * 4. The change stream in app.js picks up the new mongoCollection automatically.
 */

const DEVICE_CAPABILITIES = {

  // ─── GT06 ─────────────────────────────────────────────────────────────────
  GT06: {
    displayName: 'GT06 GPS Tracker',

    // How the processor should detect ignition.
    // 'acc-strict'  → trust ACC bit only (no speed override) — requires TRIP_ON_IGNITION=true
    // 'acc-hysteresis' → ON when acc=true OR speed≥5; OFF when acc=false AND speed=0;
    //                    hold when 0<speed<5 (handles traffic-light glitches)
    ignitionSource: 'acc-hysteresis',

    // GPS
    supportsGps: true,
    supportsAltitude: false,
    supportsSatellites: true,
    supportsCourse: true,

    // Electrical / power
    supportsBattery: true,           // Internal backup battery level
    supportsExternalVoltage: false,  // Vehicle 12V rail
    supportsExternalBattery: false,

    // Engine / motion
    supportsOdometer: false,         // No hardware odometer; distance calculated by haversine
    supportsFuel: false,             // No fuel sensor
    supportsRpm: false,
    supportsTemperature: false,

    // Cell / network
    supportsGsmSignal: true,
    supportsCellTower: true,

    // I/O
    supportsDigitalInputs: false,
    supportsAnalogInputs: false,
    supportsCustomIo: false,

    // Protocol specifics
    mongoCollection: 'gt06locations',
    packetTypeField: 'packetType',   // field name in the MongoDB doc that holds the protocol code
    latField: 'latitude',
    lngField: 'longitude',
    accField: 'acc',
    ignitionField: null,
    fuelField: null,
    odometerField: null,
    batteryField: 'battery',
    altitudeField: null,
    satellitesField: 'satellites',
    signalField: 'gsm',
  },

  // ─── FMB125 ───────────────────────────────────────────────────────────────
  FMB125: {
    displayName: 'Teltonika FMB125',
    ignitionSource: 'ignition-io',   // Dedicated IO element 239 → reliable ignition signal

    supportsGps: true,
    supportsAltitude: true,
    supportsSatellites: true,
    supportsCourse: true,

    supportsBattery: true,           // Internal battery voltage
    supportsExternalVoltage: true,   // Vehicle 12V rail (IO element 67)
    supportsExternalBattery: false,

    supportsOdometer: true,          // IO element 16 — hardware total odometer (km)
    supportsFuel: true,              // IO element 9 — fuel level %
    supportsRpm: false,
    supportsTemperature: false,

    supportsGsmSignal: true,
    supportsCellTower: false,

    supportsDigitalInputs: true,     // DIN1–DIN4
    supportsAnalogInputs: true,      // AIN1
    supportsCustomIo: true,          // Full IO element map in doc.ioElements

    mongoCollection: 'fmb125locations',
    packetTypeField: 'packetType',
    latField: 'latitude',
    lngField: 'longitude',
    accField: 'acc',
    ignitionField: 'ignition',       // Primary ignition source
    fuelField: 'fuelLevel',
    odometerField: 'totalOdometer',
    batteryField: 'battery',
    altitudeField: 'altitude',
    satellitesField: 'satellites',
    signalField: 'gsm',
    externalVoltageField: 'externalVoltage',
  },

  // ─── FMB920 ───────────────────────────────────────────────────────────────
  // Teltonika FMB920 — compact tracker, Codec 8E, similar to FMB125 but no
  // analog input or external power supply monitoring.
  FMB920: {
    displayName: 'Teltonika FMB920',
    ignitionSource: 'ignition-io',

    supportsGps: true,
    supportsAltitude: true,
    supportsSatellites: true,
    supportsCourse: true,

    supportsBattery: true,
    supportsExternalVoltage: true,
    supportsExternalBattery: false,

    supportsOdometer: true,
    supportsFuel: false,             // No fuel sensor on FMB920 by default
    supportsRpm: false,
    supportsTemperature: false,

    supportsGsmSignal: true,
    supportsCellTower: false,

    supportsDigitalInputs: true,
    supportsAnalogInputs: false,
    supportsCustomIo: true,

    mongoCollection: 'fmb920locations',
    packetTypeField: 'packetType',
    latField: 'latitude',
    lngField: 'longitude',
    accField: 'acc',
    ignitionField: 'ignition',
    fuelField: null,
    odometerField: 'totalOdometer',
    batteryField: 'battery',
    altitudeField: 'altitude',
    satellitesField: 'satellites',
    signalField: 'gsm',
    externalVoltageField: 'externalVoltage',
  },

  // ─── AIS140 ───────────────────────────────────────────────────────────────
  // IRNSS AIS-140 standard (VLTD) — Indian government mandate.
  // Reports ignition, speed, GPS, emergency panic, GSM cell, odometer.
  AIS140: {
    displayName: 'AIS-140 VLTD',
    ignitionSource: 'ignition-io',   // dedicated field[21] — reliable signal

    // GPS
    supportsGps: true,
    supportsAltitude: true,          // field[17] altitude in metres
    supportsSatellites: true,        // field[16] satellite count
    supportsCourse: true,            // field[15] heading in degrees

    // Electrical
    supportsBattery: true,           // field[24] battery voltage (V)
    supportsExternalVoltage: true,   // field[23] main power voltage (V)
    supportsExternalBattery: false,

    // Engine / motion
    supportsOdometer: true,          // field[41] odometer in km
    supportsFuel: false,
    supportsRpm: false,
    supportsTemperature: false,

    // Cell / network
    supportsGsmSignal: true,         // field[27] GSM signal strength (0-5)
    supportsCellTower: true,         // fields[28-31] MCC/MNC/LAC/CellID

    // I/O
    supportsDigitalInputs: true,     // DI1–DI4 + emergency/tamper
    supportsAnalogInputs: true,      // AI1–AI2
    supportsCustomIo: false,

    // Emergency — unique to AIS-140
    supportsEmergency: true,         // field[25] panic button

    mongoCollection: 'ais140locations',
    packetTypeField: 'packetType',   // LGN | NMR | HBT | EMG | ALT | AKN
    latField: 'latitude',
    lngField: 'longitude',
    accField: 'ignition',
    ignitionField: 'ignition',
    fuelField: null,
    odometerField: 'odometer',
    batteryField: 'batteryVoltage',
    altitudeField: 'altitude',
    satellitesField: 'satellites',
    signalField: 'gsmSignal',
    externalVoltageField: 'mainPowerVoltage',
  },

  // ─── GENERIC ──────────────────────────────────────────────────────────────
  // Fallback for unknown device types — only GPS + ignition from any field.
  GENERIC: {
    displayName: 'Generic GPS Device',
    ignitionSource: 'acc-hysteresis',

    supportsGps: true,
    supportsAltitude: false,
    supportsSatellites: false,
    supportsCourse: false,

    supportsBattery: false,
    supportsExternalVoltage: false,
    supportsExternalBattery: false,

    supportsOdometer: false,
    supportsFuel: false,
    supportsRpm: false,
    supportsTemperature: false,

    supportsGsmSignal: false,
    supportsCellTower: false,

    supportsDigitalInputs: false,
    supportsAnalogInputs: false,
    supportsCustomIo: false,

    mongoCollection: 'locations',
    packetTypeField: 'packetType',
    latField: 'lat',
    lngField: 'lng',
    accField: 'acc',
    ignitionField: 'ignition',
    fuelField: 'fuelLevel',
    odometerField: 'odometer',
    batteryField: 'battery',
    altitudeField: 'altitude',
    satellitesField: 'satellites',
    signalField: 'signal',
  },
};

/**
 * Get capabilities for a device type.
 * Falls back to GENERIC for unknown types so new devices degrade gracefully.
 *
 * @param {string} deviceType  e.g. 'GT06', 'FMB125', 'FMB920', 'AIS140'
 * @returns {object}           Capabilities descriptor
 */
function getCapabilities(deviceType) {
  const key = (deviceType || '').toUpperCase().trim();
  return DEVICE_CAPABILITIES[key] || DEVICE_CAPABILITIES.GENERIC;
}

/**
 * Returns all registered device type keys (excluding GENERIC).
 */
function listDeviceTypes() {
  return Object.keys(DEVICE_CAPABILITIES).filter(k => k !== 'GENERIC');
}

module.exports = { DEVICE_CAPABILITIES, getCapabilities, listDeviceTypes };
