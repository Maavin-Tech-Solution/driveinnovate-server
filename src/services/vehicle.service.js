const {
  Vehicle, RtoDetail, User, VehicleDeviceState, VehicleEditHistory,
  VehicleGroup, VehicleGroupMember, Geofence, GeofenceAssignment,
  Alert, LiveShare, TripShare, sequelize,
} = require('../models');
const { Op } = require('sequelize');

// Fields whose edits are audited, with human-friendly labels.
const TRACKED_FIELDS = {
  vehicleNumber: 'Registration No.',
  vehicleName: 'Vehicle Name',
  branch: 'Branch',
  chasisNumber: 'Chassis Number',
  engineNumber: 'Engine Number',
  imei: 'IMEI',
  sim1: 'SIM 1 / Mobile No',
  sim2: 'SIM 2',
  deviceName: 'Device Name',
  deviceType: 'Device Type',
  serverIp: 'Server IP',
  serverPort: 'Server Port',
  vehicleIcon: 'Vehicle Icon',
  status: 'Status',
  idleThreshold: 'Idle Threshold',
  fuelFillThreshold: 'Fuel Fill Threshold',
  fuelSupported: 'Fuel Supported',
  fuelTankCapacity: 'Fuel Tank Capacity',
};

// Normalise a value for change comparison + storage (null/'' both → '').
const normaliseValue = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
};
const { Location, FMB125Location, AIS140Location, isMongoDBConnected, getMongoDb } = require('../config/mongodb');
const { invalidateVehicleCache } = require('./packetProcessor.service');

// Device type groups → MongoDB collections
const FMB125_DEVICE_TYPES = ['FMB125', 'FMB120', 'FMB130', 'FMB140', 'FMB920'];
const AIS140_DEVICE_TYPES = ['AIS140'];

/**
 * Get the correct MongoDB Location model based on vehicle device type
 */
const getLocationModel = (deviceType) => {
  if (!deviceType) return Location;
  const dt = deviceType.toUpperCase();
  if (AIS140_DEVICE_TYPES.includes(dt)) return AIS140Location;
  if (FMB125_DEVICE_TYPES.includes(dt))  return FMB125Location;
  return Location;
};

/**
 * Helper function to fetch GPS data from MongoDB for a given IMEI
 * Handles IMEI with or without leading zeros
 * Uses correct collection based on device type
 */
const fetchGpsData = async (imei, deviceType) => {
  if (!imei) {
    console.log('[GPS] No IMEI provided');
    return null;
  }
  
  // Check MongoDB connection before querying
  if (!isMongoDBConnected()) {
    console.warn('[GPS] MongoDB not connected - skipping GPS data fetch');
    return null;
  }
  
  try {
    const LocationModel = getLocationModel(deviceType);
    console.log(`[GPS] Searching for IMEI: ${imei} in ${deviceType ? deviceType : 'GT06'} collection`);
    
    // Normalize IMEI - try both with and without leading zero
    const imeiVariations = [
      imei,
      imei.startsWith('0') ? imei.substring(1) : `0${imei}` // Toggle leading zero
    ];
    
    console.log(`[GPS] Trying IMEI variations:`, imeiVariations);
    
    // Try to fetch latest location with actual GPS coordinates using any IMEI variation
    // Only select required fields for performance
    const gpsData = await LocationModel.findOne({ 
      imei: { $in: imeiVariations },
      latitude: { $exists: true, $ne: null },
      longitude: { $exists: true, $ne: null }
    })
      .sort({ timestamp: -1 })
      .select('timestamp latitude longitude speed satellites')
      .limit(1)
      .lean();
    
    if (gpsData) {
      console.log(`[GPS] ✓ Found GPS data for IMEI: ${gpsData.imei}`);
    } else {
      console.log(`[GPS] ✗ No GPS data found for IMEI variations:`, imeiVariations);
      
      // Check if record exists without coordinates
      const anyRecord = await LocationModel.findOne({ imei: { $in: imeiVariations } }).lean();
      if (anyRecord) {
        console.log(`[GPS] Record exists but no coordinates. PacketType: ${anyRecord.packetType || anyRecord.eventType || 'unknown'}`);
      }
    }
    
    return gpsData || null;
  } catch (error) {
    console.error('[GPS] Error fetching GPS data from MongoDB:', error.message);
    console.error('[GPS] Stack:', error.stack);
    return null;
  }
};

/**
 * Helper function to fetch comprehensive device status from multiple packet types
 * Fetches latest packets of each type to build complete vehicle status
 * Supports both GT06 and FMB125 device types
 */
