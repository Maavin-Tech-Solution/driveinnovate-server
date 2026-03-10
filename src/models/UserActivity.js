const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserActivity = sequelize.define(
  'UserActivity',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    userAgent: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    module: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('success', 'failure'),
      defaultValue: 'success',
    },
  },
  {
    tableName: 'user_activities',
    timestamps: true,
  }
);

module.exports = UserActivity;
