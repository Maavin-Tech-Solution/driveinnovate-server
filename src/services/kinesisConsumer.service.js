'use strict';
/**
 * kinesisConsumer — reads device packets from the AWS Kinesis stream and feeds
 * them to the PacketProcessor, replacing the MongoDB change stream for the
 * device types routed by kinesisRouting (pilot: GT06 only).
 *
 * Design notes
 *  - Filter-at-the-consumer: the stream may carry types the app is not yet
 *    ready to consume (e.g. AIS140 later). Records whose deviceType is NOT
 *    routed are skipped here — the Mongo change stream still handles them —
 *    so flipping KINESIS_ENABLED on a device server never double-processes.
 *  - Ordering: producers partition by IMEI, and the injected handler funnels
 *    into app.js enqueuePacket (per-vehicle promise chain), preserving the
 *    same serialization guarantee the change stream had.
 *  - Checkpoints: sequence number per shard on local disk
 *    (server/.kinesis-checkpoints/). Restart resumes AFTER the checkpoint;
 *    first run starts at ITERATOR_START (default LATEST so history already
 *    processed via the change stream is not replayed).
 *  - Failure isolation: never throws out of the poll loop; on repeated AWS
 *    errors it backs off and keeps retrying. It can never take the app down.
 *
 * JSON revival: Kinesis records are JSON, so Date fields arrive as ISO strings.
 * processPacket/normalizePacket expect real Dates (change-stream docs carried
 * BSON Dates) — revive the known date fields before handing the doc over.
 */

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const { kinesisConsumeEnabled, isTypeRouted, routedTypes } = require('../config/kinesisRouting');

const STREAM         = process.env.KINESIS_STREAM_NAME || 'driveinnovate-packets';
const REGION         = process.env.AWS_REGION || 'ap-south-1';
const START_TYPE     = (process.env.KINESIS_ITERATOR_START || 'LATEST').toUpperCase(); // LATEST | TRIM_HORIZON
const POLL_MS        = parseInt(process.env.KINESIS_POLL_INTERVAL_MS || '1200', 10);
const RESHARD_MS     = parseInt(process.env.KINESIS_RESHARD_SCAN_MS || String(5 * 60 * 1000), 10);
const CHECKPOINT_DIR = path.resolve(__dirname, '../../.kinesis-checkpoints');

const DATE_FIELDS = ['timestamp', 'serverTime', 'serverTimestamp', 'gpsTime', 'createdAt', 'updatedAt'];

let kinesis = null;
let _handler = null;                 // (doc, deviceType) => void  — injected by app.js
const _activeShards = new Set();
let _stopped = false;
const _stats = { processed: 0, skippedType: 0, parseErrors: 0, lastRecordAt: null, startedAt: null };

const log  = (...a) => console.log('[KinesisConsumer]', ...a);
const warn = (...a) => console.warn('[KinesisConsumer]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function reviveDates(doc) {
  for (const f of DATE_FIELDS) {
    if (typeof doc[f] === 'string') {
      const d = new Date(doc[f]);
      if (!isNaN(d.getTime())) doc[f] = d;
    }
  }
  return doc;
}

async function loadCheckpoint(shardId) {
  try {
    return JSON.parse(await fsp.readFile(path.join(CHECKPOINT_DIR, `${shardId}.json`), 'utf8')).sequenceNumber || null;
  } catch { return null; }
}

async function saveCheckpoint(shardId, sequenceNumber) {
  await fsp.mkdir(CHECKPOINT_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(CHECKPOINT_DIR, `${shardId}.json`),
    JSON.stringify({ shardId, sequenceNumber, updatedAt: new Date().toISOString() })
  );
}

