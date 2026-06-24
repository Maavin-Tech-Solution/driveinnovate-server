require('dotenv').config();
const mysql = require('mysql2/promise');

// Phase 1: clear garbage (mirrors report.service._isCorruptTrip).
const CORRUPT = `(
  end_time < start_time
  OR (status = 'completed' AND duration <= 0)
  OR distance < 0
  OR max_speed > 300
  OR (status = 'completed' AND duration > 0 AND distance * 3600.0 / duration > 250)
)`;
// Phase 2: orphaned trips opened but never progressed (end==start) and stale (>1h).
// A real active trip advances end_time as it drives, so this never hits a live trip.
const ORPHAN = `(status = 'in_progress' AND end_time = start_time AND start_time < (NOW() - INTERVAL 1 HOUR))`;

const cfg = {
  host: process.env.PURGE_DB_HOST || '165.99.213.247', port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectTimeout: 20000,
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function purge(label, WHERE) {
  let conn = await mysql.createConnection(cfg);
  let deleted = 0, round = 0, fails = 0;
  const t0 = Date.now();
  while (true) {
    try {
      const [res] = await conn.query(`DELETE FROM trips WHERE ${WHERE} LIMIT 20000`);
      deleted += res.affectedRows; round++; fails = 0;
      if (round % 25 === 0 || res.affectedRows < 20000) {
        console.log(`  [${label}] deleted ${deleted} (round ${round}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
      if (res.affectedRows < 20000) break;
      await sleep(120);
    } catch (e) {
      fails++;
      console.log(`  [${label}] error ${e.code || e.message} — reconnect #${fails}`);
      if (fails > 60) { console.log(`  [${label}] aborting after repeated failures`); break; }
      try { await conn.end(); } catch {}
      await sleep(Math.min(2000 * fails, 15000)); // back off, capped at 15s, ride out network blips
      try { conn = await mysql.createConnection(cfg); } catch (e2) { console.log('  reconnect failed:', e2.message); }
    }
  }
  console.log(`[${label}] DONE — deleted ${deleted}`);
  try { await conn.end(); } catch {}
  return deleted;
}

(async () => {
  await purge('corrupt', CORRUPT);
  await purge('orphan', ORPHAN);
  const conn = await mysql.createConnection(cfg);
  const [[{ total }]] = await conn.query('SELECT COUNT(*) total FROM trips');
  const [[{ c }]]     = await conn.query(`SELECT COUNT(*) c FROM trips WHERE ${CORRUPT}`);
  const [[{ o }]]     = await conn.query(`SELECT COUNT(*) o FROM trips WHERE ${ORPHAN}`);
  console.log(`FINAL: total=${total}, corrupt remaining=${c}, orphan remaining=${o}`);
  await conn.end();
})().catch(e => { console.error('FATAL', e.code || '', e.message); process.exit(1); });
