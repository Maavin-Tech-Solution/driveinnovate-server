const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserSettings = sequelize.define(
  'UserSettings',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
      unique: true,
    },
    speedRanges: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'speed_ranges',
      defaultValue: [
        { min: 0, max: 10, color: '#22c55e', label: 'Idle' },
        { min: 10, max: 40, color: '#3b82f6', label: 'Slow' },
        { min: 40, max: 80, color: '#f59e0b', label: 'Normal' },
        { min: 80, max: 120, color: '#ef4444', label: 'Fast' },
        { min: 120, max: 999, color: '#dc2626', label: 'Overspeed' },
      ],
    },
    speedThreshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'speed_threshold',
      defaultValue: 80,
    },
    createdAt: {
      type: DataTypes.DATE,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'user_settings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = UserSettings;
