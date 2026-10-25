require('dotenv').config();
const db = require('./database');
const { syncSeedDataFile } = require('./sync-seed');

console.log('✓ Database verified and ready.');
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
console.log(`Current stats: ${productCount} products, ${userCount} users.`);

if (process.argv.includes('--sync') || process.argv.includes('--sync-seed')) {
  const result = syncSeedDataFile();
  console.log(`✓ Synchronized seed-data.js with ${result.count} products from database.`);
}

