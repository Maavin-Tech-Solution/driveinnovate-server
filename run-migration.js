require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    console.log('📊 Connected to database:', process.env.DB_NAME);
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '004_create_user_settings_table.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('🚀 Running migration: 004_create_user_settings_table.sql');
    
    // Execute the SQL
    await connection.query(sqlContent);
    
    console.log('✅ Migration completed successfully!');
    console.log('📋 user_settings table created with default values for existing users');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration()
  .then(() => {
    console.log('\n✨ All done! You can now restart your server.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
