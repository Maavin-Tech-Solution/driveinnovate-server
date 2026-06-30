require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host:'165.99.213.247', port:Number(process.env.DB_PORT), user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_NAME, connectTimeout:15000 });
  const q = async (label, sql) => { const [[r]] = await c.query(sql); console.log(label, JSON.stringify(r)); };
  await q('total', 'SELECT COUNT(*) c FROM vehicle_engine_sessions');
  await q('end<start', 'SELECT COUNT(*) c FROM vehicle_engine_sessions WHERE end_time IS NOT NULL AND end_time < start_time');
  await q('completed_dur0', "SELECT COUNT(*) c FROM vehicle_engine_sessions WHERE status='completed' AND (duration_seconds IS NULL OR duration_seconds<=0)");
  await q('stuck_active>1d', "SELECT COUNT(*) c FROM vehicle_engine_sessions WHERE status='active' AND start_time < (NOW() - INTERVAL 1 DAY)");
  await q('recoverable (dur0 but driving+idle>0)', "SELECT COUNT(*) c FROM vehicle_engine_sessions WHERE status='completed' AND (duration_seconds IS NULL OR duration_seconds<=0) AND (COALESCE(driving_seconds,0)+COALESCE(idle_seconds,0))>0");
  await c.end();
})().catch(e => { console.error('ERR', e.code||'', e.message); process.exit(1); });
