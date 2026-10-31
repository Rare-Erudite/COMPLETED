import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  max: 1,
  ssl: { rejectUnauthorized: false }
});

try {
  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'rare_schema_migrations',
        'rare_persistent_documents',
        'rare_checkpoint_files',
        'rare_users',
        'rare_sessions',
        'rare_oauth_identities',
        'rare_developer_credentials',
        'rare_developer_grants',
        'rare_user_state',
        'projects',
        'project_tasks',
        'agent_events',
        'artifacts'
      )
    ORDER BY table_name
  `);
  console.log(result.rows.map(row => row.table_name).join('\n'));
  console.log(`\nTotal found: ${result.rowCount}`);
} catch (error) {
  console.error('Verification failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
