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
const { isCollectionRouted, kinesisConsumeEnabled, routedTypes } = require('./src/config/kinesisRouting');
const { startKinesisConsumer, getKinesisConsumerStatus } = require('./src/services/kinesisConsumer.service');
const { startAlertEngine } = require('./src/services/alertEngine.service');
const { seedBuiltIns } = require('./src/services/master.service');
const { runMigrations } = require('./src/config/migrate');
const { startTrialExpiryJob } = require('./src/jobs/trialExpiryJob');
const { startVehicleExpiryJob } = require('./src/jobs/vehicleExpiryJob');

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

// Serve static files from React build
// app.use(express.static(path.join(__dirname, 'build')));
// // app.get('*', (req, res) => {
// //   res.sendFile(path.join(__dirname, 'build', 'index.html'));
// // });

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
      // Phase-2 pilot: device types routed via AWS Kinesis instead of the
      // change stream (KINESIS_CONSUME_ENABLED + KINESIS_CONSUME_TYPES).
      kinesisConsumer: getKinesisConsumerStatus(),
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
// Live ChangeStream object per collection — lets us close the previous one
// before opening a new one so reconnect retries can't accumulate zombie streams
// (each zombie reprocesses every packet → duplicate DB writes + processing lag).
const _streamHandles = new Map();

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
  // .then(() => reconcileStaleTrips())
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
      // Phase-2 pilot: consume routed device types (GT06) from Kinesis.
      // Independent of MongoDB — processPacket writes MySQL. No-op unless
      // KINESIS_CONSUME_ENABLED=true. Routed packets flow through the same
      // per-vehicle enqueuePacket serialization as the change stream.
      if (kinesisConsumeEnabled()) {
        console.log(`[Kinesis] Routing ${routedTypes().join(', ')} through Kinesis consumer (change streams skipped for those collections)`);
      }
      startKinesisConsumer((doc, deviceType) => {
        enqueuePacket(doc.imei, () =>
          processPacket(doc, deviceType).catch(err =>
            console.error(`[KinesisConsumer] processPacket error imei=${doc.imei}:`, err.message)
          )
        );
      });
      startAlertEngine();
      startTrialExpiryJob();
      startVehicleExpiryJob();
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
    // Exactly-once guard: a collection routed to the Kinesis consumer must NOT
    // also be watched here — processing the same packet twice would corrupt the
    // trip/state machine (double-counted distance). kinesisRouting flips both
    // sides atomically off the same env vars.
    if (isCollectionRouted(col)) {
      console.log(`[ChangeStream] SKIP ${col} (${deviceType}) — routed via Kinesis consumer`);
      continue;
    }
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

// ── Per-vehicle serialisation queues ─────────────────────────────────────────
// Each IMEI gets a promise-chain so packets for the same vehicle are processed
// one at a time.  Different vehicles still run in parallel, giving us the
// throughput we need without the pool exhaustion caused by concurrent writes
// to the same VehicleDeviceState / Trip rows.
const _vehicleQueues = new Map(); // imei → Promise (tail of the chain)

function enqueuePacket(imei, fn) {
  const tail   = _vehicleQueues.get(imei) || Promise.resolve();
  const next   = tail.then(fn).catch(() => {}); // errors handled inside fn
  _vehicleQueues.set(imei, next);
  // Prune resolved entries so the Map doesn't grow forever
  next.finally(() => {
    if (_vehicleQueues.get(imei) === next) _vehicleQueues.delete(imei);
  });
}

function watchCollection(colName, deviceType, retryMs = 5000) {
  // Close + detach any existing stream for this collection FIRST, so a reconnect
  // retry never leaves a second (zombie) stream running on the same collection.
  const prev = _streamHandles.get(colName);
  if (prev) {
    try { prev.removeAllListeners?.(); } catch { /* noop */ }
    prev.close?.().catch(() => {});
    _streamHandles.delete(colName);
  }

  let stream;
  try {
    const db = getMongoDb();
    if (!db) return;

    const col = db.collection(colName);
    stream = col.watch([{ $match: { operationType: 'insert' } }], {
      fullDocument: 'updateLookup',
    });
    _streamHandles.set(colName, stream);

    stream.on('change', (event) => {
      const doc = event.fullDocument;
      if (!doc) return;
      const imei = doc.imei || 'unknown';
      console.log(`[ChangeStream:${colName}] insert imei=${imei}`);
      // Serialise per-vehicle — prevents concurrent DB writes to the same rows
      enqueuePacket(imei, () =>
        processPacket(doc, deviceType).catch((err) =>
          console.error(`[ChangeStream:${colName}] processPacket error:`, err.message)
        )
      );
    });

    // Retry EXACTLY ONCE per stream. A single failure usually fires both 'error'
    // AND 'close'; without this guard each fired a separate retry → two (then
    // four, …) replacement streams that all reprocess every packet.
    let retryScheduled = false;
    const scheduleRetry = (err) => {
      if (retryScheduled) return;
      retryScheduled = true;
      const wait = Math.min(retryMs * 2, 60000);
      console.warn(`[ChangeStream:${colName}] ${err.message} — retrying in ${wait / 1000}s`);
      try { stream.removeAllListeners?.(); } catch { /* noop */ }
      stream.close?.().catch(() => {});
      if (_streamHandles.get(colName) === stream) _streamHandles.delete(colName);
      const e = _activeStreams.find(s => s.colName === colName); if (e) e.alive = false;
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
    console.log(`✓ Change stream watching ${colName} (${deviceType})`);
  } catch (err) {
    console.warn(`[ChangeStream:${colName}] Failed to start:`, err.message);
    if (stream) stream.close?.().catch(() => {});
    if (_streamHandles.get(colName) === stream) _streamHandles.delete(colName);
    setTimeout(() => {
      watchCollection(colName, deviceType, Math.min(retryMs * 2, 60000));
      triggerCatchup(`${colName} stream failed to start: ${err.message}`);
    }, retryMs);
  }
}

module.exports = app;
