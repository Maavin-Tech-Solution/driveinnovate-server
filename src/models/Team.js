const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A Team is a named, access-control grouping owned by an account user (papa/
// dealer/client). It bundles a SUBSET of the owner's vehicles (via team_vehicles)
// and a set of restricted member logins (via team_members). A member sees only
// the union of vehicles across the teams they belong to.
const Team = sequelize.define(
  'Team',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    ownerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'di_user id of the account that owns this team',
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
    },
  },
  {
    tableName: 'teams',
    underscored: true,
    timestamps: true,
    indexes: [{ fields: ['owner_id'] }],
  }
);

module.exports = Team;
