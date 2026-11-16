'use strict';
// Externe Sicherung: Zeitplan, „Jetzt sichern“, Archiv herunterladen
const fs = require('node:fs');
const path = require('node:path');
const { createArchive, runBackup, archiveName } = require('../backup');

module.exports = function ({ route, settings, notify, HttpError, DATA_DIR }) {
  let running = false;

  async function backupNow(trigger) {
    if (running) throw new HttpError(409, 'Eine Sicherung läuft bereits');
    running = true;
    const cfg = settings.get().sicherung;
    const started = Date.now();
    try {
      const r = await runBackup(DATA_DIR, cfg);
      cfg.letzterLauf = { at: new Date().toISOString(), ok: true, ziel: cfg.ziel, datei: r.name, groesse: r.size, dauer: Date.now() - started, ausloeser: trigger };
      settings.save();
      notify.send('sicherungOk', 'Sicherung erfolgreich', `${r.name} (${(r.size / 1048576).toFixed(1)} MB) → ${cfg.ziel}`, { tags: 'floppy_disk' });
      return cfg.letzterLauf;
    } catch (e) {
      cfg.letzterLauf = { at: new Date().toISOString(), ok: false, ziel: cfg.ziel, meldung: e.message, ausloeser: trigger };
      settings.save();
      notify.send('sicherungFehler', 'Sicherung fehlgeschlagen', e.message, { priority: 'high', tags: 'warning', click: '/#/admin/einstellungen' });
      throw new HttpError(502, 'Sicherung fehlgeschlagen: ' + e.message);
    } finally { running = false; }
  }

  // Zeitplan: einmal täglich zur eingestellten Uhrzeit (Zeitzone über TZ, z. B. Europe/Berlin)
  setInterval(() => {
    const cfg = settings.get().sicherung;
    if (!cfg.aktiv || running) return;
    const now = new Date();
    const [h, m] = String(cfg.uhrzeit || '03:30').split(':').map(Number);
    const today = now.toLocaleDateString('sv');
    const last = cfg.letzterLauf && cfg.letzterLauf.ausloeser === 'zeitplan' ? new Date(cfg.letzterLauf.at).toLocaleDateString('sv') : '';
    if (last !== today && (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m))) backupNow('zeitplan').catch(() => {});
  }, 60e3).unref();

  route('POST', '/api/sicherung/jetzt', 'admin', async () => ({ ok: true, letzterLauf: await backupNow('manuell') }));

  route('GET', '/api/sicherung/archiv\\.tar\\.gz', 'admin', async (ctx) => {
    const tmp = path.join(DATA_DIR, 'backups', '.download-' + Date.now() + '.tmp');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    try {
      await createArchive(DATA_DIR, tmp);
      ctx.raw(200, fs.readFileSync(tmp), { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${archiveName()}"` });
    } finally { try { fs.unlinkSync(tmp); } catch {} }
  });
};
