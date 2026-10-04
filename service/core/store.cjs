const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { DEFAULTS, settings, now, id } = require('./contracts.cjs');

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${id()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
class Store {
  static async open(root) {
    fs.mkdirSync(root, { recursive: true });
    const SQL = await initSqlJs({
      wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')),
    });
    const file = path.join(root, 'deepwork.sqlite');
    // Fail on a corrupt database rather than silently starting an empty workspace.
    const db = new SQL.Database(fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    return new Store(root, db, SQL);
  }
  constructor(root, db, SQL) {
    this.root = root;
    this.db = db;
    this.SQL = SQL;
    db.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
      INSERT OR IGNORE INTO metadata VALUES ('schemaVersion','1');`);
    if (this.meta('schemaVersion') !== '1')
      throw new Error('Unsupported database schema; update DeepWork before opening this workspace');
    if (!this.get('settings', 'preferences'))
      this.put('settings', { ...DEFAULTS, id: 'preferences' });
    this.persist();
  }
  meta(key) {
    const s = this.db.prepare('SELECT value FROM metadata WHERE key=?');
    try {
      s.bind([key]);
      return s.step() ? s.getAsObject().value : null;
    } finally {
      s.free();
    }
  }
  all(kind) {
    const stmt = this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid');
    try {
      stmt.bind([kind]);
      const rows = [];
      while (stmt.step()) rows.push(JSON.parse(stmt.getAsObject().data));
      return rows;
    } finally {
      stmt.free();
    }
  }
  get(kind, recordId) {
    const stmt = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?');
    try {
      stmt.bind([kind, recordId]);
      return stmt.step() ? JSON.parse(stmt.getAsObject().data) : null;
    } finally {
      stmt.free();
    }
  }
  put(kind, record) {
    this.db.run('INSERT OR REPLACE INTO records(kind,id,data) VALUES(?,?,?)', [
      kind,
      record.id,
      JSON.stringify(record),
    ]);
    return record;
  }
  remove(kind, recordId) {
    this.db.run('DELETE FROM records WHERE kind=? AND id=?', [kind, recordId]);
  }
  preferences() {
    const { id: _, ...p } = this.get('settings', 'preferences');
    return settings(p);
  }
  event(action, recordId, details = {}) {
    this.put('event', { id: id(), at: now(), action, recordId, ...details });
  }
  transaction(fn) {
    const before = this.db.export();
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.persist();
      return result;
    } catch (error) {
      // Also restore memory if the COMMIT succeeded but the atomic disk save failed.
      try {
        this.db.run('ROLLBACK');
      } catch {}
      this.db.close();
      this.db = new this.SQL.Database(before);
      throw error;
    }
  }
  persist() {
    atomicWrite(path.join(this.root, 'deepwork.sqlite'), Buffer.from(this.db.export()));
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store, atomicWrite };
