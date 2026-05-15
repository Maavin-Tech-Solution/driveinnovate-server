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
      max: 20,       // conservative — well within MySQL default max_connections (151)
      min: 0,        // don't pre-open connections on startup
      acquire: 15000,
      idle: 30000,
    },
  }
);

module.exports = sequelize;
