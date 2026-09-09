/**
 * Migration: Create speedtest tables and register the admin panel tab
 * Run with: node migrations/create_speedtest_tables.js
 *
 * The tables are also created automatically on first use by speedtestRoutes.js;
 * this script exists so the schema can be applied explicitly and the tab
 * registered in dashboard_tabs.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { SCHEMA } = require('../speedtestRoutes');

async function runMigration() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'skynet',
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    console.log('🚀 Starting speedtest migration...\n');

    console.log('📦 Creating speedtest_agents / speedtest_results tables...');
    for (const sql of SCHEMA) await pool.query(sql);
    console.log('✅ tables created\n');

    console.log('🗂️ Adding speedtest tab to admin panel...');
    await pool.query(`
      INSERT INTO dashboard_tabs (tab_key, tab_name, enabled, maintenance_mode, order_index)
      VALUES ('speedtest', 'Speedtest', TRUE, FALSE, 55)
      ON DUPLICATE KEY UPDATE
        tab_name = VALUES(tab_name),
        order_index = VALUES(order_index)
    `);
    console.log('✅ speedtest tab added\n');

    console.log('═══════════════════════════════════════');
    console.log('✅ Migration completed successfully!');
    console.log('   Next: open Admin Panel → Speedtest → Agents → Add agent to get a token.');
    console.log('═══════════════════════════════════════');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
