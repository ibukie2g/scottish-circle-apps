// GAS のサービスの最小限の偽物(テスト用)。src/*.js を vm で読み込んで、通しの流れを確かめる
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values[0].length !== this.nc) throw new Error('size mismatch');
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  clearContent() {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.set(this.row + r, this.col + c, '');
    return this;
  }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  set(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some(v => v !== '' && v !== null)) return r;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(row => { for (let c = row.length; c > m; c--) if (row[c - 1] !== '' && row[c - 1] !== null) { m = c; break; } });
    return m;
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return new FakeRange(this, 1, 2, 1, 1);
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {}
  getMaxRows() { return Math.max(1000, this.data.length); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => this.set(r, i + 1, v)); return this; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone() {}
}

function makeCache(clock) {
  const m = new Map();
  const expiry = new Map();
  return {
    store: m,
    get: k => (m.has(k) && expiry.get(k) > clock.now ? m.get(k) : null),
    put: (k, v, sec = 10) => { expiry.set(k, clock.now + sec * 1000); if (String(v).length > 100000) throw new Error('too big'); m.set(k, String(v)); },
    remove: k => m.delete(k),
    putAll(obj, sec = 10) { Object.keys(obj).forEach(k => this.put(k, obj[k], sec)); },
    removeAll: ks => ks.forEach(k => m.delete(k)),
    getAll: ks => { const o = {}; ks.forEach(k => { if (m.has(k) && expiry.get(k) > clock.now) o[k] = m.get(k); }); return o; }
  };
}

function loadGas({ props = {}, user = 'owner@example.com' } = {}) {
  const app = new FakeSpreadsheet();
  const roster = new FakeSpreadsheet();
  const clock = { now: Date.now(), advance(ms) { this.now += ms; } };
  const cache = makeCache(clock);
  const lock = { held: false, beforeAcquire: null, tryLock() {
    if (this.beforeAcquire) { const fn = this.beforeAcquire; this.beforeAcquire = null; fn(); }
    if (this.held) return false;
    this.held = true; return true;
  }, releaseLock() { this.held = false; } };
  let uuid = 0;
  const ctx = {
    console: { log() {}, error() {} },
    SpreadsheetApp: {
      getActive: () => app,
      openById: () => roster,
      flush() {}
    },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => ctx.__activeUser }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
    },
    Utilities: {
      getUuid: () => 'uuid-' + (++uuid),
      sleep() {},
      formatDate: (d) => d.toISOString()
    },
    __activeUser: user
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', '..', 'src');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return { ctx, app, roster, cache, clock, lock };
}

module.exports = { loadGas, FakeSpreadsheet };
