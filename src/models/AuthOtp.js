const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuthOtp = sequelize.define(
  'AuthOtp',
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
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    purpose: {
      type: DataTypes.ENUM('LOGIN', 'FORGOT_PASSWORD'),
      allowNull: false,
    },
    otpHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    consumedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: 'auth_otps',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id', 'purpose', 'consumed_at'] },
      { fields: ['email', 'purpose', 'consumed_at'] },
      { fields: ['expires_at'] },
    ],
  }
);

module.exports = AuthOtp;