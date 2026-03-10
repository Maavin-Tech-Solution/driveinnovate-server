require('dotenv').config();
const mysql = require('mysql2/promise');

async function verifyTable() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    // Check if table exists
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'user_settings'"
    );
    
    if (tables.length > 0) {
      console.log('✅ user_settings table exists');
      
      // Get table structure
      const [columns] = await connection.query('DESCRIBE user_settings');
      console.log('\n📋 Table Structure:');
      columns.forEach(col => {
        console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
      
      // Count records
      const [count] = await connection.query('SELECT COUNT(*) as count FROM user_settings');
      console.log(`\n📊 Total settings records: ${count[0].count}`);
      
      // Show sample data
      const [rows] = await connection.query('SELECT id, user_id, speed_threshold FROM user_settings LIMIT 3');
      if (rows.length > 0) {
        console.log('\n🔍 Sample Records:');
        rows.forEach(row => {
          console.log(`  User ID ${row.user_id}: Speed Threshold = ${row.speed_threshold} km/h`);
        });
      }
    } else {
      console.log('❌ user_settings table not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
  }
}

verifyTable().then(() => process.exit(0));
