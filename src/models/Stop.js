const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Stop = sequelize.define('Stop', {
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
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'start_time'
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'end_time'
  },
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Stop duration in seconds'
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
    comment: 'Reverse geocoded location'
  },
  stopType: {
    type: DataTypes.ENUM('PARKING', 'IDLE', 'TRAFFIC'),
    defaultValue: 'PARKING',
    field: 'stop_type',
    comment: 'PARKING: engine off, IDLE: engine on but not moving, TRAFFIC: temporary stop'
  },
  engineStatus: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    field: 'engine_status',
    comment: 'Engine on/off during stop'
  }
}, {
  tableName: 'stops',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'idx_vehicle_start_time',
      fields: ['vehicle_id', 'start_time']
    },
    {
      name: 'idx_imei_start_time',
      fields: ['imei', 'start_time']
    },
    {
      name: 'idx_stop_type',
      fields: ['stop_type']
    }
  ]
});

module.exports = Stop;
