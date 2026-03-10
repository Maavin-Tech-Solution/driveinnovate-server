const sequelize = require('../config/database');
const User = require('./User');
const UserMeta = require('./UserMeta');
const UserSettings = require('./UserSettings');
const Vehicle = require('./Vehicle');
const Challan = require('./Challan');
const RtoDetail = require('./RtoDetail');
const UserActivity = require('./UserActivity');
const AuthOtp = require('./AuthOtp');
const SpeedViolation = require('./SpeedViolation');
const Trip = require('./Trip');
const Stop = require('./Stop');

// Associations
User.hasOne(UserMeta, { foreignKey: 'userId', as: 'meta' });
UserMeta.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasOne(UserSettings, { foreignKey: 'userId', as: 'settings' });
UserSettings.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(Vehicle, { foreignKey: 'clientId', as: 'vehicles' });
Vehicle.belongsTo(User, { foreignKey: 'clientId', as: 'owner' });

Vehicle.hasMany(Challan, { foreignKey: 'vehicleId', as: 'challans' });
Challan.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

Vehicle.hasOne(RtoDetail, { foreignKey: 'vehicleId', as: 'rtoDetail' });
RtoDetail.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

User.hasMany(UserActivity, { foreignKey: 'userId', as: 'activities' });
UserActivity.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(AuthOtp, { foreignKey: 'userId', as: 'authOtps' });
AuthOtp.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Vehicle.hasMany(SpeedViolation, { foreignKey: 'vehicleId', as: 'speedViolations' });
SpeedViolation.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

User.hasMany(SpeedViolation, { foreignKey: 'acknowledgedBy', as: 'acknowledgedViolations' });
SpeedViolation.belongsTo(User, { foreignKey: 'acknowledgedBy', as: 'acknowledger' });

Vehicle.hasMany(Trip, { foreignKey: 'vehicleId', as: 'trips' });
Trip.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

Vehicle.hasMany(Stop, { foreignKey: 'vehicleId', as: 'stops' });
Stop.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

module.exports = {
  UserSettings,
  sequelize,
  User,
  UserMeta,
  Vehicle,
  Challan,
  RtoDetail,
  UserActivity,
  AuthOtp,
  SpeedViolation,
  Trip,
  Stop,
};
