const { Client } = require('pg');
require('dotenv').config({ path: '../web-app/.env.local' });

// We need the postgres connection string, but we only have supabase URL.
// Supabase connection string is postgresql://postgres.xxxx:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
