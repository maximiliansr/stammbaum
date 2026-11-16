'use strict';
// Orte für die Karte: Koordinaten über Nominatim (OpenStreetMap) nachschlagen und zwischenspeichern
const fs = require('node:fs');
const path = require('node:path');

const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = function ({ route, store, settings, HttpError, DATA_DIR, APP_VERSION }) {
  const file = path.join(DATA_DIR, 'orte.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const saveCache = () => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(cache, null, 1)); fs.renameSync(t, file); };
  const job = { running: false, done: 0, total: 0, error: '' };

  function placesInUse() {
    const names = new Map();
    for (const p of store.doc.persons) for (const k of ['birthPlace', 'deathPlace', 'city']) {
      const v = String(p[k] || '').trim();
      if (v && !/^(x|-|\?|unbekannt)$/i.test(v)) names.set(keyOf(v), v);
    }
    return names;
  }

  async function lookup(name) {
    const k = settings.get().karte;
    const base = (process.env.MAP_GEOCODER || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
    const q = new URLSearchParams({ q: name, format: 'jsonv2', limit: '1', 'accept-language': 'de' });
    if (k.laender) q.set('countrycodes', k.laender);
    const r = await fetch(`${base}/search?${q}`, { headers: { 'User-Agent': `Familien-Stammbaum/${APP_VERSION} (selbst gehostet)` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Ortssuche antwortet mit ${r.status}`);
    const j = await r.json();
    return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon), label: j[0].display_name } : null;
  }

  async function geocodeMissing(limit = 200) {
    if (job.running) return;
    const todo = [...placesInUse()].filter(([k]) => !cache[k] || (cache[k].status === 'fehler' && Date.now() - Date.parse(cache[k].at) > 864e5)).slice(0, limit);
    if (!todo.length) return;
    Object.assign(job, { running: true, done: 0, total: todo.length, error: '' });
    try {
      for (const [k, name] of todo) {
        try {
          const hit = await lookup(name);
          cache[k] = hit ? { name, lat: hit.lat, lon: hit.lon, label: hit.label, status: 'ok', at: new Date().toISOString() }
            : { name, status: 'nicht gefunden', at: new Date().toISOString() };
        } catch (e) { cache[k] = { name, status: 'fehler', fehler: e.message, at: new Date().toISOString() }; job.error = e.message; }
        job.done++;
        saveCache();
        await new Promise(r => setTimeout(r, 1100)); // Nutzungsregeln von Nominatim: max. 1 Anfrage/Sekunde
      }
    } finally { job.running = false; }
  }

  // Automatisch: kurz nach dem Start und danach alle 30 Minuten fehlende Orte nachschlagen
  const auto = () => { if (settings.get().karte.automatisch) geocodeMissing().catch(() => {}); };
  setTimeout(auto, 20000).unref();
  setInterval(auto, 30 * 60e3).unref();

  route('GET', '/api/orte', 'family', () => {
    const k = settings.get().karte;
    const places = [...placesInUse()].map(([key, name]) => Object.assign({ key, name }, cache[key] ? { lat: cache[key].lat, lon: cache[key].lon, status: cache[key].status } : { status: 'offen' }));
    return { places, kacheln: k.kacheln, quelle: k.quelle, job };
  });

  route('POST', '/api/orte/nachschlagen', 'admin', () => {
    // fehlgeschlagene sofort erneut versuchen
    for (const [k, v] of Object.entries(cache)) if (v.status !== 'ok' && v.status !== 'manuell') delete cache[k];
    geocodeMissing().catch(() => {});
    return { ok: true, job };
  });

  route('PUT', '/api/orte', 'admin', (ctx) => {
    const { name, lat, lon } = ctx.body || {};
    const k = keyOf(name);
    if (!k) throw new HttpError(400, 'Ort fehlt');
    if (lat === null || lat === undefined) { delete cache[k]; saveCache(); return { ok: true }; }
    const la = Number(lat), lo = Number(lon);
    if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180)) throw new HttpError(400, 'Ungültige Koordinaten');
    cache[k] = { name, lat: la, lon: lo, status: 'manuell', at: new Date().toISOString() };
    saveCache();
    return { ok: true };
  });
};