const fetchComprehensiveDeviceStatus = async (imei, deviceType) => {
  if (!imei) {
    console.log('[DEVICE] No IMEI provided');
    return null;
  }
  
  // Check MongoDB connection before querying
  if (!isMongoDBConnected()) {
    console.warn('[DEVICE] MongoDB not connected - skipping device status fetch');
    return null;
  }
  
  const dt = (deviceType || '').toUpperCase();
  const isFMB125  = FMB125_DEVICE_TYPES.includes(dt);
  const isAIS140  = AIS140_DEVICE_TYPES.includes(dt);
  const LocationModel = getLocationModel(deviceType);

  const deviceLabel = isAIS140 ? 'AIS140' : isFMB125 ? 'FMB125' : 'GT06';

  try {
    console.log(`[DEVICE] Fetching comprehensive status for IMEI: ${imei} (${deviceLabel})`);

    // Normalize IMEI — try with and without leading zero
    const imeiVariations = [
      imei,
      imei.startsWith('0') ? imei.substring(1) : `0${imei}`
    ];

    if (isAIS140) {
      return await fetchAIS140Status(LocationModel, imeiVariations);
    }

    if (isFMB125) {
      return await fetchFMB125Status(LocationModel, imeiVariations);
    }
    
    // ── GT06 packet-based fetch (existing logic) ──
    // Fetch latest packets of each important type in parallel
    // The last entry is a catch-all: absolute latest packet regardless of type,
    // used to ensure lastUpdate / gpsData.timestamp always reflects the true
    // last communication even when recent packets have an unexpected packetType.
    const [locationData, locationExtData, statusData, heartbeatData, odometerData, voltageData, alarmData, absoluteLatest, latestGps] = await Promise.all([
      // LOCATION (0x12) - Basic GPS location with ignition
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'LOCATION',
        latitude: { $exists: true, $ne: null },
        longitude: { $exists: true, $ne: null }
      })
        .sort({ timestamp: -1 })
        .select('timestamp latitude longitude speed satellites course acc gpsFixed')
        .lean(),

      // LOCATION_EXT (0x22) - Extended location with defense, charge status
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'LOCATION_EXT',
        latitude:  { $exists: true, $gt: 0 },
        longitude: { $exists: true, $ne: null },
      })
        .sort({ timestamp: -1 })
        .select('timestamp latitude longitude speed satellites acc defense charge gsmSignal')
        .lean(),

      // STATUS (0x13) - Comprehensive device status
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'STATUS'
      })
        .sort({ timestamp: -1 })
        .select('timestamp oil electric door acc defense gpsTracking batteryLevel gsmSignal alarm')
        .lean(),

      // HEARTBEAT (0x23) - Voltage and signal
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'HEARTBEAT'
      })
        .sort({ timestamp: -1 })
        .select('timestamp voltage gsmSignal terminalInfo')
        .lean(),

      // INFO_TRANSMISSION (0x94) with infoType 0x01 - Odometer
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'INFO_TRANSMISSION',
        odometer: { $exists: true, $ne: null }
      })
        .sort({ timestamp: -1 })
        .select('timestamp odometer')
        .lean(),

      // INFO_TRANSMISSION (0x94) with infoType 0x05 - Voltage
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'INFO_TRANSMISSION',
        voltage: { $exists: true, $ne: null }
      })
        .sort({ timestamp: -1 })
        .select('timestamp voltage')
        .lean(),

      // ALARM (0x16) - Latest alarm
      Location.findOne({
        imei: { $in: imeiVariations },
        packetType: 'ALARM'
      })
        .sort({ timestamp: -1 })
        .select('timestamp alarm oil electric door defense latitude longitude')
        .lean(),

      // Catch-all: absolute latest packet regardless of packetType.
      // Ensures lastUpdate reflects the true last device contact even when
      // newer packets have an unexpected/missing packetType.
      Location.findOne({ imei: { $in: imeiVariations } })
        .sort({ timestamp: -1 })
        .select('timestamp latitude longitude speed acc')
        .lean(),

      // Latest packet that has GPS coordinates — any packetType.
      // Used to update the map position when newer packets carry coordinates
      // but have a packetType not matched by the LOCATION/LOCATION_EXT queries.
      Location.findOne({
        imei: { $in: imeiVariations },
        latitude:  { $exists: true, $gt: 0 },
        longitude: { $exists: true, $ne: null },
      })
        .sort({ timestamp: -1 })
        .select('timestamp latitude longitude speed satellites acc')
        .lean(),
    ]);
    
    // Log what packets were found
    console.log('[DEVICE] Packets found:', {
      location: !!locationData,
      locationExt: !!locationExtData,
      status: !!statusData,
      heartbeat: !!heartbeatData && `voltage=${heartbeatData.voltage}`,
      odometer: !!odometerData,
      voltageInfo: !!voltageData && `voltage=${voltageData.voltage}`,
      alarm: !!alarmData
    });
    
    // Aggregate data from all packet types
    const aggregatedData = {
      // GPS Data (prefer LOCATION_EXT, fallback to LOCATION)
      gpsData: null,
      
      // Device Status
      status: {
        ignition: null,          // acc - from multiple sources
        battery: null,           // batteryLevel - from STATUS
        voltage: null,           // voltage - from HEARTBEAT or INFO_TRANSMISSION
        gsmSignal: null,         // gsmSignal - from multiple sources
        charging: null,          // charge - from LOCATION_EXT
        defense: null,           // defense - from STATUS or LOCATION_EXT
        oil: null,               // oil - from STATUS
        electric: null,          // electric - from STATUS
        door: null,              // door - from STATUS
        gpsTracking: null        // gpsTracking - from STATUS
      },
      
      // Trip Information
      trip: {
        odometer: null           // odometer - from INFO_TRANSMISSION
      },
      
      // Alerts
      alerts: {
        latestAlarm: null,       // alarm - from ALARM packet
        alarmTimestamp: null
      },
      
      // Metadata
      lastUpdate: null
    };
    
    // Build GPS data.
    // Priority: whichever of LOCATION_EXT, LOCATION, or latestGps (any-type) is newest.
    // This ensures position updates even when the device sends packets without a
    // recognised packetType (e.g. after a firmware change or TCP server update).
    const gpsSource = [locationExtData, locationData, latestGps]
      .filter(Boolean)
      .filter(d => d.latitude != null && d.latitude > 0 && d.longitude != null)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (gpsSource) {
      aggregatedData.gpsData = {
        latitude:   gpsSource.latitude,
        longitude:  gpsSource.longitude,
        speed:      gpsSource.speed || 0,
        satellites: gpsSource.satellites || 0,
        course:     gpsSource.course,
        gpsFixed:   gpsSource.gpsFixed,
        timestamp:  gpsSource.timestamp,
      };
      aggregatedData.lastUpdate = gpsSource.timestamp;
    }
    
    // Aggregate status data from multiple sources (prefer most recent)
    // Ignition:
    //   GT06 devices always report acc=false even when running — use speed >= 5 km/h
    //   as the ignition indicator (matches processPacket logic).
    //   FMB125 has a dedicated hardware ignition signal so acc is reliable there.
    if (isFMB125) {
      if (locationExtData?.acc !== undefined) aggregatedData.status.ignition = locationExtData.acc;
      else if (statusData?.acc !== undefined) aggregatedData.status.ignition = statusData.acc;
      else if (locationData?.acc !== undefined) aggregatedData.status.ignition = locationData.acc;
    } else {
      // GT06: ignition = acc=true (some wired devices) OR speed >= 5 km/h
      const latestSpeed = locationExtData?.speed ?? locationData?.speed ?? latestGps?.speed ?? 0;
      const latestAcc   = locationExtData?.acc ?? locationData?.acc ?? false;
      aggregatedData.status.ignition = !!(latestAcc || latestSpeed >= 5);
    }
    
    // Battery level - from STATUS
    if (statusData?.batteryLevel !== undefined) {
      aggregatedData.status.battery = statusData.batteryLevel;
    }
    
    // Voltage - from HEARTBEAT (preferred) or INFO_TRANSMISSION
    if (heartbeatData?.voltage !== undefined) {
      aggregatedData.status.voltage = heartbeatData.voltage;
    } else if (voltageData?.voltage !== undefined) {
      aggregatedData.status.voltage = voltageData.voltage;
    }
    
    // GSM Signal - available in multiple packets
    if (locationExtData?.gsmSignal !== undefined) aggregatedData.status.gsmSignal = locationExtData.gsmSignal;
    else if (statusData?.gsmSignal !== undefined) aggregatedData.status.gsmSignal = statusData.gsmSignal;
    else if (heartbeatData?.gsmSignal !== undefined) aggregatedData.status.gsmSignal = heartbeatData.gsmSignal;
    
    // Charging status - from LOCATION_EXT
    if (locationExtData?.charge !== undefined) {
      aggregatedData.status.charging = locationExtData.charge;
    }
    
    // Defense mode - from STATUS (preferred) or LOCATION_EXT
    if (statusData?.defense !== undefined) aggregatedData.status.defense = statusData.defense;
    else if (locationExtData?.defense !== undefined) aggregatedData.status.defense = locationExtData.defense;
    
    // Oil, Electric, Door - from STATUS
    if (statusData?.oil !== undefined) aggregatedData.status.oil = statusData.oil;
    if (statusData?.electric !== undefined) aggregatedData.status.electric = statusData.electric;
    if (statusData?.door !== undefined) aggregatedData.status.door = statusData.door;
    if (statusData?.gpsTracking !== undefined) aggregatedData.status.gpsTracking = statusData.gpsTracking;
    
    // Odometer - from INFO_TRANSMISSION
    if (odometerData?.odometer !== undefined) {
      aggregatedData.trip.odometer = odometerData.odometer;
    }
    
    // Alarm - from ALARM packet
    if (alarmData?.alarm) {
      aggregatedData.alerts.latestAlarm = alarmData.alarm;
      aggregatedData.alerts.alarmTimestamp = alarmData.timestamp;
    }
    
    // Update lastUpdate to the most recent timestamp across all packet types.
    // Include absoluteLatest so that packets with unexpected/missing packetType
    // (e.g. devices sending non-standard frames) still advance lastUpdate.
    const allTimestamps = [
      locationData?.timestamp,
      locationExtData?.timestamp,
      statusData?.timestamp,
      heartbeatData?.timestamp,
      odometerData?.timestamp,
      voltageData?.timestamp,
      alarmData?.timestamp,
      absoluteLatest?.timestamp,
    ].filter(Boolean);

    if (allTimestamps.length > 0) {
      aggregatedData.lastUpdate = new Date(Math.max(...allTimestamps.map(t => new Date(t).getTime())));
    }

    // If the absolute latest packet (any type) is newer than gpsData.timestamp,
    // advance the timestamp so "Last Updated" reflects true last device contact.
    if (absoluteLatest?.timestamp) {
      const absMs = new Date(absoluteLatest.timestamp).getTime();
      if (aggregatedData.gpsData) {
        const curMs = aggregatedData.gpsData.timestamp
          ? new Date(aggregatedData.gpsData.timestamp).getTime() : 0;
        if (absMs > curMs) {
          aggregatedData.gpsData.timestamp = absoluteLatest.timestamp;
          // Only update ignition from absoluteLatest for FMB125 (GT06 uses speed-based logic above)
          if (isFMB125 && absoluteLatest.acc !== undefined) aggregatedData.status.ignition = absoluteLatest.acc;
        }
      } else if (absoluteLatest.latitude > 0 && absoluteLatest.longitude != null) {
        // No GPS packet at all — surface last contact time only if coordinates are valid
        aggregatedData.gpsData = {
          latitude: absoluteLatest.latitude,
          longitude: absoluteLatest.longitude,
          speed: absoluteLatest.speed || 0,
          timestamp: absoluteLatest.timestamp,
        };
      } else {
        // Absolute latest has no valid coords — at least surface the contact timestamp
        aggregatedData.gpsData = { timestamp: absoluteLatest.timestamp };
      }
    }
    
    console.log(`[DEVICE] ✓ Aggregated device status from ${allTimestamps.length} packet types`);
    console.log(`[DEVICE] Status: IGN=${aggregatedData.status.ignition}, BAT=${aggregatedData.status.battery}%, V=${aggregatedData.status.voltage}V`);
    
    return aggregatedData;
  } catch (error) {
    console.error('[DEVICE] Error fetching comprehensive device status:', error.message);
    console.error('[DEVICE] Stack:', error.stack);
    return null;
  }
};

