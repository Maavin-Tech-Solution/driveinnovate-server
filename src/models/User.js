const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    parentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      defaultValue: 'active',
    },
    accountType: {
      type: DataTypes.ENUM('trial', 'billable', 'demo', 'master'),
      defaultValue: 'trial',
      allowNull: false,
    },
    trialExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When null on a trial account, no expiry is enforced',
    },
    // account = papa/dealer/client hierarchy user (owns vehicles, derives role
    // from the parentId tree). member = a restricted team-member login that owns
    // no vehicles and is scoped to its teams' assigned vehicles. Members are
    // EXCLUDED from role/descendant derivation so adding members never promotes
    // a client to "dealer".
    kind: {
      type: DataTypes.ENUM('account', 'member'),
      allowNull: false,
      defaultValue: 'account',
    },
    // prepaid = vehicles are paid for with wallet tokens (the billing module).
    // postpaid = billed outside the token system. Existing accounts default to
    // postpaid so enabling the module doesn't retroactively gate anyone.
    billingType: {
      type: DataTypes.ENUM('prepaid', 'postpaid'),
      allowNull: false,
      defaultValue: 'postpaid',
      field: 'billing_type',
    },
    // Client opt-in: when ON and the wallet has tokens, the nightly job renews
    // vehicles as they reach expiry instead of letting them lapse.
    autoRenew: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'auto_renew',
    },
    // Extra days added beyond the 1-year token term for this client's vehicles.
    // Set at account creation (grace period).
    graceDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'grace_days',
    },
    // Optional per-account brand logo (URL). When set, it replaces the default
    // DriveInnovate mark in the sidebar for this account after login.
    logoUrl: { type: DataTypes.STRING(500), allowNull: true, field: 'logo_url' },
    // Optional background color behind that logo in the sidebar (hex). null =
    // transparent (blends with the dark sidebar).
    logoBgColor: { type: DataTypes.STRING(20), allowNull: true, field: 'logo_bg_color' },
    // Optional sidebar brand text lines, each a raw HTML snippet the user pastes
    // (parsed/rendered as-is). Shown ONLY when a line is set — no default
    // "DriveInnovate" / "Fleet Management" fallback (blank when unset).
    //   { title: '<span style="…">…</span>', subtitle: '…' }
    brandText: { type: DataTypes.JSON, allowNull: true, field: 'brand_text' },
    // SmartChallan integration
    scEnabled:        { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_enabled' },
    scUsername:       { type: DataTypes.STRING(255), allowNull: true, field: 'sc_username' },
    scPassword:       { type: DataTypes.STRING(255), allowNull: true, field: 'sc_password' },
    scRtoEnabled:     { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_rto_enabled' },
    scChallanEnabled: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_challan_enabled' },
    scDlEnabled:      { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_dl_enabled' },
  },
  {
    tableName: 'di_user',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = User;
