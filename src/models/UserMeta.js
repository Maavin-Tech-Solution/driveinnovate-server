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

    // ── Billing / tax-invoice identity (used on printed invoices) ──────────
    gstin: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'GST registration number shown on tax invoices',
    },
    invoiceTaxPercent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      field: 'invoice_tax_percent',
      comment: 'Default GST % this user applies when issuing invoices (null = use system default)',
    },
    invoicePrefix: {
      type: DataTypes.STRING(12),
      allowNull: true,
      field: 'invoice_prefix',
      comment: 'Prefix for invoice numbers e.g. "INV" → INV-2026-000123',
    },
    logoUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'logo_url',
      comment: 'Company logo URL for invoice letterhead',
    },
  },
  {
    tableName: 'di_user_meta',
    underscored: true,
    timestamps: false,
  }
);

module.exports = UserMeta;
