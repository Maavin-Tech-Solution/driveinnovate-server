require('dotenv').config();
const mysql = require('mysql2/promise');

// Status-aware corruption — mirrors report.service._isCorruptTrip. Protects
// legitimately-running (in_progress, duration 0) trips.
const CORRUPT = `(
  end_time < start_time
  OR (status = 'completed' AND duration <= 0)
  OR distance < 0
  OR max_speed > 300
  OR (status = 'completed' AND duration > 0 AND distance * 3600.0 / duration > 250)
)`;

(async () => {
  const conn = await mysql.createConnection({
    host: '165.99.213.247', port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectTimeout: 20000,
  });

  const [[{ c }]] = await conn.query(`SELECT COUNT(*) c FROM trips WHERE ${CORRUPT}`);
  console.log(`Corrupt to purge: ${c}`);

  const BATCH = 20000;
  let deleted = 0, round = 0;
  const t0 = Date.now();
  while (true) {
    const [res] = await conn.query(`DELETE FROM trips WHERE ${CORRUPT} LIMIT ${BATCH}`);
    deleted += res.affectedRows;
    round++;
    if (round % 10 === 0 || res.affectedRows < BATCH) {
      console.log(`  deleted ${deleted} / ${c}  (round ${round}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    if (res.affectedRows < BATCH) break;
    await new Promise(r => setTimeout(r, 150)); // ease DB load between batches
  }

  const [[{ rem }]]   = await conn.query(`SELECT COUNT(*) rem FROM trips WHERE ${CORRUPT}`);
  const [[{ total }]] = await conn.query('SELECT COUNT(*) total FROM trips');
  console.log(`DONE. Deleted ${deleted}. Corrupt remaining: ${rem}. Total trips now: ${total}`);
  await conn.end();
})().catch(e => { console.error('ERR', e.code || '', e.message); process.exit(1); });