/**
 * Fetch comprehensive status for AIS-140 / VLTD devices.
 * All AIS-140 packet types (NMR, LGN, HBT, EMG) carry the full field set,
 * so we query the latest GPS record and the absolute latest record in parallel.
 */
const fetchAIS140Status = async (LocationModel, imeiVariations) => {
  try {
    const [latestRecord, absoluteLatest, latestEmergency] = await Promise.all([
      // Latest record that has a valid GPS fix
      LocationModel.findOne({
        imei:      { $in: imeiVariations },
        latitude:  { $exists: true, $ne: null },
        longitude: { $exists: true, $ne: null },
        gpsValid:  { $ne: false },
      }).sort({ timestamp: -1 }).lean(),

      // Absolute latest packet — ensures lastUpdate = real last contact time
      LocationModel.findOne({ imei: { $in: imeiVariations } })
        .sort({ timestamp: -1 })
        .select('timestamp ignition emergencyStatus gsmSignal')
        .lean(),

      // Latest emergency packet (packetType EMG) — for persistent alert display
      LocationModel.findOne({
        imei:       { $in: imeiVariations },
        packetType: 'EMG',
      }).sort({ timestamp: -1 }).select('timestamp emergencyStatus alertType').lean(),
    ]);

    if (!latestRecord && !absoluteLatest) {
      console.log('[DEVICE/AIS140] ✗ No records found');
      return null;
    }

    const src = latestRecord || {};

    // ignition is stored as 0/1 integer
    const ignition = absoluteLatest?.ignition != null
      ? Boolean(absoluteLatest.ignition)
      : (src.ignition != null ? Boolean(src.ignition) : null);

    // Emergency is active only while the LATEST packet still carries emergencyStatus=1.
    // Once the device sends a normal packet (emergencyStatus=0 or field absent), the
    // emergency is considered cleared — prevents stale EMG packets from locking the
    // vehicle in "Emergency" state permanently.
    const emergency = (absoluteLatest?.emergencyStatus === 1) ? true : false;

    const aggregatedData = {
      deviceType: 'AIS140',

      gpsData: latestRecord ? {
        latitude:   latestRecord.latitude,
        longitude:  latestRecord.longitude,
        speed:      latestRecord.speed    ?? 0,
        satellites: latestRecord.satellites ?? 0,
        course:     latestRecord.heading  ?? null,   // AIS140 uses 'heading'
        altitude:   latestRecord.altitude ?? null,
        gpsFixed:   latestRecord.gpsValid !== false,
        timestamp:  latestRecord.timestamp,
      } : null,

      status: {
        ignition,
        movement:  src.speed != null ? src.speed > 0 : null,
        battery:   src.batteryVoltage   != null ? parseFloat(src.batteryVoltage)   : null,  // V
        voltage:   src.mainPowerVoltage != null ? parseFloat(src.mainPowerVoltage) : null,  // V
        gsmSignal: src.gsmSignal        != null ? src.gsmSignal : (absoluteLatest?.gsmSignal ?? null),
        emergency,
        tamper:    src.tamperAlert     ? true : false,
        di1: src.di1 ?? null,
        di2: src.di2 ?? null,
        di3: src.di3 ?? null,
        di4: src.di4 ?? null,
        // GT06-specific flags — not applicable for AIS140
        charging:    null,
        defense:     null,
        oil:         null,
        electric:    null,
        door:        null,
        gpsTracking: latestRecord?.gpsValid ?? null,
      },

      fuel:   null,   // AIS140 has no fuel sensor
      engine: null,

      trip: {
        odometer: src.odometer != null ? parseFloat(src.odometer) : null,  // km
      },

      alerts: {
        latestAlarm:    latestEmergency ? (latestEmergency.alertType || 'Emergency') : null,
        alarmTimestamp: latestEmergency?.timestamp ?? null,
      },

      driver: null,

      // Cell tower info (AIS140 specific)
      cellInfo: {
        mcc:      src.mcc      ?? null,
        mnc:      src.mnc      ?? null,
        lac:      src.lac      ?? null,
        cellId:   src.cellId   ?? null,
        operator: src.operatorName ?? null,
      },

      lastUpdate: absoluteLatest?.timestamp ?? latestRecord?.timestamp ?? null,
    };

    // Advance lastUpdate to absolute latest if newer
    if (absoluteLatest?.timestamp && aggregatedData.lastUpdate) {
      const absMs = new Date(absoluteLatest.timestamp).getTime();
      const curMs = new Date(aggregatedData.lastUpdate).getTime();
      if (absMs > curMs) aggregatedData.lastUpdate = absoluteLatest.timestamp;
    }

    console.log(
      `[DEVICE/AIS140] Status: IGN=${aggregatedData.status.ignition}` +
      ` SPEED=${src.speed} EMERGENCY=${emergency}` +
      ` BAT=${aggregatedData.status.battery}V V=${aggregatedData.status.voltage}V`
    );

    return aggregatedData;
  } catch (error) {
    console.error('[DEVICE/AIS140] Error:', error.message);
    return null;
  }
};

