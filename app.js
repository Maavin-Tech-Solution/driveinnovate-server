require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const { sequelize } = require('./src/models');
const routes = require('./src/routes');
const mongoose = require('mongoose');
const { connectMongoDB, getMongoDb } = require('./src/config/mongodb');
const { processPacket, reconcileStaleTrips, catchUpMissedPackets } = require('./src/services/packetProcessor.service');
const { startAlertEngine } = require('./src/services/alertEngine.service');
const { seedBuiltIns } = require('./src/services/master.service');
const { runMigrations } = require('./src/config/migrate');
const { startTrialExpiryJob } = require('./src/jobs/trialExpiryJob');

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
  'https://app.driveinnovate.in',
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

// ─── Health check ─────────────────────────────────────────────────────────────
// /health — quick liveness check (no auth required)
app.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const mongoStateLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] || 'unknown';
  res.json({
    status: 'OK',
    message: 'DriveInnovate Server is running',
    timestamp: new Date(),
    mongo: { readyState: mongoState, label: mongoStateLabel },
  });
});

// /api/health/mongo — detailed MongoDB diagnostics (papa only)
// Shows: connection state, change-stream collection names, and pending-write
// buffer sizes per device server (the in-memory queues that absorb Atlas outages).
app.get('/api/health/mongo', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const mongoState = mongoose.connection.readyState;
  const mongoStateLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] || 'unknown';
  const healthy = mongoState === 1;

  res.json({
    success: true,
    data: {
      mongo: {
        readyState:    mongoState,
        label:         mongoStateLabel,
        healthy,
        checkedAt:     new Date().toISOString(),
      },
      changeStreams: _activeStreams.map(s => ({
        collection: s.colName,
        deviceType: s.deviceType,
        alive:      s.alive,
        startedAt:  s.startedAt,
      })),
      advice: healthy ? null : [
        'MongoDB is not connected. Change streams and live packet processing are paused.',
        'Packets from device TCP servers are being buffered in memory.',
        'Processing will resume automatically when MongoDB reconnects.',
        'Manually trigger /api/health/mongo again in 30s to check reconnect status.',
      ],
    },
  });
});

