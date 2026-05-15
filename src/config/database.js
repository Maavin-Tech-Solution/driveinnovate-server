const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    // Force UTC so DATETIME comparisons are always timezone-consistent
    // regardless of the OS or MySQL server's local timezone setting.
    timezone: '+00:00',
    dialectOptions: {
      timezone: '+00:00',
    },
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 30,       // was 10 — allow more concurrent operations across vehicles
      min: 2,        // keep a few connections warm
      acquire: 20000, // fail faster (was 30s) so errors surface quickly
      idle: 30000,   // keep connections alive longer between packets
    },
  }
);

module.exports = sequelize;
