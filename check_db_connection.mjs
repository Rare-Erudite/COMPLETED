import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  max: 1,
  ssl: { rejectUnauthorized: false }
});

try {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_schema() AS schema_name,
      current_user AS database_user,
      to_regclass('public.rare_users')::text AS rare_users_table,
      to_regclass('public.rare_schema_migrations')::text AS migrations_table
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
} catch (error) {
  console.error('Connection/query failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
