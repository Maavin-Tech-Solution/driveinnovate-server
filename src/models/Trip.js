const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Trip = sequelize.define('Trip', {
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
    allowNull: false,
    field: 'end_time'
  },
  duration: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Trip duration in seconds'
  },
  distance: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Distance in kilometers'
  },
  startLatitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
    field: 'start_latitude'
  },
  startLongitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
    field: 'start_longitude'
  },
  startLocation: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'start_location'
  },
  endLatitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
    field: 'end_latitude'
  },
  endLongitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
    field: 'end_longitude'
  },
  endLocation: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'end_location'
  },
  avgSpeed: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    field: 'avg_speed',
    comment: 'Average speed in km/h'
  },
  maxSpeed: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    field: 'max_speed',
    comment: 'Maximum speed in km/h'
  },
  idleTime: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'idle_time',
    comment: 'Total idle time in seconds'
  },
  fuelConsumed: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: true,
    field: 'fuel_consumed',
    comment: 'Estimated fuel consumed in liters'
  },
  routeData: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'route_data',
    comment: 'Array of coordinate points for route visualization'
  }
}, {
  tableName: 'trips',
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
      name: 'idx_start_time',
      fields: ['start_time']
    }
  ]
});

module.exports = Trip;