/**
 * Fetch comprehensive status for FMB125/Teltonika devices
 * FMB125 stores all data in a single record (AVL data) rather than separate packet types
 */
const fetchFMB125Status = async (LocationModel, imeiVariations) => {
  try {
    // Run GPS-only query and absolute-latest query in parallel.
    // The GPS query provides coordinates and sensors; the catch-all gives the true last-contact time
    // (FMB125 sends non-GPS heartbeat / status packets that the GPS query misses).
    const [latestRecord, absoluteLatest] = await Promise.all([
      LocationModel.findOne({
        imei: { $in: imeiVariations },
        latitude: { $exists: true, $ne: null },
        longitude: { $exists: true, $ne: null },
      }).sort({ timestamp: -1 }).lean(),
      LocationModel.findOne({ imei: { $in: imeiVariations } })
        .sort({ timestamp: -1 }).select('timestamp').lean(),
    ]);

    if (!latestRecord) {
      console.log('[DEVICE/FMB125] ✗ No records found');
      return null;
    }

    console.log(`[DEVICE/FMB125] ✓ Found latest record for IMEI: ${latestRecord.imei}`);

    const aggregatedData = {
      deviceType: 'FMB125',
      // GPS Data
      gpsData: {
        latitude: latestRecord.latitude,
        longitude: latestRecord.longitude,
        speed: latestRecord.speed || 0,
        satellites: latestRecord.satellites || 0,
        course: latestRecord.angle,
        altitude: latestRecord.altitude,
        gpsFixed: latestRecord.gpsValid !== false,
        hdop: latestRecord.hdop,
        timestamp: latestRecord.timestamp,
        ioElements: latestRecord.ioElements || {},
      },
      // Device Status
      status: {
        ignition: latestRecord.ignition ?? null,
        movement: latestRecord.movement ?? null,
        battery: latestRecord.batteryLevel ?? null,
        voltage: latestRecord.externalVoltage ? latestRecord.externalVoltage / 1000 : null, // mV to V
        batteryVoltage: latestRecord.batteryVoltage ? latestRecord.batteryVoltage / 1000 : null, // mV to V
        gsmSignal: latestRecord.gsmSignal ?? null,
        charging: null,
        defense: null,
        oil: null,
        electric: null,
        door: null,
        gpsTracking: latestRecord.gpsValid ?? null
      },
      // Fuel Data (FMB125 specific)
      fuel: {
        // CAN bus fuel level (percentage 0-100) — IO element 112
        level: latestRecord.fuelLevel ?? latestRecord.canFuelLevel ?? null,
        // LLS liquid level sensor fuel (mm) — IO elements 201/203/210/212/214
        llsLevel: latestRecord.llsFuelLevel1 ?? latestRecord.llsFuelLevel2 ??
                  latestRecord.llsFuelLevel3 ?? latestRecord.llsFuelLevel4 ??
                  latestRecord.llsFuelLevel5 ?? null,
        llsLevel1: latestRecord.llsFuelLevel1 ?? null,
        llsLevel2: latestRecord.llsFuelLevel2 ?? null,
        // Ultrasonic sensor fuel level (mm) — IO element 327
        ulLevel: latestRecord.ulFuelLevel ?? null,
        // Analog input 1 voltage (mV) — IO element 9 (resistive sensor)
        sensorVoltage: latestRecord.fuelSensorVoltage ?? latestRecord.analogInput1 ?? null,
        // GPS-calculated fuel usage
        used: latestRecord.fuelUsed ?? latestRecord.canFuelUsed ?? latestRecord.fuelUsedGps ?? null,
        rate: latestRecord.fuelRate ?? latestRecord.fuelRateGps ?? null,
      },
      // Engine Data (FMB125 specific)
      engine: {
        speed: latestRecord.engineSpeed ?? latestRecord.canEngineSpeed ?? null,
        temperature: latestRecord.engineTemp ?? latestRecord.canEngineTemp ?? null,
        load: latestRecord.engineLoad ?? latestRecord.canEngineLoad ?? null,
        hours: latestRecord.engineHours ?? null
      },
      // Trip Information
      trip: {
        odometer: latestRecord.totalOdometer ? latestRecord.totalOdometer / 1000 : null, // meters to km
        tripOdometer: latestRecord.tripOdometer ? latestRecord.tripOdometer / 1000 : null, // meters to km
        canMileage: latestRecord.canMileage ?? null
      },
      // Alerts
      alerts: {
        latestAlarm: latestRecord.alarmType || latestRecord.eventType || null,
        alarmTimestamp: latestRecord.alarmType ? latestRecord.timestamp : null
      },
      // Driver
      driver: {
        iButtonId: latestRecord.iButtonId ?? null,
        name: latestRecord.driverName ?? null
      },
      // Metadata
      lastUpdate: latestRecord.timestamp,
      priority: latestRecord.priority
    };

    // Advance lastUpdate to the absolute latest packet if it's newer than the GPS packet.
    // This ensures lastSeenSeconds reflects true last device contact, not just last GPS fix.
    if (absoluteLatest?.timestamp) {
      const absMs = new Date(absoluteLatest.timestamp).getTime();
      const curMs = aggregatedData.lastUpdate ? new Date(aggregatedData.lastUpdate).getTime() : 0;
      if (absMs > curMs) aggregatedData.lastUpdate = absoluteLatest.timestamp;
    }

    console.log(`[DEVICE/FMB125] Status: IGN=${aggregatedData.status.ignition}, FUEL=${aggregatedData.fuel.level}%, V=${aggregatedData.status.voltage}V, RPM=${aggregatedData.engine.speed}`);

    return aggregatedData;
  } catch (error) {
    console.error('[DEVICE/FMB125] Error:', error.message);
    return null;
  }
};

/**
 * Helper function to attach GPS data to a vehicle object
 */
const attachGpsData = async (vehicle) => {
  const vehicleJson = vehicle.toJSON();
  const gpsData = await fetchGpsData(vehicleJson.imei, vehicleJson.deviceType);
  return {
    ...vehicleJson,
    gpsData,
  };
};

/**
 * Helper function to attach comprehensive device status to a vehicle object
 * Used for sync operations to return complete vehicle status
 */
