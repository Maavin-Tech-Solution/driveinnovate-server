const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VehicleGroupMember = sequelize.define(
  'VehicleGroupMember',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'vehicle_group_members',
    underscored: true,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['group_id', 'vehicle_id'] },
    ],
  }
);

module.exports = VehicleGroupMember;
