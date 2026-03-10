const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserMeta = sequelize.define(
  'UserMeta',
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
    companyName: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    zip: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    businessCategory: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    gtin: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    tableName: 'di_user_meta',
    underscored: true,
    timestamps: false,
  }
);

module.exports = UserMeta;