const attachComprehensiveStatus = async (vehicle) => {
  const vehicleJson = vehicle.toJSON();

  // Run MongoDB status fetch and MySQL device-state lookup in parallel
  const [deviceStatus, state] = await Promise.all([
    fetchComprehensiveDeviceStatus(vehicleJson.imei, vehicleJson.deviceType),
    VehicleDeviceState.findOne({
      where: { vehicleId: vehicleJson.id },
      attributes: ['engineOn', 'lastPacketTime', 'lastGpsPacketTime', 'lastLat', 'lastLng', 'lastSpeed', 'lastAltitude', 'lastSatellites', 'lastCourse',
                   'engineOffSince', 'speedZeroSince', 'runningStreak', 'firstSeenAt', 'lastSeenAt', 'lastMovement'],
    }),
  ]);

  // VehicleDeviceState is the authoritative real-time source maintained by processPacket.
  // Overrides apply to ALL device types:
  //   • ignition    — processPacket applies correct hysteresis / hardware signal per device type
  //   • lastUpdate  — reflects actual last-packet time, not just last GPS packet
  //   • gpsData     — fallback when MongoDB returned no coords (e.g. vehicle.deviceType is null/wrong
  //                   so fetchComprehensiveDeviceStatus queried the wrong collection, or no GPS-valid
  //                   packets exist yet in MongoDB for this IMEI)
  if (state) {
    const stateHasGps = state.lastLat && state.lastLng;

    if (!deviceStatus) {
      // MongoDB returned nothing — synthesise minimal deviceStatus from VehicleDeviceState
      if (stateHasGps) {
        return {
          ...vehicleJson,
          deviceStatus: {
            deviceType: vehicleJson.deviceType || 'Unknown',
            gpsData: {
              latitude:   parseFloat(state.lastLat),
              longitude:  parseFloat(state.lastLng),
              speed:      state.lastSpeed ?? 0,
              altitude:   state.lastAltitude != null ? parseFloat(state.lastAltitude) : null,
              satellites: state.lastSatellites ?? null,
              course:     state.lastCourse ?? null,
              timestamp:  state.lastPacketTime,
            },
            status:    { ignition: state.engineOn ?? false },
            // updatedAt = real server UTC (always correct for state evaluation).
            lastUpdate: state.updatedAt ?? state.lastPacketTime,
          },
        };
      }
    } else {
      // Override ignition and lastUpdate (VehicleDeviceState is more accurate).
      // Use state.updatedAt (real server UTC) for lastUpdate, NOT lastPacketTime —
      // lastPacketTime is device-reported and can be hours off when GT06 devices
      // send local time without timezone correction (GT06_TZ_OFFSET_MIN=0).  Using
      // updatedAt ensures lastSeenSeconds is computed against real wall-clock.
      if (state.engineOn != null) deviceStatus.status.ignition = state.engineOn;
      if (state.updatedAt)        deviceStatus.lastUpdate       = state.updatedAt;
      else if (state.lastPacketTime) deviceStatus.lastUpdate    = state.lastPacketTime;

      // Fill GPS coords from VehicleDeviceState when MongoDB had no valid GPS
      // (wrong deviceType → wrong collection queried, or no GPS-fix packets yet)
      if (stateHasGps && !deviceStatus.gpsData?.latitude) {
        deviceStatus.gpsData = {
          ...(deviceStatus.gpsData || {}),
          latitude:   parseFloat(state.lastLat),
          longitude:  parseFloat(state.lastLng),
          speed:      state.lastSpeed ?? 0,
          altitude:   state.lastAltitude != null ? parseFloat(state.lastAltitude) : null,
          satellites: state.lastSatellites ?? null,
          course:     state.lastCourse ?? null,
          timestamp:  state.lastPacketTime,
        };
      }
    }
  }

  // ── Derived state-machine fields ─────────────────────────────────────────
  // The client-side state evaluator (utils/vehicleState.js) reads these to
  // resolve the Idle / Stopped / Running rules.  Computed once here so every
  // chip / marker / detail card shares the same authoritative numbers.
  if (state && deviceStatus) {
    deviceStatus.status = deviceStatus.status || {};
    const now = Date.now();

    // ALWAYS override deviceStatus.lastUpdate with state.lastSeenAt — the only
    // field that exclusively reflects real packet processing in real server UTC.
    // Do NOT fall back to updatedAt: it is bumped by reconcileStaleTrips every
    // 10 min, which would artificially refresh "freshness" and cause Offline ↔
    // Stopped flicker.  If lastSeenAt is null (vehicle hasn't sent a packet
    // since the column was added), leave lastUpdate at whatever the MongoDB
    // path produced — and if that's also null, lastSeenSeconds will be null
    // (secsSince guards against null) so the Offline rule simply won't fire,
    // letting the vehicle show its true engine state until a real packet arrives.
    if (state.lastSeenAt) {
      deviceStatus.lastUpdate = state.lastSeenAt;
    }
    deviceStatus.status.ignitionOffSeconds = state.engineOffSince
      ? Math.floor((now - new Date(state.engineOffSince).getTime()) / 1000)
      : null;
    deviceStatus.status.speedZeroSeconds = state.speedZeroSince
      ? Math.floor((now - new Date(state.speedZeroSince).getTime()) / 1000)
      : null;
    // runningStreak: only meaningful if a recent real packet confirmed it.
    // Use state.lastSeenAt strictly — no updatedAt fallback (reconcile bumps it).
    // If lastSeenAt is null, treat as infinitely stale → streak forced to 0.
    // Use lastSeenAt (real packet time) for staleness check; fall back to
    // updatedAt if lastSeenAt is not yet populated (NULL after migration).
    // If neither is present, trust the DB value.
    // Conservative: no reliable timestamp → streak is stale → return 0.
    // Prevents a vehicle silent for hours from staying in Running because
    // lastSeenAt was never populated (NULL after the column was added).
    const streakTs = state.lastSeenAt || state.updatedAt;
    const streakAge = streakTs
      ? (Date.now() - new Date(streakTs).getTime())
      : Infinity;                    // no anchor → treat as infinitely old

    // Speed / motion are only valid as of the LAST DATA (GPS) packet. A vehicle
    // that's merely heartbeating (no GPS) keeps lastSeenAt fresh but its speed,
    // streak and movement are stale — so gate them on lastGpsPacketTime, the
    // time of the last position-bearing packet. Stale ⇒ present as "not moving"
    // so a parked vehicle is never shown Running with leftover speed.
    const GPS_STALE_MS = 180_000; // 3 min without a GPS packet
    const gpsTs = state.lastGpsPacketTime;
    const gpsStale = !gpsTs || (Date.now() - new Date(gpsTs).getTime()) > GPS_STALE_MS;

    deviceStatus.status.runningStreak = (gpsStale || streakAge > 90_000) ? 0 : (state.runningStreak ?? 0);
    // AIS140 physical movement sensor — only when the GPS data is current.
    deviceStatus.status.movement = gpsStale ? null : (state.lastMovement ?? null);
    // Don't show a leftover speed from when the vehicle last moved.
    if (gpsStale && deviceStatus.gpsData) deviceStatus.gpsData.speed = null;
  }

  // Registration date — Sequelize with underscored:true outputs registered_at
  vehicleJson.registeredAt = vehicleJson.registered_at || vehicleJson.createdAt || null;

  // First data packet — prefer MySQL firstSeenAt, fall back to querying MongoDB
  let firstSeenAt = (state && state.firstSeenAt) ? state.firstSeenAt : null;
  if (!firstSeenAt && vehicleJson.imei && isMongoDBConnected()) {
    try {
      const LocationModel = getLocationModel(vehicleJson.deviceType);
      const imeiVariations = [vehicleJson.imei, vehicleJson.imei.startsWith('0') ? vehicleJson.imei.substring(1) : `0${vehicleJson.imei}`];
      const firstPkt = await LocationModel.findOne({ imei: { $in: imeiVariations } })
        .sort({ timestamp: 1 })
        .select('timestamp')
        .lean();
      if (firstPkt?.timestamp) firstSeenAt = firstPkt.timestamp;
    } catch (_) { /* silent */ }
  }
  vehicleJson.firstSeenAt = firstSeenAt;

  return { ...vehicleJson, deviceStatus };
};

