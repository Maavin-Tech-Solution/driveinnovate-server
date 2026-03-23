require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./src/models');
const routes = require('./src/routes');
const { connectMongoDB, getMongoDb } = require('./src/config/mongodb');
const { processPacket } = require('./src/services/packetProcessor.service');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://driveinnovate.in',
  'https://www.driveinnovate.in',
  'https://stage.driveinnovate.in',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle preflight for all routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'DriveInnovate Server is running', timestamp: new Date() });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Database sync and server start
sequelize
  .authenticate()
  .then(() => {
    console.log('MySQL Database connected successfully.');
    return sequelize.sync({ alter: false });
  })
  .then(() => {
    console.log('Attempting MongoDB connection for GPS data...');
    // Connect to MongoDB (non-blocking)
    return connectMongoDB()
      .then(() => {
        console.log('✓ MongoDB connected - GPS tracking enabled');
        startChangeStreams();
      })
      .catch((err) => {
        console.error('✖ MongoDB connection failed:', err.message);
        console.warn('⚠ Continuing without GPS data - check your MONGODB_URI configuration');
        return null; // Continue even if MongoDB fails
      });
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`DriveInnovate Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MySQL database:', err.message);
    process.exit(1);
  });

/**
 * Watch MongoDB collections for new packets and run them through the
 * PacketProcessor state machine in real time.
 * Retries with backoff on error (e.g. replica set not available).
 */
function startChangeStreams() {
  const collections = [
    { name: 'fmb125locations', deviceType: 'FMB125' },
    { name: 'gt06locations',   deviceType: 'GT06' },
  ];

  for (const { name, deviceType } of collections) {
    watchCollection(name, deviceType);
  }
}

function watchCollection(colName, deviceType, retryMs = 5000) {
  try {
    const db = getMongoDb();
    if (!db) return; // MongoDB not connected

    const col = db.collection(colName);
    const stream = col.watch([{ $match: { operationType: 'insert' } }], {
      fullDocument: 'updateLookup',
    });

    stream.on('change', async (event) => {
      const doc = event.fullDocument;
      if (doc) {
        console.log(`[ChangeStream:${colName}] insert imei=${doc.imei} keys=${Object.keys(doc).join(',')}`);
        await processPacket(doc, deviceType).catch((err) =>
          console.error(`[ChangeStream:${colName}] processPacket error:`, err.message)
        );
      }
    });

    stream.on('error', (err) => {
      console.warn(`[ChangeStream:${colName}] Error, retrying in ${retryMs / 1000}s:`, err.message);
      stream.close();
      setTimeout(() => watchCollection(colName, deviceType, Math.min(retryMs * 2, 60000)), retryMs);
    });

    console.log(`✓ Change stream watching ${colName} (${deviceType})`);
  } catch (err) {
    console.warn(`[ChangeStream:${colName}] Failed to start, retrying:`, err.message);
    setTimeout(() => watchCollection(colName, deviceType, Math.min(retryMs * 2, 60000)), retryMs);
  }
}

module.exports = app;