// Registry updated by watchCollection so /api/health/mongo can report stream state.
const _activeStreams = [];

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
  .then(() => runMigrations())
  .then(() => reconcileStaleTrips())
  .then(() => seedBuiltIns().then(() => console.log('✓ Built-in device configs seeded')))
  .then(() => {
    console.log('Attempting MongoDB connection for GPS data...');
    // Connect to MongoDB (non-blocking)
    return connectMongoDB()
      .then(() => {
        console.log('✓ MongoDB connected - GPS tracking enabled');
        // Start real-time change streams, then catch up any missed packets in background
        return startChangeStreams().then(() => {
          catchUpMissedPackets().catch(err =>
            console.error('[CatchUp] Unhandled error:', err.message)
          );
        });
      })
      .catch((err) => {
        console.error('✖ MongoDB connection failed:', err.message);
        console.warn('⚠ Continuing without GPS data - check your MONGODB_URI configuration');
        return null; // Continue even if MongoDB fails
      });
  })
  .then(() => {
    const server = buildServer(app);
    server.listen(PORT, () => {
      const proto = server instanceof https.Server ? 'HTTPS' : 'HTTP';
      console.log(`DriveInnovate Server running on ${proto} port ${PORT}`);
      startAlertEngine();
      startTrialExpiryJob();
      // Run stale-trip reconciliation every 10 minutes so trips orphaned by
      // server spin-down (Render free tier) get closed without needing a restart.
      setInterval(reconcileStaleTrips, 10 * 60 * 1000);
      // Periodic catchup every 5 minutes: replays any MongoDB packets that
      // arrived during Atlas reconnect windows without being processed by a
      // change stream.  Combined with the stream-restart trigger above this
      // ensures no packet is permanently missed due to Atlas M0 downtime.
      setInterval(() => triggerCatchup('periodic 5-min sweep'), 5 * 60 * 1000);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MySQL database:', err.message);
    process.exit(1);
  });

/**
 * Build the HTTP or HTTPS server that wraps the Express app.
 *
 * When SSL_CERT and SSL_KEY both point to readable files, an HTTPS server is
 * returned (Node terminates TLS directly — no nginx needed in front).
 * Otherwise, a plain HTTP server is returned so local dev keeps working
 * without certs.
 */
function buildServer(expressApp) {
  const fs = require('fs');
  const certPath = process.env.SSL_CERT;
  const keyPath  = process.env.SSL_KEY;

  if (certPath && keyPath) {
    try {
      const cert = fs.readFileSync(certPath);
      const key  = fs.readFileSync(keyPath);
      console.log(`✓ TLS enabled — cert=${certPath}`);
      return https.createServer({ cert, key }, expressApp);
    } catch (err) {
      console.warn(`⚠ SSL_CERT/SSL_KEY set but unreadable (${err.message}) — falling back to HTTP`);
    }
  }
  return http.createServer(expressApp);
}

/**
 * Watch MongoDB collections for new packets and run them through the
 * PacketProcessor state machine in real time.
 *
 * Collections are driven from DeviceConfig (MySQL) so that adding a new device
 * type via master.service.js automatically starts a change stream on next
 * server restart — no code change needed in app.js.
 *
 * Retries with exponential backoff on error (e.g. replica-set not available).
 */
async function startChangeStreams() {
  let configs = [];
  try {
    const { DeviceConfig } = require('./src/models');
    configs = await DeviceConfig.findAll({ where: { isActive: true } });
  } catch (err) {
    console.warn('[ChangeStream] Could not read DeviceConfig from MySQL — falling back to defaults:', err.message);
  }

  // Fallback if DB read failed or table is empty
  if (!configs.length) {
    configs = [
      { mongoCollection: 'fmb125locations', type: 'FMB125' },
      { mongoCollection: 'gt06locations',   type: 'GT06'   },
      { mongoCollection: 'ais140locations', type: 'AIS140' },
    ];
  }

  // Deduplicate by mongoCollection (multiple device types may share a collection only if intentional)
  const seen = new Set();
  for (const cfg of configs) {
    const col        = cfg.mongoCollection || cfg.mongoCollection;
    const deviceType = cfg.type || cfg.deviceType;
    if (!col || !deviceType || seen.has(col)) continue;
    seen.add(col);
    watchCollection(col, deviceType);
  }
}

// Track the last time a catchup ran so we don't spam it on rapid stream restarts.
let _lastCatchupAt = 0;
const CATCHUP_COOLDOWN_MS = 2 * 60 * 1000; // at most once every 2 minutes

function triggerCatchup(reason) {
  const now = Date.now();
  if (now - _lastCatchupAt < CATCHUP_COOLDOWN_MS) {
    console.log(`[CatchUp] Skipped (cooldown active) — reason: ${reason}`);
    return;
  }
  _lastCatchupAt = now;
  console.log(`[CatchUp] Triggered — reason: ${reason}`);
  catchUpMissedPackets().catch(err =>
    console.error('[CatchUp] Error during triggered run:', err.message)
  );
}

function watchCollection(colName, deviceType, retryMs = 5000) {
  let stream;
  try {
    const db = getMongoDb();
    if (!db) return;

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
      stream.close().catch(() => {});
      setTimeout(() => {
        // After each stream restart, run a catchup to pick up any packets that
        // arrived while the stream was down.  This is the main fix for the
        // "trips vanish during Atlas reconnect" issue.
        watchCollection(colName, deviceType, wait);
        triggerCatchup(`${colName} stream restarted after: ${err.message}`);
      }, wait);
    };

    stream.on('error', scheduleRetry);

    stream.on('close', () => {
      if (mongoose.connection.readyState === 1) {
        scheduleRetry(new Error('stream closed unexpectedly'));
      }
    });

    const entry = { colName, deviceType, alive: true, startedAt: new Date().toISOString() };
    const existing = _activeStreams.findIndex(s => s.colName === colName);
    if (existing >= 0) _activeStreams[existing] = entry; else _activeStreams.push(entry);
    stream.on('close', () => { const e = _activeStreams.find(s => s.colName === colName); if (e) e.alive = false; });
    stream.on('error', () => { const e = _activeStreams.find(s => s.colName === colName); if (e) e.alive = false; });
    console.log(`✓ Change stream watching ${colName} (${deviceType})`);
  } catch (err) {
    console.warn(`[ChangeStream:${colName}] Failed to start:`, err.message);
    if (stream) stream.close().catch(() => {});
    setTimeout(() => {
      watchCollection(colName, deviceType, Math.min(retryMs * 2, 60000));
      triggerCatchup(`${colName} stream failed to start: ${err.message}`);
    }, retryMs);
  }
}

module.exports = app;