// Accepts a Sequelize vehicle-scope where-fragment from buildVehicleScope():
//   { clientId: <id|[ids]> }  (account ownership scope) or
//   { id: [ids] }             (team-member scope).
const getVehicles = async (scope) => {
  console.log('[GET_VEHICLES] scope:', JSON.stringify(scope));
  const vehicles = await Vehicle.findAll({
    where: { ...scope, status: { [Op.ne]: 'deleted' } },
    include: [{ model: RtoDetail, as: 'rtoDetail' }]
  });
  
  console.log(`[GET_VEHICLES] Found ${vehicles.length} vehicles, fetching comprehensive device status for each...`);
  
  // Fetch comprehensive device status for all vehicles in parallel
  const vehiclesWithStatus = await Promise.all(
    vehicles.map(vehicle => attachComprehensiveStatus(vehicle))
  );
  
  console.log('[GET_VEHICLES] ✓ All vehicles loaded with device status');
  return vehiclesWithStatus;
};

const getVehicleById = async (id, callerClientIds) => {
  const vehicle = await Vehicle.findOne({
    where: { id },
    include: [{ model: RtoDetail, as: 'rtoDetail' }],
  });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const allowedIds = Array.isArray(callerClientIds) ? callerClientIds : [callerClientIds];
  if (!allowedIds.includes(vehicle.clientId)) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  return await attachGpsData(vehicle);
};

const addVehicle = async (clientId, { vehicleNumber, vehicleName, chasisNumber, engineNumber, imei, sim1, sim2, branch, deviceName, deviceType, serverIp, serverPort, vehicleIcon, fuelSupported, fuelTankCapacity }) => {
  if (vehicleNumber) {
    const existing = await Vehicle.findOne({ where: { vehicleNumber: vehicleNumber.toUpperCase() } });
    if (existing) {
      const err = new Error('Vehicle with this number is already registered');
      err.status = 409;
      throw err;
    }
  }

  const user = await User.findByPk(clientId);
  // If user has a parent, use that; otherwise use the user's own ID (they are the parent)
  const parentId = user?.parentId || clientId;

  return Vehicle.create({
    clientId,
    parentId,
    vehicleNumber: vehicleNumber ? vehicleNumber.toUpperCase() : null,
    vehicleName: vehicleName || null,
    chasisNumber,
    engineNumber,
    imei,
    sim1:   sim1   || null,
    sim2:   sim2   || null,
    branch: branch || null,
    deviceName: deviceName || null,
    deviceType: deviceType || null,
    serverIp: serverIp || null,
    serverPort: serverPort ? parseInt(serverPort, 10) : null,
    vehicleIcon: vehicleIcon || 'car',
    fuelSupported: !!fuelSupported,
    fuelTankCapacity: fuelTankCapacity ? parseInt(fuelTankCapacity, 10) : null,
  });
};

