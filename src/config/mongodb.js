const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://smartchallan_db_user:8fkvGyui9xhr3w9M@driveinnovate-stage.omkysrq.mongodb.net/test?appName=driveinnovate-stage';
const MONGODB_PORT = process.env.MONGODB_PORT || '5023';

let isConnected = false;

const connectMongoDB = async () => {
  if (isConnected) {
    console.log('MongoDB already connected');
    return mongoose.connection;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000,
      bufferCommands: false, // Disable buffering - fail fast if not connected
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
  collection: 'locations',
  timestamps: true,
  strict: false // Allow additional fields not in schema
});

// Compound indexes for optimized queries
// Note: These are defined for schema reference but created via mongodb-indexes.js script
locationSchema.index({ imei: 1, timestamp: -1 }); // For latest location queries (sync)
locationSchema.index({ imei: 1, timestamp: 1 });  // For range queries (location player)

const Location = mongoose.model('Location', locationSchema);

module.exports = { 
  connectMongoDB, 
  getMongoDb,
  Location,
  MONGODB_PORT,
  isMongoDBConnected
};
