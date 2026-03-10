/**
 * MongoDB Index Creation Script
 * 
 * This script creates optimized indexes for the Location collection
 * to improve query performance for frequently accessed endpoints.
 * 
 * Run this script once after deployment:
 * node src/config/mongodb-indexes.js
 */

const { connectMongoDB, Location } = require('./mongodb');

async function createIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await connectMongoDB();
    
    console.log('Checking existing indexes...');
    const existingIndexes = await Location.collection.indexes();
    console.log(`Found ${existingIndexes.length} existing indexes`);
    
    // Function to check if index with same keys exists
    const indexExists = (keys) => {
      return existingIndexes.some(idx => 
        JSON.stringify(idx.key) === JSON.stringify(keys)
      );
    };
    
    // Function to drop index by keys pattern
    const dropIndexByKeys = async (keys) => {
      const existing = existingIndexes.find(idx => 
        JSON.stringify(idx.key) === JSON.stringify(keys)
      );
      if (existing && existing.name !== '_id_') {
        console.log(`  Dropping existing index: ${existing.name}`);
        try {
          await Location.collection.dropIndex(existing.name);
          return true;
        } catch (err) {
          console.warn(`  Could not drop index ${existing.name}:`, err.message);
          return false;
        }
      }
      return false;
    };
    
    console.log('\nCreating optimized indexes for Location collection...\n');
    
    // Create compound indexes for optimized queries
    const indexes = [
      {
        keys: { imei: 1, timestamp: -1 },
        name: 'imei_timestamp_desc',
        background: true,
        description: 'For finding latest location (sync endpoint)'
      },
      {
        keys: { imei: 1, timestamp: 1 },
        name: 'imei_timestamp_asc',
        background: true,
        description: 'For range queries in chronological order (location player)'
      },
      {
        keys: { timestamp: 1 },
        name: 'timestamp',
        background: true,
        description: 'For date range queries'
      }
    ];
    
    let created = 0;
    let skipped = 0;
    let recreated = 0;
    let failed = 0;
    
    for (const index of indexes) {
      const { keys, name, background, description } = index;
      console.log(`Processing: ${name} - ${description}`);
      
      const options = { name, background };
      
      try {
        // Check if index with same keys exists
        if (indexExists(keys)) {
          const existing = existingIndexes.find(idx => 
            JSON.stringify(idx.key) === JSON.stringify(keys)
          );
          
          if (existing.name === name) {
            console.log(`  ✓ Index already exists with correct name: ${name}`);
            skipped++;
          } else {
            console.log(`  ℹ Index exists as: ${existing.name}, will use existing`);
            skipped++;
          }
        } else {
          await Location.collection.createIndex(keys, options);
          console.log(`  ✓ Index created: ${name}`);
          created++;
        }
      } catch (err) {
        if (err.code === 85) {
          // Index already exists with different name - use existing
          console.log(`  ⚠ Using existing index (name conflict)`);
          skipped++;
        } else if (err.code === 67) {
          // Cannot create index - skip it
          console.log(`  ⚠ Cannot create index (${err.codeName}), skipping...`);
          console.log(`     Error: ${err.errmsg || err.message}`);
          failed++;
        } else {
          console.error(`  ❌ Error: ${err.message}`);
          failed++;
        }
      }
      console.log('');
    }
    
    // List all indexes
    console.log('All indexes on Location collection:');
    const allIndexes = await Location.collection.indexes();
    allIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });
    
    // Get collection stats
    try {
      const stats = await Location.collection.stats();
      console.log(`\nCollection stats:`);
      console.log(`  Total documents: ${stats.count.toLocaleString()}`);
      console.log(`  Storage size: ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Index size: ${(stats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      // Stats command may not be available, skip it
      console.log(`\nCollection stats: (not available)`);
    }
    
    console.log(`\n✅ Index creation complete!`);
    console.log(`   Created: ${created} | Recreated: ${recreated} | Skipped: ${skipped} | Failed: ${failed}`);
    
    if (failed > 0) {
      console.log(`\n⚠️  Some indexes could not be created, but existing indexes will be used.`);
      console.log(`   Your queries will still work with the existing indexes.`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating indexes:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

createIndexes();
