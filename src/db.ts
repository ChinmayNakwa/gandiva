import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });

export const db = new Database(process.env.DB_PATH || "data/gandiva.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('data','inference','scraping')),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  price TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT 'gandiva',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  run_id TEXT,
  buyer TEXT NOT NULL,
  seller TEXT NOT NULL,
  service_id TEXT,
  service_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  listed TEXT NOT NULL,
  asked TEXT,
  paid TEXT NOT NULL DEFAULT '0',
  tx_hash TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  auth_from TEXT,
  auth_nonce TEXT,
  valid_before INTEGER,
  signed_at INTEGER
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  seller TEXT NOT NULL,
  payer TEXT,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nonces (
  key TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  task TEXT NOT NULL,
  budget TEXT NOT NULL,
  result TEXT
);
`);

// Migrate databases created before the "unconfirmed" status: drop the old status CHECK and add the authorisation columns.
const ledgerSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger'").get() as { sql: string }).sql;
if (/CHECK\s*\(status IN/i.test(ledgerSql)) {
  db.exec(`
    BEGIN;
    ALTER TABLE ledger RENAME TO ledger_old;
    CREATE TABLE ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, run_id TEXT, buyer TEXT NOT NULL, seller TEXT NOT NULL,
      service_id TEXT, service_name TEXT NOT NULL, endpoint TEXT NOT NULL, listed TEXT NOT NULL, asked TEXT,
      paid TEXT NOT NULL DEFAULT '0', tx_hash TEXT, status TEXT NOT NULL, reason TEXT, latency_ms INTEGER NOT NULL DEFAULT 0,
      auth_from TEXT, auth_nonce TEXT, valid_before INTEGER, signed_at INTEGER
    );
    INSERT INTO ledger (id,ts,run_id,buyer,seller,service_id,service_name,endpoint,listed,asked,paid,tx_hash,status,reason,latency_ms)
      SELECT id,ts,run_id,buyer,seller,service_id,service_name,endpoint,listed,asked,paid,tx_hash,status,reason,latency_ms FROM ledger_old;
    DROP TABLE ledger_old;
    COMMIT;
  `);
}
