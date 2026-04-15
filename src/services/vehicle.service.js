const { Vehicle, RtoDetail, User, VehicleDeviceState } = require('../models');
const { Op } = require('sequelize');
const { Location, FMB125Location, AIS140Location, isMongoDBConnected } = require('../config/mongodb');
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

    const emergency = latestEmergency?.emergencyStatus
      ? true
      : (absoluteLatest?.emergencyStatus ? true : false);

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
      attributes: ['engineOn', 'lastPacketTime', 'lastLat', 'lastLng', 'lastSpeed', 'lastAltitude', 'lastSatellites', 'lastCourse'],
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
            lastUpdate: state.lastPacketTime,
          },
        };
      }
    } else {
      // Override ignition and lastUpdate (VehicleDeviceState is more accurate)
      if (state.engineOn != null) deviceStatus.status.ignition = state.engineOn;
      if (state.lastPacketTime)   deviceStatus.lastUpdate       = state.lastPacketTime;

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

  return { ...vehicleJson, deviceStatus };
};

const getVehicles = async (clientId) => {
  console.log('[GET_VEHICLES] Fetching vehicles for client:', clientId);
  const vehicles = await Vehicle.findAll({ 
    where: { clientId }, 
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

const getVehicleById = async (id, clientId) => {
  const vehicle = await Vehicle.findOne({
    where: { id, clientId },
    include: [{ model: RtoDetail, as: 'rtoDetail' }],
  });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  
  // Attach GPS data
  return await attachGpsData(vehicle);
};

const addVehicle = async (clientId, { vehicleNumber, vehicleName, chasisNumber, engineNumber, imei, deviceName, deviceType, serverIp, serverPort, vehicleIcon }) => {
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
    deviceName: deviceName || null,
    deviceType: deviceType || null,
    serverIp: serverIp || null,
    serverPort: serverPort ? parseInt(serverPort, 10) : null,
    vehicleIcon: vehicleIcon || 'car',
  });
};

const updateVehicle = async (id, clientId, data, callerClientIds) => {
  // Allow papa/dealer to edit any vehicle that belongs to their network.
  // Fall back to exact-match when callerClientIds is not provided (old call sites).
  const allIds = callerClientIds?.length ? callerClientIds : [clientId];
  const vehicle = await Vehicle.findOne({ where: { id, clientId: allIds } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  // Invalidate cache before update in case IMEI changes
  if (vehicle.imei) invalidateVehicleCache(vehicle.imei);
  await vehicle.update(data);
  if (data.imei && data.imei !== vehicle.imei) invalidateVehicleCache(data.imei);

  // Attach GPS data to updated vehicle
  return await attachGpsData(vehicle);
};

const deleteVehicle = async (id, clientId) => {
  const vehicle = await Vehicle.findOne({ where: { id, clientId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  // Clear from packet processor cache so live stream stops writing to this vehicle
  if (vehicle.imei) invalidateVehicleCache(vehicle.imei);
  await vehicle.update({ status: 'deleted' });
  return { message: 'Vehicle deleted successfully' };
};

const syncVehicleData = async (id, clientId) => {
  // Fetch vehicle from MySQL
  const vehicle = await Vehicle.findOne({
    where: { id, clientId },
    include: [{ model: RtoDetail, as: 'rtoDetail' }],
  });

  if (!vehicle) {
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
const getLocationPlayerData = async (id, clientId, from, to, limit = 10000, skip = 0) => {
  // Fetch vehicle from MySQL to verify ownership and get IMEI
  const vehicle = await Vehicle.findOne({
    where: { id, clientId },
  });

  if (!vehicle) {
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
const getLivePositions = async (clientId, since) => {
  const vehicles = await Vehicle.findAll({
    where: { clientId },
    attributes: ['id', 'vehicleNumber', 'deviceType', 'vehicleIcon'],
  });
  const vehicleIds = vehicles.map(v => v.id);
  if (!vehicleIds.length) return [];

  // When `since` is provided, only fetch states that changed since then.
  // This means unchanged vehicles are skipped entirely — client keeps their last known position.
  const stateWhere = { vehicleId: vehicleIds };
  if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate)) stateWhere.lastPacketTime = { [Op.gt]: sinceDate };
  }

  const states = await VehicleDeviceState.findAll({
    where: stateWhere,
    attributes: ['vehicleId', 'lastLat', 'lastLng', 'lastSpeed', 'engineOn', 'lastPacketTime'],
  });

  // Build a lookup of vehicle metadata
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

  return states.map(s => {
    const v = vehicleMap.get(s.vehicleId);
    if (!v) return null;
    return {
      id: v.id,
      vehicleNumber: v.vehicleNumber,
      deviceType: v.deviceType,
      vehicleIcon: v.vehicleIcon,
      lat: s.lastLat ? parseFloat(s.lastLat) : null,
      lng: s.lastLng ? parseFloat(s.lastLng) : null,
      speed: s.lastSpeed ?? 0,
      engineOn: s.engineOn ?? false,
      lastPacketTime: s.lastPacketTime ?? null,
    };
  }).filter(Boolean);
};

module.exports = { getVehicles, getVehicleById, addVehicle, updateVehicle, deleteVehicle, syncVehicleData, testGpsData, getLocationPlayerData, getLivePositions };
