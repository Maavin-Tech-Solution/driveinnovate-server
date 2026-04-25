const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * User-defined alert rules.
 * When the alert engine detects the condition is met, a Notification is created and email is sent.
 */
const Alert = sequelize.define('Alert', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  clientId: { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },

  name: { type: DataTypes.STRING(150), allowNull: false },
  description: { type: DataTypes.STRING(300), allowNull: true },

  /**
   * SPEED_EXCEEDED  — vehicle speed > threshold (km/h)
   * NOT_MOVING      — vehicle speed = 0 for >= threshold minutes
   * IDLE_ENGINE     — engine ON + speed = 0 for >= threshold minutes
   * FUEL_THEFT      — fuel drops by >= threshold litres within windowMinutes
   */
  type: {
    type: DataTypes.ENUM('SPEED_EXCEEDED', 'NOT_MOVING', 'IDLE_ENGINE', 'FUEL_THEFT'),
    allowNull: false,
  },

  /**
   * ALL     — applies to every vehicle of the client
   * GROUP   — applies to all vehicles in groupId
   * VEHICLE — applies to a single vehicleId
   */
  scope: {
    type: DataTypes.ENUM('ALL', 'GROUP', 'VEHICLE'),
    allowNull: false,
    defaultValue: 'ALL',
  },

  vehicleId: { type: DataTypes.INTEGER, allowNull: true, field: 'vehicle_id' },
  groupId:   { type: DataTypes.INTEGER, allowNull: true, field: 'group_id' },

  /** km/h for SPEED_EXCEEDED; minutes for NOT_MOVING / IDLE_ENGINE; litres for FUEL_THEFT */
  threshold: { type: DataTypes.DECIMAL(8, 2), allowNull: false },

  /**
   * FUEL_THEFT only: the window (minutes) in which the drop must occur.
   * e.g. threshold=10, windowMinutes=5 → fire if 10 L dropped within 5 min.
   */
  windowMinutes: { type: DataTypes.INTEGER, allowNull: true, field: 'window_minutes' },

  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_active' },

  /** Minimum gap (minutes) between consecutive triggers to avoid notification spam */
  cooldownMinutes: { type: DataTypes.INTEGER, defaultValue: 30, field: 'cooldown_minutes' },

  /** Timestamp of the last time this alert fired */
  lastTriggeredAt: { type: DataTypes.DATE, allowNull: true, field: 'last_triggered_at' },

  /** Extra comma-separated emails to notify (on top of ALERT_STAKEHOLDER_EMAILS env var) */
  notifyEmails: { type: DataTypes.TEXT, allowNull: true, field: 'notify_emails' },
}, {
  tableName: 'alerts',
  timestamps: true,
  underscored: true,
});

module.exports = Alert;
