require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { sequelize } = require('./src/models');
const routes = require('./src/routes');
const mongoose = require('mongoose');
const { connectMongoDB, getMongoDb } = require('./src/config/mongodb');
const { processPacket } = require('./src/services/packetProcessor.service');
const { startAlertEngine } = require('./src/services/alertEngine.service');
const { seedBuiltIns } = require('./src/services/master.service');

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
  'http://localhost:64620',
  'https://master.d2frc3czi74u9j.amplifyapp.com'
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

// Serve uploaded support attachments as static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'DriveInnovate Server is running', timestamp: new Date() });
});

// Serve React build + SPA fallback (production only — skipped when dist doesn't exist in dev)
const clientDist = path.join(__dirname, '../client/dist');
const fs = require('fs');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // All non-API routes (including /share/:token, /my-fleet, etc.) serve index.html
  // so React Router can handle client-side navigation on direct URL access
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

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
  .then(() => seedBuiltIns().then(() => console.log('✓ Built-in device configs seeded')))
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
      startAlertEngine();
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
  let stream;
  try {
    const db = getMongoDb();
    if (!db) return; // MongoDB not connected

    const col = db.collection(colName);
    stream = col.watch([{ $match: { operationType: 'insert' } }], {
      fullDocument: 'updateLookup',
    });

    stream.on('change', async (event) => {
      const doc = event.fullDocument;
      if (doc) {
        console.log(`[ChangeStream:${colName}] insert imei=${doc.imei}`);
        await processPacket(doc, deviceType).catch((err) =>
          console.error(`[ChangeStream:${colName}] processPacket error:`, err.message)
        );
      }
    });

    const scheduleRetry = (err) => {
      const wait = Math.min(retryMs * 2, 60000);
      console.warn(`[ChangeStream:${colName}] ${err.message} — retrying in ${wait / 1000}s`);
      // Close cleanly before retry so the connection returns to the pool
      stream.close().catch(() => {});
      setTimeout(() => watchCollection(colName, deviceType, wait), wait);
    };

    stream.on('error', scheduleRetry);

    // Atlas change streams can go 'closed' without emitting 'error' on network timeout
    stream.on('close', () => {
      // Only retry if Mongoose is still connected (avoid retry storm on intentional shutdown)
      if (mongoose.connection.readyState === 1) {
        scheduleRetry(new Error('stream closed unexpectedly'));
      }
    });

    console.log(`✓ Change stream watching ${colName} (${deviceType})`);
  } catch (err) {
    console.warn(`[ChangeStream:${colName}] Failed to start:`, err.message);
    if (stream) stream.close().catch(() => {});
    setTimeout(() => watchCollection(colName, deviceType, Math.min(retryMs * 2, 60000)), retryMs);
  }
}

module.exports = app;
