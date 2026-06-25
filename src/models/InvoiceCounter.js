const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Per-year monotonic counter for invoice numbers. One row per (scope, year).
 *
 * `scope` lets each issuer have an independent sequence if desired; we use the
 * issuer's user id as the scope so two dealers never collide and each gets a
 * clean 1..N run per year. The next number is allocated with SELECT ... FOR
 * UPDATE inside the same transaction as the invoice insert, so numbers are
 * gap-free and never duplicated under concurrency.
 */
const InvoiceCounter = sequelize.define(
  'InvoiceCounter',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    scope: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: 'Sequence partition — the issuer user id (as string)',
    },

    year: { type: DataTypes.INTEGER, allowNull: false },

    seq: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Last allocated number for this scope+year',
    },
  },
  {
    tableName: 'di_invoice_counter',
    underscored: true,
    timestamps: true,
    indexes: [{ unique: true, fields: ['scope', 'year'] }],
  }
);

module.exports = InvoiceCounter;
