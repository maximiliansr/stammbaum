'use strict';
// Benachrichtigungen über ntfy (https://ntfy.sh oder eigener Server)

function makeNotifier(settings) {
  // Kopfzeilen dürfen nur Latin-1 enthalten; ntfy versteht RFC-2047-kodierte Titel
  const hdr = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

  async function send(event, title, message, opts = {}) {
    const n = settings.get().ntfy;
    if (!opts.force && (!n.aktiv || !n.topic || !(n.ereignisse || {})[event])) return { skipped: true };
    const url = `${String(n.server || 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(n.topic)}`;
    const headers = { 'Title': hdr(title), 'Priority': opts.priority || n.prioritaet || 'default', 'Content-Type': 'text/plain; charset=utf-8' };
    if (opts.tags) headers['Tags'] = opts.tags;
    const base = (settings.get().allgemein || {}).adresse;
    if (opts.click && base) headers['Click'] = base.replace(/\/$/, '') + opts.click;
    if (n.token) headers['Authorization'] = 'Bearer ' + n.token;
    else if (n.benutzer) headers['Authorization'] = 'Basic ' + Buffer.from(`${n.benutzer}:${n.passwort || ''}`).toString('base64');
    try {
      const r = await fetch(url, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`ntfy antwortet mit ${r.status} ${await r.text().catch(() => '')}`.trim());
      return { ok: true };
    } catch (e) {
      console.error('Benachrichtigung fehlgeschlagen:', e.message);
      if (opts.force) throw e;
      return { ok: false, error: e.message };
    }
  }
  return { send };
}

module.exports = { makeNotifier };
