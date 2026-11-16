'use strict';
// Einstellungen, die in der Verwaltung geändert werden können (data/einstellungen.json).
// Umgebungsvariablen liefern die Startwerte.
const fs = require('node:fs');
const path = require('node:path');

const env = (k, d = '') => process.env[k] ?? d;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|ja|yes|on)$/i.test(String(v)));

function defaults() {
  return {
    allgemein: { adresse: env('PUBLIC_URL') },
    ntfy: {
      aktiv: bool(process.env.NTFY_TOPIC ? 'true' : '', false),
      server: env('NTFY_SERVER', 'https://ntfy.sh'), topic: env('NTFY_TOPIC'), token: env('NTFY_TOKEN'),
      benutzer: env('NTFY_USER'), passwort: env('NTFY_PASSWORD'), prioritaet: 'default',
      ereignisse: { vorschlag: true, import: true, sicherungFehler: true, sicherungOk: false },
    },
    sicherung: {
      aktiv: bool(env('BACKUP_TARGET') ? 'true' : '', false), ziel: env('BACKUP_TARGET', 'ordner'), uhrzeit: env('BACKUP_TIME', '03:30'), behalten: Number(env('BACKUP_KEEP', '30')),
      ordner: { pfad: env('BACKUP_DIR', '/backup') },
      webdav: { url: env('BACKUP_WEBDAV_URL'), benutzer: env('BACKUP_WEBDAV_USER'), passwort: env('BACKUP_WEBDAV_PASSWORD') },
      s3: { endpoint: env('BACKUP_S3_ENDPOINT'), region: env('BACKUP_S3_REGION', 'us-east-1'), bucket: env('BACKUP_S3_BUCKET'), praefix: env('BACKUP_S3_PREFIX', 'stammbaum/'),
        accessKey: env('BACKUP_S3_ACCESS_KEY'), secretKey: env('BACKUP_S3_SECRET_KEY'), pathStyle: bool(env('BACKUP_S3_PATH_STYLE'), true) },
      letzterLauf: null,
    },
    karte: {
      kacheln: env('MAP_TILES', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
      quelle: env('MAP_ATTRIBUTION', '© OpenStreetMap-Mitwirkende'),
      automatisch: bool(env('MAP_GEOCODE'), true), laender: env('MAP_COUNTRIES', ''),
    },
    dublettenIgnoriert: [],
  };
}

// Felder, die nie im Klartext an den Browser gehen
const SECRET_PATHS = ['ntfy.token', 'ntfy.passwort', 'sicherung.webdav.passwort', 'sicherung.s3.secretKey'];
const MASK = '••••••••';

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o); t[last] = v; };

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'einstellungen.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.data = deepMerge(defaults(), saved);
  }
  get() { return this.data; }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  // Für die Oberfläche: Geheimnisse maskiert
  masked() {
    const c = JSON.parse(JSON.stringify(this.data));
    for (const p of SECRET_PATHS) if (getPath(c, p)) setPath(c, p, MASK);
    return c;
  }
  // Übernimmt Änderungen aus der Oberfläche; maskierte Geheimnisse bleiben unverändert
  update(input) {
    const next = deepMerge(this.data, input || {});
    for (const p of SECRET_PATHS) if (getPath(input || {}, p) === MASK) setPath(next, p, getPath(this.data, p));
    next.sicherung.behalten = Math.max(1, Math.min(365, Number(next.sicherung.behalten) || 30));
    if (!/^\d{1,2}:\d{2}$/.test(next.sicherung.uhrzeit || '')) next.sicherung.uhrzeit = '03:30';
    if (!['ordner', 'webdav', 's3'].includes(next.sicherung.ziel)) next.sicherung.ziel = 'ordner';
    this.data = next;
    this.save();
    return this.masked();
  }
}

module.exports = { Settings, MASK };
