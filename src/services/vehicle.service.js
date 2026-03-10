const { Vehicle, RtoDetail, User } = require('../models');
const { Location, isMongoDBConnected } = require('../config/mongodb');

/**
 * Helper function to fetch GPS data from MongoDB for a given IMEI
 * Handles IMEI with or without leading zeros
 */
const fetchGpsData = async (imei) => {
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
    console.log(`[GPS] Searching for IMEI: ${imei}`);
    
    // Normalize IMEI - try both with and without leading zero
    const imeiVariations = [
      imei,
      imei.startsWith('0') ? imei.substring(1) : `0${imei}` // Toggle leading zero
    ];
    
    console.log(`[GPS] Trying IMEI variations:`, imeiVariations);
    
    // Try to fetch latest location with actual GPS coordinates using any IMEI variation
    // Only select required fields for performance
    const gpsData = await Location.findOne({ 
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
      const anyRecord = await Location.findOne({ imei: { $in: imeiVariations } }).lean();
      if (anyRecord) {
        console.log(`[GPS] Record exists but no coordinates. PacketType: ${anyRecord.packetType}`);
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
 */
const fetchComprehensiveDeviceStatus = async (imei) => {
  if (!imei) {
    console.log('[DEVICE] No IMEI provided');
    return null;
  }
  
  // Check MongoDB connection before querying
  if (!isMongoDBConnected()) {
    console.warn('[DEVICE] MongoDB not connected - skipping device status fetch');
    return null;
  }
  
  try {
    console.log(`[DEVICE] Fetching comprehensive status for IMEI: ${imei}`);
    
    // Normalize IMEI - try both with and without leading zero
    const imeiVariations = [
      imei,
      imei.startsWith('0') ? imei.substring(1) : `0${imei}`
    ];
    
    // Fetch latest packets of each important type in parallel
    const [locationData, locationExtData, statusData, heartbeatData, odometerData, voltageData, alarmData] = await Promise.all([
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
        packetType: 'LOCATION_EXT'
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
        .lean()
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
    
    // Build GPS data (prefer LOCATION_EXT for most recent with status)
    const gpsSource = locationExtData || locationData;
    if (gpsSource) {
      aggregatedData.gpsData = {
        latitude: gpsSource.latitude,
        longitude: gpsSource.longitude,
        speed: gpsSource.speed || 0,
        satellites: gpsSource.satellites || 0,
        course: gpsSource.course,
        gpsFixed: gpsSource.gpsFixed,
        timestamp: gpsSource.timestamp
      };
      aggregatedData.lastUpdate = gpsSource.timestamp;
    }
    
    // Aggregate status data from multiple sources (prefer most recent)
    // Ignition (ACC) - available in LOCATION, LOCATION_EXT, STATUS
    if (locationExtData?.acc !== undefined) aggregatedData.status.ignition = locationExtData.acc;
    else if (statusData?.acc !== undefined) aggregatedData.status.ignition = statusData.acc;
    else if (locationData?.acc !== undefined) aggregatedData.status.ignition = locationData.acc;
    
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
    
    // Update lastUpdate to the most recent timestamp
    const allTimestamps = [
      locationData?.timestamp,
      locationExtData?.timestamp,
      statusData?.timestamp,
      heartbeatData?.timestamp,
      odometerData?.timestamp,
      voltageData?.timestamp,
      alarmData?.timestamp
    ].filter(Boolean);
    
    if (allTimestamps.length > 0) {
      aggregatedData.lastUpdate = new Date(Math.max(...allTimestamps.map(t => new Date(t).getTime())));
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
 * Helper function to attach GPS data to a vehicle object
 */
const attachGpsData = async (vehicle) => {
  const vehicleJson = vehicle.toJSON();
  const gpsData = await fetchGpsData(vehicleJson.imei);
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
  const deviceStatus = await fetchComprehensiveDeviceStatus(vehicleJson.imei);
  return {
    ...vehicleJson,
    deviceStatus,
  };
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

const addVehicle = async (clientId, { vehicleNumber, chasisNumber, engineNumber, imei }) => {
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
    chasisNumber,
    engineNumber,
    imei,
  });
};

const updateVehicle = async (id, clientId, data) => {
  const vehicle = await Vehicle.findOne({ where: { id, clientId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  await vehicle.update(data);
  
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

    // Normalize IMEI - try both with and without leading zero
    const imeiVariations = [
      vehicle.imei,
      vehicle.imei.startsWith('0') ? vehicle.imei.substring(1) : `0${vehicle.imei}`
    ];

    // Validate and sanitize pagination parameters
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10000), 50000); // Max 50k records
    const safeSkip = Math.max(0, parseInt(skip) || 0);

    // Get total count for the query (without pagination)
    const totalRecords = await Location.countDocuments({
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
    const locations = await Location.find({
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

module.exports = { getVehicles, getVehicleById, addVehicle, updateVehicle, deleteVehicle, syncVehicleData, testGpsData, getLocationPlayerData };
