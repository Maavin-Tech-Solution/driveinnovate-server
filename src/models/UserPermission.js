const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserPermission = sequelize.define(
  'UserPermission',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    canAddVehicle: { type: DataTypes.BOOLEAN, defaultValue: false },
    canTrackVehicle: { type: DataTypes.BOOLEAN, defaultValue: false },
    canViewFleet: { type: DataTypes.BOOLEAN, defaultValue: false },
    canAddClient: { type: DataTypes.BOOLEAN, defaultValue: false },
    canManageGroups: { type: DataTypes.BOOLEAN, defaultValue: false },
    canManageGeofences: { type: DataTypes.BOOLEAN, defaultValue: false },
    canViewTrips: { type: DataTypes.BOOLEAN, defaultValue: false },
    canShareTrip: { type: DataTypes.BOOLEAN, defaultValue: false },
    canShareLiveLocation: { type: DataTypes.BOOLEAN, defaultValue: false },
    canViewReports: { type: DataTypes.BOOLEAN, defaultValue: false },
    canDownloadReports: { type: DataTypes.BOOLEAN, defaultValue: false },
    canSetAlerts: { type: DataTypes.BOOLEAN, defaultValue: false },
    canViewRTO: { type: DataTypes.BOOLEAN, defaultValue: false },
    canViewChallans: { type: DataTypes.BOOLEAN, defaultValue: false },
    canViewNotifications: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    tableName: 'di_user_permissions',
    underscored: true,
    timestamps: true,
  }
);

module.exports = UserPermission;
