const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A vehicle state definition (Running, Idle, Stopped, etc.) scoped to one DeviceConfig.
 *
 * conditions JSON schema:
 *   Array of { field, operator, value }
 *   field:    "ignition" | "movement" | "speed" | "battery" | "gsmSignal" |
 *             "satellites" | "hasLocation" | "lastSeenSeconds"
 *   operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "exists" | "notexists"
 *   value:    boolean | number (ignored for exists/notexists)
 *
 * conditionLogic: "AND" (all must match) | "OR" (at least one must match)
 *
 * States are evaluated in ascending priority order; first match wins.
 * If isDefault=true the state acts as the fallback when no other state matches.
 */
const StateDefinition = sequelize.define(
  'StateDefinition',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    deviceConfigId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'di_device_config', key: 'id' },
    },
    stateName: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'e.g. "Running", "Idle", "Stopped", "No GPS"',
    },
    stateColor: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: '#94A3B8',
      comment: 'Hex color displayed in the UI',
    },
    stateIcon: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Emoji / short icon string',
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 99,
      comment: 'Lower number = evaluated first',
    },
    conditionLogic: {
      type: DataTypes.ENUM('AND', 'OR'),
      allowNull: false,
      defaultValue: 'AND',
    },
    conditions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: 'Array of { field, operator, value }',
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Fallback state when no conditions match',
    },
  },
  {
    tableName: 'di_state_definition',
    underscored: true,
    timestamps: true,
  }
);

module.exports = StateDefinition;
