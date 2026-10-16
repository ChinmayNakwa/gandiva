import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "gandiva-mig-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("db migration from the pre-'unconfirmed' ledger schema", () => {
  it("keeps every existing row, drops the status CHECK, and adds the authorisation columns", async () => {
    const path = join(dir, "old.db");
    const old = new Database(path);
    old.exec(`
      CREATE TABLE ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, run_id TEXT, buyer TEXT NOT NULL, seller TEXT NOT NULL, service_id TEXT,
        service_name TEXT NOT NULL, endpoint TEXT NOT NULL, listed TEXT NOT NULL, asked TEXT, paid TEXT NOT NULL DEFAULT '0', tx_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('paid','paid_output_rejected','refused','failed_not_charged')), reason TEXT, latency_ms INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO ledger (ts,buyer,seller,service_name,endpoint,listed,asked,paid,tx_hash,status,latency_ms) VALUES ('2026-10-16T00:00:00Z','0xb','0xs','svc','http://x','1000','1000','1000','0xabc','paid',42);
      INSERT INTO ledger (ts,buyer,seller,service_name,endpoint,listed,status,latency_ms) VALUES ('2026-10-16T00:01:00Z','0xb','0xs','svc','http://x','1000','refused',7);
    `);
    old.close();

    vi.resetModules();
    process.env.DB_PATH = path;
    const { db } = await import("../src/db.js");
    try {
      const rows = db.prepare("SELECT id, status, paid, tx_hash, latency_ms, auth_nonce FROM ledger ORDER BY id").all();
      expect(rows).toEqual([
        { id: 1, status: "paid", paid: "1000", tx_hash: "0xabc", latency_ms: 42, auth_nonce: null },
        { id: 2, status: "refused", paid: "0", tx_hash: null, latency_ms: 7, auth_nonce: null },
      ]);
      // the new status is now accepted, and the old table is gone
      db.prepare("INSERT INTO ledger (ts,buyer,seller,service_name,endpoint,listed,status) VALUES ('t','b','s','n','e','1','unconfirmed')").run();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ledger_old'").all()).toHaveLength(0);
      // AUTOINCREMENT continues after the migrated ids
      expect((db.prepare("SELECT MAX(id) AS m FROM ledger").get() as any).m).toBe(3);
    } finally {
      db.close();
      process.env.DB_PATH = ":memory:";
    }
  });
});
