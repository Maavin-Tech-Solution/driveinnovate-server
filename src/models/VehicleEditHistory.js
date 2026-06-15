const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Audit trail of vehicle edits — one row per changed field per save.
 * Created automatically by sequelize.sync({ alter:false }) on server start.
 */
const VehicleEditHistory = sequelize.define(
  'VehicleEditHistory',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Vehicle that was edited',
    },
    field: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Model field name that changed (e.g. imei, deviceType)',
    },
    fieldLabel: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Human-friendly label for the field',
    },
    oldValue: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Previous value (null when not previously set)',
    },
    newValue: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'New value after the edit',
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'User who made the change',
    },
    userName: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Snapshot of the editing user name/email at edit time',
    },
  },
  {
    tableName: 'di_vehicle_edit_history',
    underscored: true,
    timestamps: true,
    // Only the creation time matters for an append-only audit log.
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      { fields: ['vehicle_id'] },
    ],
  }
);

module.exports = VehicleEditHistory;
