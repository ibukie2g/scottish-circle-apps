// GAS のサービスの最小限の偽物(テスト用)。src/*.js を vm で読み込んで、通しの流れを確かめる
// sports-day の fake_gas.js をもとに、スプレッドシートを複数(ID で開く・新しく作る)扱えるようにしたもの
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
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  set(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // 本物も先頭の ' は文字として残らない
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
  getRange(a, b, c, d) { return new FakeRange(this, a, b, c || 1, d || 1); }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
}

class FakeSpreadsheet {
  constructor(id) { this.id = id; this.sheets = [new FakeSheet('シート1')]; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
}

function makeCache(clock) {
  const m = new Map(), expiry = new Map();
  return {
    get: k => (m.has(k) && expiry.get(k) > clock.now ? m.get(k) : null),
    put: (k, v, sec = 10) => { expiry.set(k, clock.now + sec * 1000); m.set(k, String(v)); },
    remove: k => m.delete(k),
    removeAll: ks => ks.forEach(k => m.delete(k))
  };
}

function loadGas({ props = {} } = {}) {
  const files = {};
  let n = 0;
  const open = id => { if (!files[id]) throw new Error('no file ' + id); return files[id]; };
  const newFile = (id) => { const s = new FakeSpreadsheet(id || 'file' + (++n)); files[s.id] = s; return s; };
  const clock = { now: Date.now(), advance(ms) { this.now += ms; } };
  const cache = makeCache(clock);
  const lock = { held: false, tryLock() { if (this.held) return false; this.held = true; return true; }, releaseLock() { this.held = false; } };
  let uuid = 0;
  const ctx = {
    console: { log() {}, error() {} },
    SpreadsheetApp: { openById: open, create: () => newFile(), flush() {} },
    DriveApp: { getFileById: () => ({ moveTo() {} }), getFolderById: () => ({}) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.com/exec' }) },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: {
      getUuid: () => { uuid++; return ('0000000' + uuid.toString(16)).slice(-8) + '-1a2b-4c3d-8e9f-' + ('00000000000' + (uuid * 7919).toString(16)).slice(-12); },
      sleep() {},
      formatDate: (d, tz, fmt) => {
        const j = new Date(d.getTime() + 9 * 3600000);
        const p = x => ('0' + x).slice(-2);
        if (fmt === 'HH:mm') return p(j.getUTCHours()) + ':' + p(j.getUTCMinutes());
        return j.getUTCFullYear() + '-' + p(j.getUTCMonth() + 1) + '-' + p(j.getUTCDate());
      }
    }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', '..', 'src');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return { ctx, files, newFile, props, clock };
}

module.exports = { loadGas };
