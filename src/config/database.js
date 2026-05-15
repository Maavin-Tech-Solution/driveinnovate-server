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
      max: 40,       // total pool — API routes + packet processor share this
      min: 5,        // keep connections warm so bursts don't pay connect latency
      acquire: 10000, // fail fast (10 s) — API routes must never hang for 30 s
      idle: 60000,
    },
  }
);

module.exports = sequelize;
