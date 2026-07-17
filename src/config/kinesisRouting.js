'use strict';
/**
 * kinesisRouting — decides, per device type, whether packets reach the
 * PacketProcessor via the AWS Kinesis consumer or via the MongoDB change stream.
 *
 * A packet must be processed EXACTLY ONCE (processPacket is a state machine —
 * double-processing double-counts trip distance). So one env switch atomically
 * controls BOTH sides:
 *
 *   KINESIS_CONSUME_ENABLED=true  AND  type ∈ KINESIS_CONSUME_TYPES
 *     → app.js does NOT watch that type's Mongo collection
 *     → the Kinesis consumer processes that type's records
 *
 *   otherwise (default)
 *     → Mongo change stream handles the type exactly as today,
 *       and the Kinesis consumer ignores records of that type.
 *
 * Current pilot: KINESIS_CONSUME_TYPES=GT06 — only GT06 rides Kinesis; AIS140
 * and FMB125 stay on the change stream untouched.
 *
 * NOTE: routing is enforced per *collection* (change streams are per
 * collection). GT06 and GT06N share `gt06locations`, so routing GT06 also
 * routes GT06N — they come from the same device server and producer anyway.
 */

const { getCapabilities } = require('./deviceCapabilities');

const CONSUME_ENABLED = String(process.env.KINESIS_CONSUME_ENABLED || 'false').toLowerCase() === 'true';

const ROUTED_TYPES = (process.env.KINESIS_CONSUME_TYPES || 'GT06')
  .split(',')
  .map(t => t.trim().toUpperCase())
  .filter(Boolean);

// Collections whose change streams must be skipped when consuming from Kinesis.
const ROUTED_COLLECTIONS = new Set(
  CONSUME_ENABLED ? ROUTED_TYPES.map(t => getCapabilities(t).mongoCollection) : []
);

/** Is the Kinesis consumer active at all? */
function kinesisConsumeEnabled() { return CONSUME_ENABLED; }

/** Should this device type's records be processed from Kinesis? */
function isTypeRouted(deviceType) {
  return CONSUME_ENABLED && ROUTED_TYPES.includes(String(deviceType || '').toUpperCase());
}

/** Should this Mongo collection's change stream be skipped? */
function isCollectionRouted(collectionName) {
  return ROUTED_COLLECTIONS.has(collectionName);
}

function routedTypes() { return [...ROUTED_TYPES]; }
function routedCollections() { return [...ROUTED_COLLECTIONS]; }

module.exports = {
  kinesisConsumeEnabled, isTypeRouted, isCollectionRouted, routedTypes, routedCollections,
};
