const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * One row per alert trigger event.
 * Created by the alert engine; read by the notification inbox.
 */
const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  clientId:  { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },
  alertId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'alert_id' },
  vehicleId: { type: DataTypes.INTEGER, allowNull: true,  field: 'vehicle_id' },

  title:   { type: DataTypes.STRING(250), allowNull: false },
  message: { type: DataTypes.TEXT,        allowNull: false },
  alertType: { type: DataTypes.STRING(50), allowNull: true, field: 'alert_type' },

  isRead:    { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_read' },
  emailSent: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'email_sent' },

  /** JSON payload: { speed, lat, lng, packetTime, vehicleNumber, vehicleName } */
  metadata: { type: DataTypes.JSON, allowNull: true },

  triggeredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'triggered_at' },
}, {
  tableName: 'notifications',
  timestamps: true,
  underscored: true,
});

module.exports = Notification;
