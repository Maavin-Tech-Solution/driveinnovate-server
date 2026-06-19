const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Join: which member logins belong to a team. user_id references a di_user row
// with kind='member' whose parent_id is the team owner.
const TeamMember = sequelize.define(
  'TeamMember',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    teamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'team_members',
    underscored: true,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['team_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

module.exports = TeamMember;