const updateVehicle = async (id, clientId, data, callerClientIds, actor = {}) => {
  // Allow papa/dealer to edit any vehicle that belongs to their network.
  // Fall back to exact-match when callerClientIds is not provided (old call sites).
  const allIds = callerClientIds?.length ? callerClientIds : [clientId];
  const vehicle = await Vehicle.findOne({ where: { id, clientId: allIds } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  // Snapshot tracked fields BEFORE the update so we can diff for the audit log.
  const before = {};
  for (const f of Object.keys(TRACKED_FIELDS)) before[f] = vehicle.get(f);
  const prevImei = vehicle.imei;

  // Invalidate cache before update in case IMEI changes
  if (vehicle.imei) invalidateVehicleCache(vehicle.imei);
  await vehicle.update(data);
  if (data.imei && data.imei !== prevImei) invalidateVehicleCache(data.imei);

  // Record one history row per tracked field that actually changed.
  try {
    const changes = [];
    for (const [field, label] of Object.entries(TRACKED_FIELDS)) {
      // Only consider fields the caller actually sent.
      if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
      const oldNorm = normaliseValue(before[field]);
      const newNorm = normaliseValue(vehicle.get(field));
      if (oldNorm === newNorm) continue;
      changes.push({
        vehicleId: vehicle.id,
        field,
        fieldLabel: label,
        oldValue: oldNorm === '' ? null : oldNorm,
        newValue: newNorm === '' ? null : newNorm,
        userId: actor.id ?? null,
        userName: actor.name || actor.email || null,
      });
    }
    if (changes.length) await VehicleEditHistory.bulkCreate(changes);
  } catch (e) {
    // Never fail the edit because the audit write failed.
    console.error('[vehicle] edit-history write failed:', e.message);
  }

  // Attach GPS data to updated vehicle
  return await attachGpsData(vehicle);
};

/**
 * Paginated edit history for a vehicle (newest first), scoped to the caller's
 * network so users only see audit rows for vehicles they own.
 */
const getEditHistory = async (id, callerClientIds, { limit = 100, offset = 0 } = {}) => {
  const vehicle = await Vehicle.findOne({
    where: { id, clientId: callerClientIds?.length ? callerClientIds : undefined },
    attributes: ['id'],
  });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const { count, rows } = await VehicleEditHistory.findAndCountAll({
    where: { vehicleId: id },
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  return {
    total: count,
    rows: rows.map((r) => ({
      id: r.id,
      field: r.field,
      fieldLabel: r.fieldLabel,
      oldValue: r.oldValue,
      newValue: r.newValue,
      userId: r.userId,
      userName: r.userName,
      changedAt: r.get('created_at'),
    })),
  };
};

const deleteVehicle = async (id, callerClientIds) => {
  const vehicle = await Vehicle.findOne({ where: { id } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const allowedIds = Array.isArray(callerClientIds) ? callerClientIds : [callerClientIds];
  if (!allowedIds.includes(vehicle.clientId)) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  // Clear from packet processor cache so live stream stops writing to this vehicle
  if (vehicle.imei) invalidateVehicleCache(vehicle.imei);
  await vehicle.update({ status: 'deleted' });
  return { message: 'Vehicle deleted successfully' };
};

const syncVehicleData = async (id, callerClientIds) => {
  // Find vehicle by id, then verify the caller has access to its owner
  const vehicle = await Vehicle.findOne({
    where: { id },
    include: [{ model: RtoDetail, as: 'rtoDetail' }],
  });

  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  const allowedIds = Array.isArray(callerClientIds) ? callerClientIds : [callerClientIds];
  if (!allowedIds.includes(vehicle.clientId)) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  // Attach comprehensive device status (GPS + status + alarms + trip data)
  return await attachComprehensiveStatus(vehicle);
};

const testGpsData = async (imei) => {
  try {
    // Check MongoDB connection before querying
    if (!isMongoDBConnected()) {
      return {
        error: 'MongoDB not connected',
        message: 'GPS data unavailable - MongoDB connection is not established'
      };
    }
    
    // Get total count of records in collection
    const totalCount = await Location.countDocuments();
    
    // Get sample of all unique IMEIs
    const uniqueImeis = await Location.distinct('imei');
    
    // Search for exact match
    const exactMatch = await Location.findOne({ imei }).lean();
    
    // Search for partial match (case-insensitive)
    const partialMatch = await Location.findOne({ 
      imei: { $regex: imei, $options: 'i' } 
    }).lean();
    
    // Get all variations (with/without leading zeros)
    const withZero = await Location.findOne({ imei: `0${imei}` }).lean();
    const withoutZero = imei.startsWith('0') 
      ? await Location.findOne({ imei: imei.substring(1) }).lean() 
      : null;
    
    return {
      testedImei: imei,
      collectionStats: {
        totalRecords: totalCount,
        uniqueImeis: uniqueImeis.length,
        sampleImeis: uniqueImeis.slice(0, 10)
      },
      searchResults: {
        exactMatch: exactMatch ? 'FOUND' : 'NOT FOUND',
        partialMatch: partialMatch ? 'FOUND' : 'NOT FOUND',
        withLeadingZero: withZero ? 'FOUND' : 'NOT FOUND',
        withoutLeadingZero: withoutZero ? 'FOUND' : 'NOT FOUND'
      },
      sampleRecord: exactMatch || partialMatch || withZero || withoutZero || null
    };
  } catch (error) {
    console.error('[GPS TEST] Error:', error);
    throw error;
  }
};

/**
 * Get location history for a vehicle within a date range for playback
 * @param {number} id - Vehicle ID
 * @param {number} clientId - Client ID (for authorization)
 * @param {string} from - Start date/time (ISO 8601 format)
 * @param {string} to - End date/time (ISO 8601 format)
 * @param {number} limit - Maximum number of records to return (default: 10000)
 * @param {number} skip - Number of records to skip for pagination (default: 0)
 * @returns {Object} Vehicle info and location history
 */
const getLocationPlayerData = async (id, callerClientIds, from, to, limit = 10000, skip = 0) => {
  // Find by id only, then verify the caller has access to its owner client
  const vehicle = await Vehicle.findOne({ where: { id } });

  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  const allowedIds = Array.isArray(callerClientIds) ? callerClientIds : [callerClientIds];
  if (!allowedIds.includes(vehicle.clientId)) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  if (!vehicle.imei) {
    const err = new Error('Vehicle does not have an IMEI configured');
    err.status = 400;
    throw err;
  }

  // Check MongoDB connection
  if (!isMongoDBConnected()) {
    const err = new Error('GPS data unavailable - MongoDB connection is not established');
    err.status = 503;
    throw err;
  }

  try {
    // Parse dates
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      const err = new Error('Invalid date format. Use ISO 8601 format (e.g., 2024-03-01T00:00:00Z)');
      err.status = 400;
      throw err;
    }

    if (fromDate > toDate) {
      const err = new Error('From date cannot be after To date');
      err.status = 400;
      throw err;
    }

    console.log(`[Location Player] Fetching data for IMEI: ${vehicle.imei} from ${fromDate} to ${toDate}`);

    // Get correct location model based on device type
    const LocationModel = getLocationModel(vehicle.deviceType);
    console.log(`[Location Player] Using ${vehicle.deviceType || 'GT06'} collection`);

    // Normalize IMEI - try both with and without leading zero
    const imeiVariations = [
      vehicle.imei,
      vehicle.imei.startsWith('0') ? vehicle.imei.substring(1) : `0${vehicle.imei}`
    ];

    // Validate and sanitize pagination parameters
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10000), 50000); // Max 50k records
    const safeSkip = Math.max(0, parseInt(skip) || 0);

    // Get total count for the query (without pagination)
    const totalRecords = await LocationModel.countDocuments({
      imei: { $in: imeiVariations },
      timestamp: {
        $gte: fromDate,
        $lte: toDate
      },
      latitude: { $exists: true, $ne: null },
      longitude: { $exists: true, $ne: null }
    });

    // Query MongoDB for locations within date range
    // Only select essential fields to minimize data transfer
    const locations = await LocationModel.find({
      imei: { $in: imeiVariations },
      timestamp: {
        $gte: fromDate,
        $lte: toDate
      },
      latitude: { $exists: true, $ne: null },
      longitude: { $exists: true, $ne: null }
    })
      .sort({ timestamp: 1 }) // Ascending order for playback
      .select('timestamp latitude longitude speed satellites') // Only essential fields
      .skip(safeSkip)
      .limit(safeLimit)
      .lean();

    console.log(`[Location Player] Found ${locations.length} of ${totalRecords} total records (limit: ${safeLimit}, skip: ${safeSkip})`);

    return {
      vehicle: {
        id: vehicle.id,
        vehicleNumber: vehicle.vehicleNumber,
        imei: vehicle.imei
      },
      dateRange: {
        from: fromDate,
        to: toDate
      },
      pagination: {
        limit: safeLimit,
        skip: safeSkip,
        returned: locations.length,
        total: totalRecords,
        hasMore: (safeSkip + locations.length) < totalRecords
      },
      totalRecords,
      locations
    };
  } catch (error) {
    console.error('[Location Player] Error:', error);
    throw error;
  }
};

/**
 * GET /api/vehicles/live-positions — lightweight map auto-refresh
 * Reads only VehicleDeviceState (MySQL). No MongoDB. Fast.
 * GT06 ignition: engineOn already computed with speed-based logic by processPacket.
 */
/**
 * Reassign a vehicle to another client (within the caller's network).
 *
 * Vehicle-owned data (live state, trips/stops/engine/fuel history, challans,
 * RTO, sensors, custom fields, edit history) travels with the vehicle. Links
 * that belong to the PREVIOUS client are removed so they don't leak to / from
 * the new owner:
 *   • group memberships in the old client's groups
 *   • geofence assignments to the old client's geofences
 *   • vehicle-scoped alerts owned by the old client
 *   • any active live / trip shares for the vehicle
 *
 * All changes run in a single transaction.
 *
 * @param {number} vehicleId
 * @param {number} targetClientId  destination client (must be in callerClientIds)
 * @param {number[]} callerClientIds  caller's full network scope
 * @param {{id:number,name?:string,email?:string}} actor  who performed it (for audit)
 */
const reassignVehicle = async (vehicleId, targetClientId, callerClientIds, actor = {}) => {
  const allIds = callerClientIds?.length ? callerClientIds : [];
  const target = Number(targetClientId);
  if (!target || Number.isNaN(target)) {
    throw Object.assign(new Error('targetClientId is required'), { status: 400 });
  }

  // Vehicle must be in the caller's network.
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId: allIds } });
  if (!vehicle) throw Object.assign(new Error('Vehicle not found'), { status: 404 });

  // Target client must also be in the caller's network and must exist.
  if (!allIds.includes(target)) {
    throw Object.assign(new Error('You do not have access to the target client'), { status: 403 });
  }
  const targetUser = await User.findByPk(target);
  if (!targetUser) throw Object.assign(new Error('Target client not found'), { status: 404 });

  const oldClientId = vehicle.clientId;
  if (oldClientId === target) {
    throw Object.assign(new Error('Vehicle is already assigned to this client'), { status: 400 });
  }
  const newParentId = targetUser.parentId || target;

  if (vehicle.imei) invalidateVehicleCache(vehicle.imei);

  await sequelize.transaction(async (t) => {
    // 1. Remove memberships in the OLD client's groups.
    const oldGroups = await VehicleGroup.findAll({
      where: { clientId: oldClientId }, attributes: ['id'], transaction: t,
    });
    if (oldGroups.length) {
      await VehicleGroupMember.destroy({
        where: { vehicleId, groupId: oldGroups.map(g => g.id) }, transaction: t,
      });
    }

    // 2. Remove direct geofence assignments to the OLD client's geofences.
    const oldGeofences = await Geofence.findAll({
      where: { clientId: oldClientId }, attributes: ['id'], transaction: t,
    });
    if (oldGeofences.length) {
      await GeofenceAssignment.destroy({
        where: { vehicleId, geofenceId: oldGeofences.map(g => g.id) }, transaction: t,
      });
    }

    // 3. Remove vehicle-scoped alerts owned by the OLD client. (GROUP / ALL
    //    scoped alerts auto-exclude the vehicle once it leaves the client.)
    await Alert.destroy({
      where: { clientId: oldClientId, vehicleId, scope: 'VEHICLE' }, transaction: t,
    });

    // 4. Revoke any active shares exposing this vehicle.
    await LiveShare.destroy({ where: { vehicleId }, transaction: t });
    await TripShare.destroy({ where: { vehicleId }, transaction: t });

    // 5. Reassign ownership.
    await vehicle.update({ clientId: target, parentId: newParentId }, { transaction: t });

    // 6. Audit trail.
    await VehicleEditHistory.create({
      vehicleId,
      field: 'clientId',
      fieldLabel: 'Assigned Client',
      oldValue: String(oldClientId),
      newValue: String(target),
      userId: actor.id ?? null,
      userName: actor.name || actor.email || null,
    }, { transaction: t });
  });

  return await attachGpsData(vehicle);
};

