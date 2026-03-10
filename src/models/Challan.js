const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Challan = sequelize.define(
  'Challan',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    vehicleNumber: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    challanNumber: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    challanType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    offense: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    challanDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'paid', 'disputed', 'waived'),
      defaultValue: 'pending',
    },
    location: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    paymentDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    transactionId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    tableName: 'challans',
    timestamps: true,
  }
);

module.exports = Challan;