async function consumeShard(shardId) {
  if (_activeShards.has(shardId)) return;
  _activeShards.add(shardId);
  const { GetShardIteratorCommand, GetRecordsCommand } = require('@aws-sdk/client-kinesis');

  let lastSeq = await loadCheckpoint(shardId);
  log(`shard ${shardId} starting (${lastSeq ? 'resume after checkpoint' : `fresh: ${START_TYPE}`})`);

  async function freshIterator() {
    const params = lastSeq
      ? { StreamName: STREAM, ShardId: shardId, ShardIteratorType: 'AFTER_SEQUENCE_NUMBER', StartingSequenceNumber: lastSeq }
      : { StreamName: STREAM, ShardId: shardId, ShardIteratorType: START_TYPE };
    return (await kinesis.send(new GetShardIteratorCommand(params))).ShardIterator;
  }

  let iterator = null;
  while (!_stopped) {
    try {
      if (!iterator) iterator = await freshIterator();
      const out = await kinesis.send(new GetRecordsCommand({ ShardIterator: iterator, Limit: 500 }));

      for (const rec of out.Records || []) {
        lastSeq = rec.SequenceNumber;
        try {
          const doc = reviveDates(JSON.parse(Buffer.from(rec.Data).toString('utf8')));
          if (!doc || !doc.imei) continue;
          const deviceType = (doc.deviceType || 'GT06').toUpperCase();
          if (!isTypeRouted(deviceType)) { _stats.skippedType++; continue; } // change stream owns this type
          _stats.processed++; _stats.lastRecordAt = new Date();
          _handler(doc, deviceType);
        } catch (e) { _stats.parseErrors++; warn('bad record skipped:', e.message); }
      }

      if (out.Records && out.Records.length) await saveCheckpoint(shardId, lastSeq);

      iterator = out.NextShardIterator; // null ⇒ shard closed after reshard
      if (!iterator) break;
      await sleep(out.Records && out.Records.length ? 150 : POLL_MS);
    } catch (e) {
      if (e.name === 'ExpiredIteratorException') { iterator = null; continue; }
      if (e.name === 'ProvisionedThroughputExceededException') { await sleep(2000); continue; }
      warn(`shard ${shardId} error (retrying in 5s):`, e.message);
      iterator = null;
      await sleep(5000);
    }
  }
  log(`shard ${shardId} ${_stopped ? 'stopped' : 'closed'}`);
  _activeShards.delete(shardId);
}

async function scanShards() {
  const { ListShardsCommand } = require('@aws-sdk/client-kinesis');
  try {
    let NextToken, first = true;
    do {
      const r = await kinesis.send(new ListShardsCommand(first ? { StreamName: STREAM } : { NextToken }));
      first = false;
      for (const sh of r.Shards || []) consumeShard(sh.ShardId).catch(e => warn('consumeShard:', e.message));
      NextToken = r.NextToken;
    } while (NextToken);
  } catch (e) { warn('ListShards error (will rescan):', e.message); }
}

/**
 * Start the consumer. No-op unless KINESIS_CONSUME_ENABLED=true.
 * @param {(doc: object, deviceType: string) => void} handler
 *        Called for every routed packet — app.js passes its enqueuePacket
 *        wrapper so per-vehicle serialization is preserved.
 */
function startKinesisConsumer(handler) {
  if (!kinesisConsumeEnabled()) {
    log('disabled (KINESIS_CONSUME_ENABLED != true) — change streams handle all types');
    return false;
  }
  try {
    const { KinesisClient } = require('@aws-sdk/client-kinesis');
    kinesis = new KinesisClient({ region: REGION, maxAttempts: 4 });
  } catch (e) {
    warn('AWS SDK not installed — consumer NOT started, change streams unaffected:', e.message);
    return false;
  }
  _handler = handler;
  _stats.startedAt = new Date();
  log(`starting → stream="${STREAM}" region="${REGION}" routedTypes=[${routedTypes().join(', ')}] start=${START_TYPE}`);
  scanShards();
  setInterval(scanShards, RESHARD_MS).unref(); // pick up shards after a reshard
  return true;
}

function stopKinesisConsumer() { _stopped = true; }

/** Health snapshot for /api/health/mongo. */
function getKinesisConsumerStatus() {
  return {
    enabled:      kinesisConsumeEnabled(),
    stream:       STREAM,
    routedTypes:  routedTypes(),
    activeShards: [..._activeShards],
    ..._stats,
  };
}

module.exports = { startKinesisConsumer, stopKinesisConsumer, getKinesisConsumerStatus };
