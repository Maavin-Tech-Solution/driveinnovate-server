const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SpeedViolation = sequelize.define('SpeedViolation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  vehicleId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'vehicle_id',
    references: {
      model: 'di_user_vehicle',
      key: 'id'
    }
  },
  imei: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false
  },
  speed: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    comment: 'Speed in km/h'
  },
  speedLimit: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    field: 'speed_limit',
    comment: 'Speed limit in km/h'
  },
  excessSpeed: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    field: 'excess_speed',
    comment: 'How much over the limit in km/h'
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: false
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: false
  },
  location: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Reverse geocoded location (city, road)'
  },
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Duration of violation in seconds'
  },
  severity: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
    defaultValue: 'LOW',
    comment: 'LOW: 1-10 km/h over, MEDIUM: 11-20, HIGH: 21-40, CRITICAL: >40'
  },
  acknowledged: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Has violation been reviewed/acknowledged'
  },
  acknowledgedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'acknowledged_by',
    references: {
      model: 'di_user',
      key: 'id'
    }
  },
  acknowledgedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'acknowledged_at'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'speed_violations',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'idx_vehicle_timestamp',
      fields: ['vehicle_id', 'timestamp']
    },
    {
      name: 'idx_imei_timestamp',
      fields: ['imei', 'timestamp']
    },
    {
      name: 'idx_severity',
      fields: ['severity']
    },
    {
      name: 'idx_acknowledged',
      fields: ['acknowledged']
    }
  ]
});

module.exports = SpeedViolation;
