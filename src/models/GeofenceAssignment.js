const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Links a Geofence to either a single Vehicle or a VehicleGroup.
 * One geofence can have many assignments (e.g. assigned to 3 vehicles and 2 groups).
 * Each assignment independently controls entry/exit alert behaviour.
 */
const GeofenceAssignment = sequelize.define(
  'GeofenceAssignment',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    geofenceId: { type: DataTypes.INTEGER, allowNull: false, field: 'geofence_id' },

    /**
     * VEHICLE — assignment targets a single vehicle (vehicleId must be set)
     * GROUP   — assignment targets all vehicles in a group (groupId must be set)
     */
    scope: {
      type: DataTypes.ENUM('VEHICLE', 'GROUP'),
      allowNull: false,
    },

    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'vehicle_id',
      comment: 'Populated when scope = VEHICLE',
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'group_id',
      comment: 'Populated when scope = GROUP',
    },

    /** Fire a notification when a vehicle enters the geofence */
    alertOnEntry: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'alert_on_entry',
    },

    /** Fire a notification when a vehicle exits the geofence */
    alertOnExit: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'alert_on_exit',
    },
  },
  {
    tableName: 'geofence_assignments',
    underscored: true,
    timestamps: true,
    indexes: [
      // prevent the same vehicle being assigned to the same geofence twice
      { unique: true, fields: ['geofence_id', 'vehicle_id'], where: { scope: 'VEHICLE' } },
      // prevent the same group being assigned to the same geofence twice
      { unique: true, fields: ['geofence_id', 'group_id'], where: { scope: 'GROUP' } },
    ],
  }
);

module.exports = GeofenceAssignment;
