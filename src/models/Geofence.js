const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A geofence is a geographic boundary that can be:
 *  - CIRCULAR : defined by a center point + radius in metres
 *  - POLYGON  : defined by an ordered list of lat/lng vertices (closed shape)
 *
 * A geofence belongs to one client and can be assigned to individual
 * vehicles or vehicle groups via GeofenceAssignment.
 */
const Geofence = sequelize.define(
  'Geofence',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    clientId: { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },

    name: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.STRING(300), allowNull: true },

    /**
     * CIRCULAR — circle around a center point
     * POLYGON  — user-drawn closed polygon
     */
    type: {
      type: DataTypes.ENUM('CIRCULAR', 'POLYGON'),
      allowNull: false,
    },

    // ── CIRCULAR fields ──────────────────────────────────────────────────
    centerLat: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      field: 'center_lat',
      comment: 'Latitude of circle center (CIRCULAR type only)',
    },
    centerLng: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      field: 'center_lng',
      comment: 'Longitude of circle center (CIRCULAR type only)',
    },
    radiusMeters: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: 'radius_meters',
      comment: 'Radius in metres (CIRCULAR type only)',
    },

    // ── POLYGON fields ────────────────────────────────────────────────────
    /**
     * JSON array of ordered vertex objects: [{ lat: number, lng: number }, ...]
     * First and last point should form a closed ring (frontend enforces this).
     */
    coordinates: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Ordered vertex array [{lat, lng}] for POLYGON type',
    },

    /** Display colour used on the map and in the UI */
    color: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: '#3b82f6',
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active',
    },
  },
  {
    tableName: 'geofences',
    underscored: true,
    timestamps: true,
  }
);

module.exports = Geofence;
