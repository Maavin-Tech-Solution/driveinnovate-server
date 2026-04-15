const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://smartchallan_db_user:8fkvGyui9xhr3w9M@driveinnovate-stage.omkysrq.mongodb.net/di-stage?appName=driveinnovate-stage';
const MONGODB_PORT = process.env.MONGODB_PORT || '5023';

let isConnected = false;

const connectMongoDB = async () => {
  if (isConnected) {
    console.log('MongoDB already connected');
    return mongoose.connection;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000, // Atlas needs longer: 15s
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      heartbeatFrequencyMS: 10000,     // Probe server every 10s; keeps connections alive
      maxPoolSize: 10,                 // Don't exhaust Atlas connection quota
      minPoolSize: 2,                  // Keep 2 connections warm to avoid cold-start timeouts
      maxIdleTimeMS: 45000,            // Retire idle connections before NAT/firewall kills them (~60s)
      family: 4,                       // Force IPv4; avoids IPv6 DNS resolution delays on Atlas
      // bufferCommands defaults to true — let Mongoose queue ops during brief reconnects
    });
    isConnected = true;
    console.log('MongoDB connected successfully');
    
    // Set up connection event handlers
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
      isConnected = false;
    });
    
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err.message);
      isConnected = false;
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
    });
    
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    isConnected = false;
    throw error;
  }
};

// Helper to check if MongoDB is ready
const isMongoDBConnected = () => {
  return isConnected && mongoose.connection.readyState === 1;
};

// Get native MongoDB database object
const getMongoDb = () => {
  if (!isConnected || !mongoose.connection.db) {
    throw new Error('MongoDB not connected. Call connectMongoDB() first.');
  }
  return mongoose.connection.db;
};

// Location schema for GPS data
const locationSchema = new mongoose.Schema({
  imei: { type: String, required: true },
  deviceId: String,
  deviceModel: String,
  timestamp: { type: Date, index: true },
  raw: String,
  packetType: String,
  protocol: String,
  deviceType: String,
  serialNumber: Number,
  positioningType: String,
  // GPS fields
  latitude: Number,
  longitude: Number,
  speed: Number,
  altitude: Number,
  heading: Number,
  gpsTime: Date,
  satellites: Number,
  accuracy: Number,
  course: Number,
  mcc: String,
  mnc: String,
  lac: String,
  cellId: String,
}, { 
  collection: 'gt06locations',
  timestamps: true,
  strict: false // Allow additional fields not in schema
});

// Compound indexes for optimized queries
// Note: These are defined for schema reference but created via mongodb-indexes.js script
locationSchema.index({ imei: 1, timestamp: -1 }); // For latest location queries (sync)
locationSchema.index({ imei: 1, timestamp: 1 });  // For range queries (location player)

const Location = mongoose.model('Location', locationSchema);

// FMB125 Location schema for Teltonika FMB125 GPS data
const fmb125LocationSchema = new mongoose.Schema({
  imei: { type: String, required: true },
  deviceType: { type: String, default: 'FMB125' },
  timestamp: { type: Date, index: true },
  serverTimestamp: Date,
  priority: Number,
  // GPS fields
  latitude: Number,
  longitude: Number,
  altitude: Number,
  angle: Number,
  satellites: Number,
  speed: Number,
  hdop: Number,
  pdop: Number,
  // Fuel monitoring
  fuelLevel: Number,
  fuelUsed: Number,
  fuelRate: Number,
  fuelSensorVoltage: Number,
  // Vehicle status
  ignition: Boolean,
  movement: Boolean,
  engineSpeed: Number,
  engineTemp: Number,
  engineLoad: Number,
  engineHours: Number,
  // Odometer
  totalOdometer: Number,
  tripOdometer: Number,
  // Power & Battery
  externalVoltage: Number,
  batteryVoltage: Number,
  batteryCurrent: Number,
  batteryLevel: Number,
  // GSM/Network
  gsmSignal: Number,
  cellId: Number,
  areaCode: Number,
  operator: String,
  // Digital I/O
  digitalInput1: Boolean,
  digitalInput2: Boolean,
  digitalInput3: Boolean,
  digitalOutput1: Boolean,
  digitalOutput2: Boolean,
  // Analog inputs
  analogInput1: Number,
  analogInput2: Number,
  // CAN Bus
  canEngineSpeed: Number,
  canFuelLevel: Number,
  canFuelUsed: Number,
  canMileage: Number,
  canEngineTemp: Number,
  canEngineLoad: Number,
  // Driver
  iButtonId: String,
  driverName: String,
  // Accelerometer
  axisX: Number,
  axisY: Number,
  axisZ: Number,
  // Event/Alarm
  eventType: String,
  alarmType: String,
  // GPS fix
  gpsValid: Boolean,
  // Raw I/O elements
  ioElements: mongoose.Schema.Types.Mixed,
  codecType: Number,
  rawPacket: String,
}, { 
  collection: 'fmb125locations',
  timestamps: true,
  strict: false
});

fmb125LocationSchema.index({ imei: 1, timestamp: -1 });
fmb125LocationSchema.index({ imei: 1, timestamp: 1 });

const FMB125Location = mongoose.model('FMB125Location', fmb125LocationSchema);

// ─── AIS-140 / VLTD Location schema ──────────────────────────────────────────
// Matches the field set saved by the ais140/ TCP server.
const ais140LocationSchema = new mongoose.Schema({
  imei:             { type: String, required: true },
  vehicleRegNo:     String,
  vendorId:         String,
  firmwareVersion:  String,
  deviceType:       { type: String, default: 'AIS140' },
  packetType:       String,   // LGN | NMR | HBT | EMG | ALT
  packetStatus:     String,   // L (live) | H (history)
  replyNumber:      Number,
  timestamp:        { type: Date, index: true },
  // GPS
  latitude:         Number,
  longitude:        Number,
  latDir:           String,   // N / S
  lngDir:           String,   // E / W
  altitude:         Number,
  speed:            Number,
  heading:          Number,
  satellites:       Number,
  pdop:             Number,
  hdop:             Number,
  gpsValid:         Boolean,
  // Cell / network
  mcc:              String,
  mnc:              String,
  lac:              String,
  cellId:           String,
  gsmSignal:        Number,
  operatorName:     String,
  // Power
  ignition:         Number,   // 0 or 1
  mainPowerStatus:  Number,
  mainPowerVoltage: Number,   // Volts
  batteryVoltage:   Number,   // Volts
  // Alerts
  emergencyStatus:  Number,   // 0 or 1
  tamperAlert:      Number,   // 0 or 1
  alertType:        String,
  // Digital I/O
  di1: Number, di2: Number, di3: Number, di4: Number,
  do1: Number, do2: Number,
  ai1: Number, ai2: Number,
  // Odometer
  odometer:         Number,   // km
  // Raw
  raw: String,
}, {
  collection: 'ais140locations',
  timestamps: true,
  strict: false,
});

ais140LocationSchema.index({ imei: 1, timestamp: -1 });
ais140LocationSchema.index({ imei: 1, timestamp: 1 });

const AIS140Location = mongoose.model('AIS140Location', ais140LocationSchema);

module.exports = {
  connectMongoDB,
  getMongoDb,
  Location,
  FMB125Location,
  AIS140Location,
  MONGODB_PORT,
  isMongoDBConnected
};
