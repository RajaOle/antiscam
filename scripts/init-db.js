/*
  Initializes MySQL: creates database, user, and tables from schema.sql.
  Requires admin credentials via env:
    MYSQL_ROOT_USER (default: root)
    MYSQL_ROOT_PASSWORD (no default)
    MYSQL_HOST (default: 127.0.0.1)
    MYSQL_PORT (default: 3306)

  Usage:
    MYSQL_ROOT_USER=root MYSQL_ROOT_PASSWORD=yourpass node scripts/init-db.js
*/
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306;
  const user = process.env.MYSQL_ROOT_USER || 'root';
  const password = process.env.MYSQL_ROOT_PASSWORD || '';

  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('schema.sql not found at', schemaPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const conn = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  try {
    await conn.query(sql);
    console.log('Schema applied successfully.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Failed to apply schema:', err.message);
  process.exit(1);
});


