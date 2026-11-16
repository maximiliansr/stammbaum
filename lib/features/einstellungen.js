'use strict';
// Einstellungen in der Verwaltung + Test-Benachrichtigung
module.exports = function ({ route, settings, notify, HttpError }) {
  route('GET', '/api/einstellungen', 'admin', () => settings.masked());

  route('PUT', '/api/einstellungen', 'admin', (ctx) => {
    const b = ctx.body || {};
    const allowed = {};
    for (const k of ['allgemein', 'ntfy', 'sicherung', 'karte']) if (b[k] && typeof b[k] === 'object') allowed[k] = b[k];
    if (allowed.sicherung) delete allowed.sicherung.letzterLauf;
    return settings.update(allowed);
  });

  route('POST', '/api/einstellungen/ntfy-test', 'admin', async () => {
    const n = settings.get().ntfy;
    if (!n.topic) throw new HttpError(400, 'Bitte zuerst ein Topic eintragen und speichern.');
    try { await notify.send('test', 'Stammbaum: Test', 'Benachrichtigungen funktionieren 🎉', { force: true, tags: 'white_check_mark', click: '/' }); }
    catch (e) { throw new HttpError(502, 'Senden fehlgeschlagen: ' + e.message); }
    return { ok: true };
  });
};
