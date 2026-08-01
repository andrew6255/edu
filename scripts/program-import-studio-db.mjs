import fs from 'node:fs/promises';
import path from 'node:path';
import pg from '../lib/db/node_modules/pg/lib/index.js';

const envPath = path.resolve('.env.local');
const envText = await fs.readFile(envPath, 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured in .env.local');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const command = process.argv[2] ?? 'status';
  if (command === 'status') {
    const result = await client.query(`select current_database() as database, current_user as role,
      to_regclass('public.public_programs')::text as public_programs,
      to_regclass('public.draft_programs')::text as draft_programs,
      to_regclass('public.program_versions')::text as program_versions,
      to_regclass('public.program_organizer_decisions')::text as organizer_decisions,
      to_regprocedure('public.save_program_draft_revision(text,jsonb,integer,jsonb)')::text as save_rpc,
      to_regprocedure('public.publish_program_draft_revision(text,integer)')::text as publish_rpc,
      to_regprocedure('public.rollback_program_version_to_draft(text,integer)')::text as rollback_rpc,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='draft_programs' and column_name='revision') as draft_revision_column`);
    console.log(JSON.stringify(result.rows[0], null, 2));
  } else if (command === 'apply') {
    const migrationPath = path.resolve('program_import_studio_migration.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
      console.log('Question Import Studio migration applied successfully.');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } else {
    throw new Error(`Unknown command: ${command}. Use status or apply.`);
  }
} finally {
  await client.end();
}
