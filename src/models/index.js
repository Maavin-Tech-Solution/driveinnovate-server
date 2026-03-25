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
const VehicleSensor = require('./VehicleSensor');
const VehicleEngineSession = require('./VehicleEngineSession');
const VehicleFuelEvent = require('./VehicleFuelEvent');
const VehicleDeviceState = require('./VehicleDeviceState');
const VehicleGroup = require('./VehicleGroup');
const VehicleGroupMember = require('./VehicleGroupMember');
const TripShare = require('./TripShare');
const Alert = require('./Alert');
const Notification = require('./Notification');
const SupportTicket = require('./SupportTicket');

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

Vehicle.hasMany(VehicleSensor, { foreignKey: 'vehicleId', as: 'sensors' });
VehicleSensor.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

Vehicle.hasMany(VehicleEngineSession, { foreignKey: 'vehicleId', as: 'engineSessions' });
VehicleEngineSession.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

Vehicle.hasMany(VehicleFuelEvent, { foreignKey: 'vehicleId', as: 'fuelEvents' });
VehicleFuelEvent.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

Vehicle.hasOne(VehicleDeviceState, { foreignKey: 'vehicleId', as: 'deviceState' });
VehicleDeviceState.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

// Support Tickets
User.hasMany(SupportTicket, { foreignKey: 'clientId', as: 'supportTickets' });
SupportTicket.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

Vehicle.hasMany(SupportTicket, { foreignKey: 'vehicleId', as: 'supportTickets' });
SupportTicket.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

// Alerts & Notifications
User.hasMany(Alert, { foreignKey: 'clientId', as: 'alerts' });
Alert.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

Alert.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });
Vehicle.hasMany(Alert, { foreignKey: 'vehicleId', as: 'vehicleAlerts' });

Alert.hasMany(Notification, { foreignKey: 'alertId', as: 'notifications' });
Notification.belongsTo(Alert, { foreignKey: 'alertId', as: 'alert' });

User.hasMany(Notification, { foreignKey: 'clientId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

Vehicle.hasMany(Notification, { foreignKey: 'vehicleId', as: 'notifications' });
Notification.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

// Vehicle Groups
User.hasMany(VehicleGroup, { foreignKey: 'clientId', as: 'vehicleGroups' });
VehicleGroup.belongsTo(User, { foreignKey: 'clientId', as: 'owner' });

VehicleGroup.hasMany(VehicleGroupMember, { foreignKey: 'groupId', as: 'members' });
VehicleGroupMember.belongsTo(VehicleGroup, { foreignKey: 'groupId', as: 'group' });

Vehicle.hasMany(VehicleGroupMember, { foreignKey: 'vehicleId', as: 'groupMemberships' });
VehicleGroupMember.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

VehicleGroup.belongsToMany(Vehicle, { through: VehicleGroupMember, foreignKey: 'groupId', otherKey: 'vehicleId', as: 'vehicles' });
Vehicle.belongsToMany(VehicleGroup, { through: VehicleGroupMember, foreignKey: 'vehicleId', otherKey: 'groupId', as: 'groups' });

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
  VehicleSensor,
  VehicleEngineSession,
  VehicleFuelEvent,
  VehicleDeviceState,
  VehicleGroup,
  VehicleGroupMember,
  TripShare,
  Alert,
  Notification,
  SupportTicket,
};
