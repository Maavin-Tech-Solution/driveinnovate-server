const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Join: which vehicles are assigned to a team. The assigned vehicles must always
// belong to the team's owner (enforced in the service layer).
const TeamVehicle = sequelize.define(
  'TeamVehicle',
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
    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'team_vehicles',
    underscored: true,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['team_id', 'vehicle_id'] },
      { fields: ['vehicle_id'] },
    ],
  }
);

module.exports = TeamVehicle;