const LIVE_COLL = {
  GT06: 'gt06locations', GT06N: 'gt06locations',
  FMB125: 'fmb125locations', FMB920: 'fmb920locations',
  AIS140: 'ais140locations',
};
const _imeiKey = (imei) => (imei || '').replace(/^0+/, ''); // normalise leading zeros

const getLivePositions = async (scope /*, since */) => {
  // Real-time map poll. The change-stream → VehicleDeviceState pipeline can fall
  // minutes behind under heavy packet load (its lastSeenAt looks fresh because
  // it's stamped at PROCESS time, but lastLat is whatever old packet is being
  // processed). So we OVERLAY the newest GPS fix straight from MongoDB — the same
  // current source a manual reload reads — and the marker tracks live regardless
  // of how far behind processPacket (trips/sessions) runs. VehicleDeviceState
  // still supplies the derived fields (runningStreak / speedZeroSince).
  //
  // `since` is intentionally ignored: we always return the full fleet so a moving
  // vehicle can never be starved out by a watermark cursor.
  const vehicles = await Vehicle.findAll({
    where: { ...scope, status: { [Op.ne]: 'deleted' } },
    attributes: ['id', 'imei', 'vehicleNumber', 'deviceType', 'vehicleIcon'],
  });
  if (!vehicles.length) return [];
  const vehicleIds = vehicles.map(v => v.id);

  const states = await VehicleDeviceState.findAll({
    where: { vehicleId: vehicleIds },
    attributes: [
      'vehicleId', 'lastLat', 'lastLng', 'lastSpeed', 'engineOn',
      'lastPacketTime', 'lastSeenAt', 'firstSeenAt',
      'speedZeroSince', 'engineOffSince', 'runningStreak', 'lastMovement',
    ],
  });
  const stateMap = new Map(states.map(s => [s.vehicleId, s]));

  // Newest GPS-bearing packet per IMEI, pulled directly from MongoDB using the
  // SAME proven pattern as syncVehicleData/reload: a per-IMEI index seek on
  // {imei:1, timestamp:-1} with limit 1 (fast — NOT a full-collection $group).
  const latest = new Map(); // normalised imei -> mongo doc
  try {
    const db = getMongoDb();
    await Promise.all(vehicles.map(async (v) => {
      const coll = LIVE_COLL[(v.deviceType || '').toUpperCase()];
      if (!coll || !v.imei) return;
      const variants = [v.imei, v.imei.startsWith('0') ? v.imei.slice(1) : '0' + v.imei];
      try {
        const doc = await db.collection(coll)
          .find({ imei: { $in: variants }, latitude: { $ne: null } })
          .sort({ timestamp: -1 })
          .limit(1)
          .next();
        if (doc) latest.set(_imeiKey(v.imei), doc);
      } catch { /* skip this vehicle, fall back to state row below */ }
    }));
  } catch (e) {
    console.warn('[livePositions] MongoDB overlay failed, falling back to MySQL state:', e.message);
  }

  const out = vehicles.map(v => {
    const s = stateMap.get(v.id) || {};
    const m = latest.get(_imeiKey(v.imei)); // newest GPS fix (fresh) or undefined

    const lat = m && m.latitude  != null ? parseFloat(m.latitude)  : (s.lastLat != null ? parseFloat(s.lastLat) : null);
    const lng = m && m.longitude != null ? parseFloat(m.longitude) : (s.lastLng != null ? parseFloat(s.lastLng) : null);
    const speed = m ? (m.speed != null ? Number(m.speed) : 0) : (s.lastSpeed ?? null);
    const engineOn = m
      ? (m.ignition != null ? Boolean(Number(m.ignition)) : (m.acc != null ? Boolean(m.acc) : (s.engineOn ?? false)))
      : (s.engineOn ?? false);
    // "Last heard" = MongoDB server insert time (fresh) over the lagging state row.
    const lastSeenAt = (m && (m.createdAt || m.serverTimestamp)) || s.lastSeenAt || null;

    return {
      id:             v.id,
      vehicleNumber:  v.vehicleNumber,
      deviceType:     v.deviceType,
      vehicleIcon:    v.vehicleIcon,
      lat, lng, speed, engineOn,
      firstSeenAt:    s.firstSeenAt ?? null,
      lastSeenAt,
      lastPacketTime: (m && m.timestamp) || s.lastPacketTime || null,
      registeredAt:   v.createdAt ?? null,
      speedZeroSince: s.speedZeroSince ?? null,
      engineOffSince: s.engineOffSince ?? null,
      runningStreak:  s.runningStreak ?? 0,
      movement:       s.lastMovement ?? null,
    };
  });

  return out;
};

module.exports = { getVehicles, getVehicleById, addVehicle, updateVehicle, reassignVehicle, deleteVehicle, syncVehicleData, testGpsData, getLocationPlayerData, getLivePositions, getEditHistory };
