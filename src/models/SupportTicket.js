const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SupportTicket = sequelize.define('SupportTicket', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  /** Auto-generated: TKT-YYYYMM-NNNN */
  ticketNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: 'ticket_number' },

  clientId: { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },

  // Contact info supplied in the form (may differ from account profile)
  email:          { type: DataTypes.STRING(200), allowNull: false },
  phone:          { type: DataTypes.STRING(20),  allowNull: false },
  alternatePhone: { type: DataTypes.STRING(20),  allowNull: true, field: 'alternate_phone' },

  /**
   * VEHICLE_TRACKING  — GPS / live tracking problem
   * GPS_DEVICE        — Hardware / connectivity
   * ACCOUNT           — Login, password, profile
   * BILLING           — Subscription, payment
   * REPORTS           — Report data issues
   * TECHNICAL         — App/platform bugs
   * OTHER             — Everything else
   */
  issueType: {
    type: DataTypes.ENUM('VEHICLE_TRACKING','GPS_DEVICE','ACCOUNT','BILLING','REPORTS','TECHNICAL','OTHER'),
    allowNull: false,
    field: 'issue_type',
  },

  /** Only relevant when issueType = VEHICLE_TRACKING */
  vehicleScope: {
    type: DataTypes.ENUM('SINGLE','GROUP'),
    allowNull: true,
    field: 'vehicle_scope',
  },
  vehicleId: { type: DataTypes.INTEGER, allowNull: true, field: 'vehicle_id' },
  groupId:   { type: DataTypes.INTEGER, allowNull: true, field: 'group_id' },

  subject:     { type: DataTypes.STRING(300), allowNull: false },
  description: { type: DataTypes.TEXT,        allowNull: false },

  /**
   * JSON array: [{ filename, originalname, mimetype, size, path }]
   * `path` is relative to server root, e.g. "uploads/support/<filename>"
   */
  attachments: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },

  status: {
    type: DataTypes.ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED'),
    allowNull: false,
    defaultValue: 'OPEN',
  },
  priority: {
    type: DataTypes.ENUM('LOW','MEDIUM','HIGH','CRITICAL'),
    allowNull: false,
    defaultValue: 'MEDIUM',
  },

  /** Internal notes visible only to support staff */
  adminNotes: { type: DataTypes.TEXT, allowNull: true, field: 'admin_notes' },

  resolvedAt: { type: DataTypes.DATE, allowNull: true, field: 'resolved_at' },
  closedAt:   { type: DataTypes.DATE, allowNull: true, field: 'closed_at' },
}, {
  tableName: 'support_tickets',
  timestamps: true,
  underscored: true,
});

module.exports = SupportTicket;
