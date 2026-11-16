'use strict';
// Dateibasierte Ablage: atomare Schreibvorgänge, tägliche Sicherungen, Änderungsprotokoll.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class Store {
  constructor(dir, seedFile) {
    this.dir = dir;
    this.file = path.join(dir, 'stammbaum.json');
    this.suggFile = path.join(dir, 'vorschlaege.json');
    this.logFile = path.join(dir, 'protokoll.jsonl');
    this.backupDir = path.join(dir, 'backups');
    this.photoDir = path.join(dir, 'fotos');
    this.pendingDir = path.join(dir, 'fotos-vorschlaege');
    this.sourceDir = path.join(dir, 'quellen');
    for (const d of [dir, this.backupDir, this.photoDir, this.pendingDir, this.sourceDir]) fs.mkdirSync(d, { recursive: true });

    if (!fs.existsSync(this.file)) {
      if (seedFile && fs.existsSync(seedFile)) {
        fs.copyFileSync(seedFile, this.file);
        console.log('Startdaten übernommen aus', seedFile);
      } else {
        this.writeJson(this.file, { format: 'stammbaum-v1', title: 'Stammbaum', updatedAt: new Date().toISOString(), persons: [] });
      }
    }
    this.doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!Array.isArray(this.doc.sources)) this.doc.sources = [];
    this.suggestions = fs.existsSync(this.suggFile) ? JSON.parse(fs.readFileSync(this.suggFile, 'utf8')) : [];
    this.reindex();
  }

  reindex() {
    this.byId = new Map(this.doc.persons.map(p => [p.id, p]));
  }

  writeJson(file, obj) {
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    fs.renameSync(tmp, file);
  }

  backupIfNeeded() {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(this.backupDir, `stammbaum-${day}.json`);
    if (!fs.existsSync(target) && fs.existsSync(this.file)) fs.copyFileSync(this.file, target);
    const keep = Number(process.env.BACKUP_DAYS || 90);
    const files = fs.readdirSync(this.backupDir).filter(f => /^stammbaum-.*\.json$/.test(f)).sort();
    while (files.length > keep) fs.unlinkSync(path.join(this.backupDir, files.shift()));
  }

  save() {
    this.backupIfNeeded();
    this.doc.updatedAt = new Date().toISOString();
    this.writeJson(this.file, this.doc);
    this.reindex();
  }

  saveSuggestions() {
    this.writeJson(this.suggFile, this.suggestions);
  }

  log(entry) {
    const line = JSON.stringify(Object.assign({ id: 'l' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), at: new Date().toISOString() }, entry));
    fs.appendFileSync(this.logFile, line + '\n');
  }

  readLog(limit = 400) {
    if (!fs.existsSync(this.logFile)) return [];
    const lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  replaceAll(persons, title, sources) {
    this.backupIfNeeded();
    // Vor dem Import zusätzlich eine Sicherung mit Uhrzeit
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.file, path.join(this.backupDir, `vor-import-${stamp}.json`));
    this.doc.persons = persons;
    if (title) this.doc.title = title;
    if (Array.isArray(sources)) {
      const ids = new Set(persons.map(p => p.id));
      this.doc.sources = sources.filter(s => fs.existsSync(this.sourcePath(s.id, s.mime)))
        .map(s => Object.assign({}, s, { personIds: (s.personIds || []).filter(id => ids.has(id)) }));
    } else {
      const ids = new Set(persons.map(p => p.id));
      this.doc.sources.forEach(s => { s.personIds = (s.personIds || []).filter(id => ids.has(id)); });
    }
    this.save();
  }

  photoPath(id) { return path.join(this.photoDir, id.replace(/[^a-zA-Z0-9_-]/g, '') + '.jpg'); }
  sourcePath(id, mime) { return path.join(this.sourceDir, id.replace(/[^a-zA-Z0-9_-]/g, '') + (mime === 'application/pdf' ? '.pdf' : '.jpg')); }
  sourceThumbPath(id) { return path.join(this.sourceDir, id.replace(/[^a-zA-Z0-9_-]/g, '') + '-vorschau.jpg'); }
  pendingFilePath(id, mime) { return path.join(this.pendingDir, id.replace(/[^a-zA-Z0-9_-]/g, '') + '-quelle' + (mime === 'application/pdf' ? '.pdf' : '.jpg')); }
  pendingPath(id) { return path.join(this.pendingDir, id.replace(/[^a-zA-Z0-9_-]/g, '') + '.jpg'); }
}

module.exports = { Store };
