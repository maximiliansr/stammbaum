'use strict';
// Stammbaum-Server – ohne externe Abhängigkeiten (Node.js ≥ 20)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./lib/store');
const { sanitizeFields, sanitizeSource, SOURCE_KINDS, emptyPerson, newId, clean } = require('./lib/model');
const { importAny, validateGraph } = require('./lib/importer');
const { birthdayCalendar } = require('./lib/ics');

// ---------- Konfiguration ----------
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SEED_FILE = process.env.SEED_FILE || path.join(__dirname, 'seed', 'beispiel.json');
const FAMILY_PASSWORD = process.env.FAMILY_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const FAMILY_SEES_ADDRESSES = !/^(0|false|nein|no)$/i.test(process.env.FAMILY_SEES_ADDRESSES || 'true');
const TRUST_PROXY = /^(1|true|ja|yes)$/i.test(process.env.TRUST_PROXY || '');
const COOKIE_SECURE = /^(1|true|ja|yes)$/i.test(process.env.COOKIE_SECURE || '');
const SITE_TITLE = process.env.SITE_TITLE || '';
const APP_VERSION = require('./package.json').version;
const GIT_SHA = (process.env.GIT_SHA || '').slice(0, 7);
const REPO_URL = (process.env.REPO_URL || '').replace(/\/$/, '');

if (!FAMILY_PASSWORD || !ADMIN_PASSWORD) {
  console.error('FEHLER: Bitte FAMILY_PASSWORD und ADMIN_PASSWORD setzen (siehe .env.example).');
  process.exit(1);
}
if (FAMILY_PASSWORD === ADMIN_PASSWORD) {
  console.error('FEHLER: FAMILY_PASSWORD und ADMIN_PASSWORD müssen sich unterscheiden.');
  process.exit(1);
}

// BEISPIELDATEN=false → leerer Start statt erfundener Beispielfamilie
const store = new Store(DATA_DIR, /^(0|false|nein|no)$/i.test(process.env.BEISPIELDATEN || 'true') ? null : SEED_FILE);

// Geheimschlüssel für Sitzungen: aus Umgebung oder einmalig erzeugt und gespeichert
const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
})();

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
// Passwortänderung macht alte Sitzungen ungültig
const pwVersion = { family: hash('f' + FAMILY_PASSWORD).slice(0, 10), admin: hash('a' + ADMIN_PASSWORD).slice(0, 10) };
const ICS_TOKEN = hmac('ics:' + FAMILY_PASSWORD).slice(0, 32);

function safeEqual(a, b) {
  const x = Buffer.from(hash(String(a))), y = Buffer.from(hash(String(b)));
  return crypto.timingSafeEqual(x, y);
}

function makeToken(role, days) {
  const body = Buffer.from(JSON.stringify({ r: role, v: pwVersion[role], e: Date.now() + days * 864e5 })).toString('base64url');
  return body + '.' + hmac(body);
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const expect = hmac(body);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (d.e < Date.now() || pwVersion[d.r] !== d.v) return null;
    return d.r;
  } catch { return null; }
}

// ---------- Hilfen ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
const buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b);
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 36e5) buckets.delete(k); }, 6e5).unref();

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, SEC_HEADERS, headers));
  res.end(payload);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(null);
    const ct = req.headers['content-type'] || '';
    // Anfragen ohne Inhalt (z. B. DELETE) brauchen keinen JSON-Typ
    const empty = !req.headers['transfer-encoding'] && Number(req.headers['content-length'] || 0) === 0;
    if (empty) { req.resume(); return resolve({}); }
    if (!ct.startsWith('application/json')) return reject(new HttpError(415, 'Nur JSON wird angenommen'));
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

// Quellen: JPEG (vom Browser verkleinert) oder PDF
function decodeFile(dataUrl) {
  const m = /^data:(image\/jpeg|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Datei muss ein Bild oder PDF sein');
  const buf = Buffer.from(m[2], 'base64');
  const isPdf = m[1] === 'application/pdf';
  if (buf.length > 15 * 1024 * 1024) throw new HttpError(413, 'Datei zu groß (max. 15 MB)');
  if (isPdf ? buf.slice(0, 4).toString() !== '%PDF' : (buf[0] !== 0xFF || buf[1] !== 0xD8)) throw new HttpError(400, 'Datei ungültig');
  return { buf, mime: m[1] };
}

function decodeJpeg(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Foto muss als JPEG übertragen werden');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 2.5 * 1024 * 1024 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new HttpError(400, 'Foto ungültig oder zu groß');
  return buf;
}

// ---------- Datenlogik ----------
const ADDRESS_FIELDS = ['street', 'zip'];

function publicPersons(role) {
  return store.doc.persons.map(p => {
    const q = Object.assign({}, p);
    if (role !== 'admin' && (!FAMILY_SEES_ADDRESSES || p.death)) for (const f of ADDRESS_FIELDS) q[f] = '';
    if (role !== 'admin') delete q.code;
    return q;
  });
}

function displayName(p) { return [p.firstName, p.lastName].filter(Boolean).join(' ') || '(ohne Namen)'; }

function diff(oldP, fields) {
  const changes = {};
  for (const [k, v] of Object.entries(fields)) {
    const a = JSON.stringify(oldP[k] ?? ''), b = JSON.stringify(v ?? '');
    if (a !== b) changes[k] = [oldP[k] ?? '', v];
  }
  return changes;
}

function isDescendant(candidateId, ofId) {
  // true, wenn candidateId ein Nachkomme (Blutslinie) von ofId ist
  let cur = store.byId.get(candidateId), steps = 0;
  while (cur && steps++ < 500) {
    if (cur.id === ofId) return true;
    cur = cur.kind === 'partner' ? store.byId.get(cur.partnerOf) : store.byId.get(cur.parentId);
  }
  return false;
}

function nextCode(parent, kind) {
  if (!parent || !parent.code) return '';
  const used = new Set(store.doc.persons.map(p => p.code));
  if (kind === 'partner') {
    let c = parent.code + 'a', n = 2;
    while (used.has(c)) c = parent.code + 'a' + n++;
    return c;
  }
  for (const ch of 'bcdefghijklmnopqrstuvwxyz') if (!used.has(parent.code + ch)) return parent.code + ch;
  return '';
}

const ROLES = ['parent', 'sibling', 'child', 'partnerOfParent'];
const normRole = (r) => (ROLES.includes(r) ? r : 'parent');
const ROLE_TXT = { parent: 'Elternteil', sibling: 'Geschwister', child: 'Kind aus anderer Beziehung', partnerOfParent: 'Partner/in eines Elternteils' };

// Eltern eines Geschwisters in der Herkunftsfamilie prüfen: [] = beide Eltern (volle Geschwister)
function originParentIds(partnerId, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const pool = store.doc.persons.filter(x => x.originOf === partnerId && (x.role === 'parent' || x.role === 'partnerOfParent'));
  const ok = Array.from(new Set(ids.filter(id => pool.some(x => x.id === id)))).slice(0, 2);
  if (!ok.length) throw new HttpError(400, 'Elternteil gehört nicht zu dieser Herkunftsfamilie');
  const parents = pool.filter(x => x.role === 'parent').map(x => x.id).sort();
  if (ok.length === parents.length && ok.slice().sort().join() === parents.join()) return [];
  return ok;
}

function createPerson({ kind, anchorId, fields, otherParentId, role, parentIds }, who) {
  if (kind === 'root') {
    // Neue Stammperson (oberste Generation einer Linie)
    const p = Object.assign(emptyPerson(), fields, { id: newId(), kind: 'blood', order: store.doc.persons.filter(x => x.kind === 'blood' && !x.parentId).length + 1, updatedAt: new Date().toISOString() });
    store.doc.persons.push(p); store.save();
    store.log({ who, action: 'Stammperson angelegt', personId: p.id, name: displayName(p) });
    return p;
  }
  const anchor = store.byId.get(anchorId);
  if (!anchor) throw new HttpError(400, 'Bezugsperson nicht gefunden');
  const p = Object.assign(emptyPerson(), fields);
  p.id = newId();
  if (kind === 'origin') {
    // Eltern/Geschwister von angeheirateten Partnern
    const partner = anchor.kind === 'origin' ? store.byId.get(anchor.originOf) : anchor;
    if (!partner || partner.kind !== 'partner') throw new HttpError(400, 'Eltern/Geschwister lassen sich nur bei angeheirateten Partnern ergänzen');
    p.kind = 'origin'; p.originOf = partner.id; p.role = normRole(role);
    if (p.role === 'partnerOfParent') {
      if (anchor.kind !== 'origin' || anchor.role !== 'parent') throw new HttpError(400, 'Weitere Partner nur bei einem Elternteil der Herkunftsfamilie');
      p.partnerOfId = anchor.id;
    }
    if (p.role === 'sibling') p.parentIds = originParentIds(partner.id, parentIds);
    p.order = store.doc.persons.filter(x => x.originOf === partner.id).length + 1;
    p.updatedAt = new Date().toISOString();
    store.doc.persons.push(p); store.save();
    store.log({ who, action: `${ROLE_TXT[p.role]} (Partnerfamilie) hinzugefügt`, personId: p.id, name: displayName(p), anchor: displayName(partner) });
    return p;
  }
  if (anchor.kind === 'origin') throw new HttpError(400, 'Für Personen der Herkunftsfamilie bitte „+ Kind“ bzw. „+ Partner/in“ auf deren Seite verwenden');
  if (kind === 'partner') {
    p.kind = 'partner'; p.partnerOf = anchor.id;
    p.order = store.doc.persons.filter(x => x.partnerOf === anchor.id).length + 1;
  } else {
    // Kinder hängen immer an der blutsverwandten Person; Kind eines Partners → am Partner/in-Gegenüber
    const bloodParent = anchor.kind === 'partner' ? store.byId.get(anchor.partnerOf) : anchor;
    p.kind = 'blood'; p.parentId = bloodParent.id;
    const partnerIds = store.doc.persons.filter(x => x.partnerOf === bloodParent.id);
    if (anchor.kind === 'partner') p.otherParentId = anchor.id;
    else if (otherParentId === 'none') p.otherParentId = null;
    else if (otherParentId && partnerIds.some(x => x.id === otherParentId)) p.otherParentId = otherParentId;
    else { const cur = partnerIds.find(x => !x.divorced); p.otherParentId = cur ? cur.id : null; }
    p.order = store.doc.persons.filter(x => x.parentId === bloodParent.id).length + 1;
  }
  if (!p.code) p.code = nextCode(kind === 'partner' ? anchor : store.byId.get(p.parentId), kind);
  p.updatedAt = new Date().toISOString();
  store.doc.persons.push(p);
  store.save();
  store.log({ who, action: kind === 'partner' ? 'Partner/in hinzugefügt' : 'Kind hinzugefügt', personId: p.id, name: displayName(p), anchor: displayName(anchor) });
  return p;
}

function updatePerson(id, fields, who, extra = {}) {
  const p = store.byId.get(id);
  if (!p) throw new HttpError(404, 'Person nicht gefunden');
  const changes = diff(p, fields);
  // Strukturänderungen (nur Admin)
  if (extra.parentId !== undefined && p.kind === 'blood' && extra.parentId !== p.parentId) {
    if (extra.parentId && !store.byId.get(extra.parentId)) throw new HttpError(400, 'Elternteil nicht gefunden');
    if (extra.parentId && store.byId.get(extra.parentId).kind !== 'blood') throw new HttpError(400, 'Elternteil muss aus der Blutslinie sein – Partner bitte als „zweites Elternteil“ wählen');
    if (extra.parentId && isDescendant(extra.parentId, p.id)) throw new HttpError(400, 'Das würde einen Kreis in der Abstammung erzeugen');
    changes.parentId = [p.parentId, extra.parentId || null];
    p.parentId = extra.parentId || null;
    if (p.otherParentId && store.byId.get(p.otherParentId)?.partnerOf !== p.parentId) p.otherParentId = null;
  }
  if (extra.otherParentId === 'none' || extra.otherParentId === '') extra.otherParentId = null;
  if (extra.otherParentId !== undefined && p.kind === 'blood' && extra.otherParentId !== p.otherParentId) {
    const op = extra.otherParentId ? store.byId.get(extra.otherParentId) : null;
    if (extra.otherParentId && (!op || op.partnerOf !== p.parentId)) throw new HttpError(400, 'Zweites Elternteil muss Partner/in des Elternteils sein');
    changes.otherParentId = [p.otherParentId, extra.otherParentId || null];
    p.otherParentId = extra.otherParentId || null;
  }
  if (extra.partnerOf !== undefined && p.kind === 'partner' && extra.partnerOf && extra.partnerOf !== p.partnerOf) {
    const t = store.byId.get(extra.partnerOf);
    if (!t || t.kind !== 'blood') throw new HttpError(400, 'Partner/in muss zu einer Person der Blutslinie gehören');
    changes.partnerOf = [p.partnerOf, t.id];
    store.doc.persons.forEach(c => { if (c.otherParentId === p.id) c.otherParentId = null; });
    p.partnerOf = t.id;
  }
  if (extra.role !== undefined && p.kind === 'origin' && ROLES.includes(extra.role) && extra.role !== p.role) {
    changes.role = [p.role, extra.role]; p.role = extra.role;
  }
  if (extra.parentIds !== undefined && p.kind === 'origin' && p.role === 'sibling') {
    const ids = originParentIds(p.originOf, extra.parentIds);
    if (ids.join() !== (p.parentIds || []).join()) { changes.parentIds = [p.parentIds || [], ids]; p.parentIds = ids; }
  }
  if (extra.order !== undefined && Number.isFinite(Number(extra.order))) p.order = Number(extra.order);
  if (!Object.keys(changes).length) return { person: p, changes };
  Object.assign(p, fields);
  p.updatedAt = new Date().toISOString();
  store.save();
  store.log({ who, action: 'geändert', personId: p.id, name: displayName(p), changes });
  return { person: p, changes };
}

function deletePerson(id, who) {
  const p = store.byId.get(id);
  if (!p) throw new HttpError(404, 'Person nicht gefunden');
  const kids = store.doc.persons.filter(x => x.parentId === id);
  const partners = store.doc.persons.filter(x => x.partnerOf === id);
  const origins = store.doc.persons.filter(x => x.originOf === id || x.partnerOfId === id);
  if (kids.length || partners.length || origins.length) throw new HttpError(409, `Erst Kinder (${kids.length}), Partner (${partners.length}) und Angehörige der Herkunftsfamilie (${origins.length}) entfernen oder umhängen.`);
  store.doc.persons.forEach(c => { if (Array.isArray(c.parentIds) && c.parentIds.includes(id)) c.parentIds = c.parentIds.filter(x => x !== id); });
  store.doc.persons = store.doc.persons.filter(x => x.id !== id);
  store.doc.sources.forEach(s => { s.personIds = (s.personIds || []).filter(x => x !== id); });
  store.doc.persons.forEach(c => { if (c.otherParentId === id) c.otherParentId = null; });
  try { fs.unlinkSync(store.photoPath(id)); } catch {}
  store.save();
  store.log({ who, action: 'gelöscht', personId: id, name: displayName(p), snapshot: p });
}

// ---------- Routen ----------
const routes = [];
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), role, fn });

route('GET', '/api/me', null, (ctx) => ({
  role: ctx.role, title: SITE_TITLE || store.doc.title,
  icsPath: ctx.role ? `/kalender/${ICS_TOKEN}/geburtstage.ics` : null,
  familySeesAddresses: FAMILY_SEES_ADDRESSES,
  version: APP_VERSION, commit: GIT_SHA, repo: REPO_URL,
}));

route('POST', '/api/login', null, (ctx) => {
  const ip = clientIp(ctx.req);
  if (rateLimited('login:' + ip, 10, 15 * 60e3)) throw new HttpError(429, 'Zu viele Versuche – bitte in 15 Minuten erneut probieren.');
  const pw = String((ctx.body || {}).password || '');
  let role = null;
  if (safeEqual(pw, ADMIN_PASSWORD)) role = 'admin';
  else if (safeEqual(pw, FAMILY_PASSWORD)) role = 'family';
  if (!role) throw new HttpError(401, 'Passwort stimmt nicht.');
  const days = role === 'admin' ? 14 : 180;
  ctx.setCookie('stb', makeToken(role, days), days);
  return { role };
});

route('POST', '/api/logout', null, (ctx) => { ctx.setCookie('stb', '', 0); return { ok: true }; });

route('GET', '/api/data', 'family', (ctx) => ({
  title: SITE_TITLE || store.doc.title, updatedAt: store.doc.updatedAt, persons: publicPersons(ctx.role),
  sources: store.doc.sources, sourceKinds: SOURCE_KINDS,
  openSuggestions: ctx.role === 'admin' ? store.suggestions.filter(s => s.status === 'offen').length : undefined,
}));

route('GET', '/api/fotos/([a-zA-Z0-9_-]+)\\.jpg', 'family', (ctx, m) => {
  const f = store.photoPath(m[1]);
  if (!fs.existsSync(f)) throw new HttpError(404, 'Kein Foto');
  ctx.raw(200, fs.readFileSync(f), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
});

route('GET', '/api/vorschlaege/([a-zA-Z0-9_-]+)/foto\\.jpg', 'admin', (ctx, m) => {
  const f = store.pendingPath(m[1]);
  if (!fs.existsSync(f)) throw new HttpError(404, 'Kein Foto');
  ctx.raw(200, fs.readFileSync(f), { 'Content-Type': 'image/jpeg' });
});

// Vorschläge der Familie
route('POST', '/api/vorschlaege', 'family', (ctx) => {
  const b = ctx.body || {};
  if (rateLimited('sugg:' + clientIp(ctx.req), 40, 36e5)) throw new HttpError(429, 'Zu viele Vorschläge in kurzer Zeit.');
  const type = ['edit', 'child', 'partner', 'origin', 'remark', 'source'].includes(b.type) ? b.type : null;
  if (!type) throw new HttpError(400, 'Unbekannte Art von Vorschlag');
  const target = store.byId.get(b.targetId);
  if (!target) throw new HttpError(400, 'Person nicht gefunden');
  const author = clean(b.author, 120);
  if (!author) throw new HttpError(400, 'Bitte deinen Namen angeben, damit wir nachfragen können.');
  let fields = null;
  if (type !== 'remark' && type !== 'source') {
    const r = sanitizeFields(Object.assign({}, b.fields, { __legacy: target }), { partial: type === 'edit' });
    if (r.errors.length) throw new HttpError(400, r.errors.join(' · '));
    fields = r.fields;
    const structChanged = b.structure && ((target.kind === 'blood' && ((b.structure.parentId || null) !== target.parentId || (b.structure.otherParentId || null) !== target.otherParentId))
      || (target.kind === 'origin' && Array.isArray(b.structure.parentIds) && b.structure.parentIds.join() !== (target.parentIds || []).join()));
    if (type === 'edit' && !Object.keys(diff(target, fields)).length && !b.photo && !structChanged) throw new HttpError(400, 'Es wurde nichts geändert.');
  }
  const s = {
    id: 's' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    createdAt: new Date().toISOString(), status: 'offen', type, targetId: target.id,
    targetName: displayName(target), author, message: clean(b.message, 2000), fields,
    otherParentId: type === 'child' ? clean(b.otherParentId, 40) || null : null, hasPhoto: false,
    role: type === 'origin' ? normRole(b.role) : undefined,
    parentIds: type === 'origin' && Array.isArray(b.parentIds) ? b.parentIds.map(x => clean(x, 40)).slice(0, 2) : undefined,
    structure: type === 'edit' && b.structure ? { parentId: clean(b.structure.parentId, 40) || null, otherParentId: clean(b.structure.otherParentId, 40) || null,
      parentIds: Array.isArray(b.structure.parentIds) ? b.structure.parentIds.map(x => clean(x, 40)).slice(0, 2) : undefined } : undefined,
  };
  if (type === 'origin' && target.kind !== 'partner' && !(target.kind === 'origin' && target.role === 'parent')) throw new HttpError(400, 'Herkunftsfamilie nur bei angeheirateten Partnern bzw. deren Eltern');
  if (type === 'source') {
    const f = decodeFile(b.file);
    s.source = sanitizeSource(b.source || {}); s.source.mime = f.mime;
    fs.writeFileSync(store.pendingFilePath(s.id, f.mime), f.buf);
    if (b.thumb) fs.writeFileSync(store.pendingPath(s.id + '-vorschau'), decodeJpeg(b.thumb));
  }
  if (b.photo) { fs.writeFileSync(store.pendingPath(s.id), decodeJpeg(b.photo)); s.hasPhoto = true; }
  store.suggestions.push(s);
  store.saveSuggestions();
  return { ok: true, id: s.id };
});

route('GET', '/api/vorschlaege', 'admin', () => store.suggestions.slice().reverse().slice(0, 500));

route('GET', '/api/vorschlaege/([a-zA-Z0-9_-]+)/quelle', 'admin', (ctx, m) => {
  const s = store.suggestions.find(x => x.id === m[1]);
  if (!s || !s.source) throw new HttpError(404, 'Keine Quelle');
  const thumb = ctx.req.url.includes('vorschau') && fs.existsSync(store.pendingPath(s.id + '-vorschau'));
  const f = thumb ? store.pendingPath(s.id + '-vorschau') : store.pendingFilePath(s.id, s.source.mime);
  if (!fs.existsSync(f)) throw new HttpError(404, 'Datei fehlt');
  ctx.raw(200, fs.readFileSync(f), { 'Content-Type': thumb ? 'image/jpeg' : s.source.mime });
});

route('POST', '/api/vorschlaege/([a-zA-Z0-9_-]+)/(annehmen|ablehnen)', 'admin', (ctx, m) => {
  const s = store.suggestions.find(x => x.id === m[1]);
  if (!s) throw new HttpError(404, 'Vorschlag nicht gefunden');
  if (s.status !== 'offen') throw new HttpError(409, 'Vorschlag wurde bereits bearbeitet');
  const who = `Admin (Vorschlag von ${s.author})`;
  let personId = s.targetId;
  if (m[2] === 'annehmen') {
    const override = (ctx.body || {}).fields;
    let fields = s.fields;
    if (override) {
      const r = sanitizeFields(Object.assign({}, override, { __legacy: store.byId.get(s.targetId) || {} }), { partial: s.type === 'edit' });
      if (r.errors.length) throw new HttpError(400, r.errors.join(' · '));
      fields = r.fields;
    }
    if (s.type === 'edit') {
      const t = store.byId.get(s.targetId);
      const extra = !s.structure ? {} : t && t.kind === 'origin' ? { parentIds: s.structure.parentIds } : { parentId: s.structure.parentId, otherParentId: s.structure.otherParentId };
      updatePerson(s.targetId, fields, who, extra);
    }
    else if (s.type === 'child' || s.type === 'partner' || s.type === 'origin') {
      personId = createPerson({ kind: s.type === 'child' ? 'child' : s.type, anchorId: s.targetId, fields, otherParentId: s.otherParentId, role: s.role, parentIds: s.parentIds }, who).id;
    } else if (s.type === 'source') {
      const src = Object.assign(sanitizeSource(Object.assign({}, s.source, (ctx.body || {}).source || {})), {
        id: 'q' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), mime: s.source.mime,
        personIds: [s.targetId], hasThumb: false, addedBy: s.author, createdAt: new Date().toISOString(),
      });
      const from = store.pendingFilePath(s.id, s.source.mime);
      if (!fs.existsSync(from)) throw new HttpError(410, 'Datei des Vorschlags fehlt');
      fs.renameSync(from, store.sourcePath(src.id, src.mime));
      if (fs.existsSync(store.pendingPath(s.id + '-vorschau'))) { fs.renameSync(store.pendingPath(s.id + '-vorschau'), store.sourceThumbPath(src.id)); src.hasThumb = true; }
      store.doc.sources.push(src); store.save();
      store.log({ who, action: 'Quelle hinzugefügt', personId: s.targetId, name: `${src.title} (${displayName(store.byId.get(s.targetId) || {})})` });
    }
    if (s.hasPhoto && fs.existsSync(store.pendingPath(s.id)) && store.byId.get(personId)) {
      fs.renameSync(store.pendingPath(s.id), store.photoPath(personId));
      const p = store.byId.get(personId); p.hasPhoto = true; p.updatedAt = new Date().toISOString(); store.save();
      store.log({ who, action: 'Foto gesetzt', personId, name: displayName(p) });
    }
    s.status = 'übernommen';
  } else {
    s.status = 'abgelehnt';
    try { fs.unlinkSync(store.pendingPath(s.id)); } catch {}
    if (s.source) { try { fs.unlinkSync(store.pendingFilePath(s.id, s.source.mime)); } catch {} try { fs.unlinkSync(store.pendingPath(s.id + '-vorschau')); } catch {} }
  }
  s.decidedAt = new Date().toISOString();
  s.reply = clean((ctx.body || {}).reply, 1000);
  store.saveSuggestions();
  return { ok: true, personId };
});

// Direkte Bearbeitung (Admin)
route('POST', '/api/personen', 'admin', (ctx) => {
  const b = ctx.body || {};
  const r = sanitizeFields(b.fields || {});
  if (r.errors.length) throw new HttpError(400, r.errors.join(' · '));
  const kind = ['partner', 'origin', 'root'].includes(b.kind) ? b.kind : 'child';
  const p = createPerson({ kind, anchorId: b.anchorId, fields: r.fields, otherParentId: b.otherParentId, role: b.role, parentIds: b.parentIds }, 'Admin');
  return { person: p };
});

route('PUT', '/api/personen/([a-zA-Z0-9_-]+)', 'admin', (ctx, m) => {
  const b = ctx.body || {};
  const target = store.byId.get(m[1]);
  if (!target) throw new HttpError(404, 'Person nicht gefunden');
  const r = sanitizeFields(Object.assign({}, b.fields, { __legacy: target }));
  if (r.errors.length) throw new HttpError(400, r.errors.join(' · '));
  const res = updatePerson(m[1], r.fields, 'Admin', { parentId: b.parentId, otherParentId: b.otherParentId, partnerOf: b.partnerOf, order: b.order, role: b.role, parentIds: b.parentIds });
  return { person: res.person, changed: Object.keys(res.changes).length };
});

// Einzelne Felder ändern (z. B. aus dem Interview)
route('PATCH', '/api/personen/([a-zA-Z0-9_-]+)', 'admin', (ctx, m) => {
  const target = store.byId.get(m[1]);
  if (!target) throw new HttpError(404, 'Person nicht gefunden');
  const r = sanitizeFields(Object.assign({}, (ctx.body || {}).fields, { __legacy: target }), { partial: true });
  if (r.errors.length) throw new HttpError(400, r.errors.join(' · '));
  return { person: updatePerson(m[1], r.fields, (ctx.body || {}).who || 'Admin').person };
});

// ---------- Quellen ----------
route('GET', '/api/quellen/([a-zA-Z0-9_-]+)/(datei|vorschau)', 'family', (ctx, m) => {
  const s = store.doc.sources.find(x => x.id === m[1]);
  if (!s) throw new HttpError(404, 'Quelle nicht gefunden');
  const thumb = m[2] === 'vorschau';
  const f = thumb ? store.sourceThumbPath(s.id) : store.sourcePath(s.id, s.mime);
  if (!fs.existsSync(f)) throw new HttpError(404, 'Datei fehlt');
  const name = (s.title || 'quelle').replace(/[^\w äöüÄÖÜß.-]/g, '').slice(0, 60) + (s.mime === 'application/pdf' ? '.pdf' : '.jpg');
  ctx.raw(200, fs.readFileSync(f), { 'Content-Type': thumb ? 'image/jpeg' : s.mime, 'Cache-Control': 'private, max-age=86400',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}` });
});

function cleanPersonIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).filter(id => store.byId.has(id)))).slice(0, 60);
}

route('POST', '/api/quellen', 'admin', (ctx) => {
  const b = ctx.body || {};
  const f = decodeFile(b.file);
  const src = Object.assign(sanitizeSource(b.source || {}), {
    id: 'q' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), mime: f.mime,
    personIds: cleanPersonIds(b.personIds), hasThumb: false, addedBy: 'Admin', createdAt: new Date().toISOString(),
  });
  if (!src.personIds.length) throw new HttpError(400, 'Bitte mindestens eine Person zuordnen');
  fs.writeFileSync(store.sourcePath(src.id, src.mime), f.buf);
  if (b.thumb) { fs.writeFileSync(store.sourceThumbPath(src.id), decodeJpeg(b.thumb)); src.hasThumb = true; }
  store.doc.sources.push(src); store.save();
  store.log({ who: 'Admin', action: 'Quelle hinzugefügt', personId: src.personIds[0], name: src.title });
  return { source: src };
});

route('PUT', '/api/quellen/([a-zA-Z0-9_-]+)', 'admin', (ctx, m) => {
  const s = store.doc.sources.find(x => x.id === m[1]);
  if (!s) throw new HttpError(404, 'Quelle nicht gefunden');
  const b = ctx.body || {};
  Object.assign(s, sanitizeSource(b.source || s));
  if (b.personIds) { const ids = cleanPersonIds(b.personIds); if (!ids.length) throw new HttpError(400, 'Mindestens eine Person zuordnen'); s.personIds = ids; }
  store.save();
  store.log({ who: 'Admin', action: 'Quelle geändert', personId: s.personIds[0], name: s.title });
  return { source: s };
});

route('DELETE', '/api/quellen/([a-zA-Z0-9_-]+)', 'admin', (ctx, m) => {
  const s = store.doc.sources.find(x => x.id === m[1]);
  if (!s) throw new HttpError(404, 'Quelle nicht gefunden');
  store.doc.sources = store.doc.sources.filter(x => x !== s);
  for (const f of [store.sourcePath(s.id, s.mime), store.sourceThumbPath(s.id)]) { try { fs.unlinkSync(f); } catch {} }
  store.save();
  store.log({ who: 'Admin', action: 'Quelle gelöscht', name: s.title });
  return { ok: true };
});

route('DELETE', '/api/personen/([a-zA-Z0-9_-]+)', 'admin', (ctx, m) => { deletePerson(m[1], 'Admin'); return { ok: true }; });

route('PUT', '/api/personen/([a-zA-Z0-9_-]+)/foto', 'admin', (ctx, m) => {
  const p = store.byId.get(m[1]);
  if (!p) throw new HttpError(404, 'Person nicht gefunden');
  fs.writeFileSync(store.photoPath(p.id), decodeJpeg((ctx.body || {}).photo));
  p.hasPhoto = true; p.updatedAt = new Date().toISOString(); store.save();
  store.log({ who: 'Admin', action: 'Foto gesetzt', personId: p.id, name: displayName(p) });
  return { person: p };
});

route('DELETE', '/api/personen/([a-zA-Z0-9_-]+)/foto', 'admin', (ctx, m) => {
  const p = store.byId.get(m[1]);
  if (!p) throw new HttpError(404, 'Person nicht gefunden');
  try { fs.unlinkSync(store.photoPath(p.id)); } catch {}
  p.hasPhoto = false; p.updatedAt = new Date().toISOString(); store.save();
  store.log({ who: 'Admin', action: 'Foto entfernt', personId: p.id, name: displayName(p) });
  return { person: p };
});

route('GET', '/api/protokoll', 'admin', () => store.readLog(500));

route('GET', '/api/export\\.json', 'admin', (ctx) => {
  const stamp = new Date().toISOString().slice(0, 10);
  ctx.raw(200, JSON.stringify(Object.assign({}, store.doc, { exportedAt: new Date().toISOString() }), null, 1),
    { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="stammbaum-${stamp}.json"` });
});

route('GET', '/api/export\\.csv', 'admin', (ctx) => {
  const cols = [['code', 'Kennung'], ['kind', 'Art'], ['firstName', 'Vorname'], ['lastName', 'Nachname'], ['birthName', 'Geburtsname'],
    ['sex', 'Geschlecht'], ['birth', 'Geburtsdatum'], ['birthPlace', 'Geburtsort'], ['marriage', 'Heirat'], ['death', 'Gestorben'],
    ['deathPlace', 'Sterbeort'], ['street', 'Straße'], ['zip', 'PLZ'], ['city', 'Wohnort'], ['rel', 'Bezug'], ['notes', 'Notizen']];
  const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [cols.map(c => c[1]).join(';')];
  for (const p of store.doc.persons) {
    const rel = p.kind === 'origin' ? ROLE_TXT[p.role] + ' von ' + displayName(store.byId.get(p.originOf) || {})
      : p.kind === 'partner' ? 'Partner/in von ' + displayName(store.byId.get(p.partnerOf) || {}) + (p.divorced ? ' (geschieden)' : '')
      : p.parentId ? 'Kind von ' + displayName(store.byId.get(p.parentId) || {}) : 'Stammvater/-mutter';
    rows.push(cols.map(([k]) => esc(k === 'rel' ? rel : k === 'kind' ? ({ partner: 'Partner', origin: 'Partnerfamilie' })[p.kind] || 'Familie' : p[k])).join(';'));
  }
  ctx.raw(200, '﻿' + rows.join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stammbaum-${new Date().toISOString().slice(0, 10)}.csv"` });
});

route('POST', '/api/import', 'admin', (ctx) => {
  const r = importAny((ctx.body || {}).data);
  const errs = validateGraph(r.persons);
  if (errs.length) throw new HttpError(400, 'Datei fehlerhaft: ' + errs.slice(0, 5).join(' · '));
  if (!r.persons.length) throw new HttpError(400, 'Datei enthält keine Personen');
  const now = new Date().toISOString();
  r.persons.forEach(p => { p.updatedAt = p.updatedAt || now; p.hasPhoto = fs.existsSync(store.photoPath(p.id)); });
  store.replaceAll(r.persons, r.title, r.sources);
  store.log({ who: 'Admin', action: 'Import', name: `${r.persons.length} Personen eingelesen` });
  return { ok: true, count: r.persons.length, notes: r.notes };
});

route('GET', '/healthz', null, () => ({ ok: true, version: APP_VERSION, commit: GIT_SHA || undefined }));

// Kalender-Abo (Token statt Login, damit Handy-Kalender ihn abrufen können)
route('GET', '/kalender/([A-Za-z0-9_-]+)/geburtstage\\.ics', null, (ctx, m) => {
  if (m[1].length !== ICS_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(ICS_TOKEN))) throw new HttpError(404, 'Nicht gefunden');
  ctx.raw(200, birthdayCalendar(store.doc.persons, SITE_TITLE || store.doc.title), { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=3600' });
});

// ---------- Statische Dateien ----------
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Nicht gefunden');
  const ext = path.extname(file);
  const cache = ext === '.html' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache }, SEC_HEADERS));
  fs.createReadStream(file).pipe(res);
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cookies = parseCookies(req);
  const role = readToken(cookies.stb);
  const extraHeaders = {};
  const ctx = {
    req, role,
    setCookie(name, val, days) {
      extraHeaders['Set-Cookie'] = `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(days * 86400)}${COOKIE_SECURE ? '; Secure' : ''}`;
    },
    raw(status, body, headers) { ctx.done = true; send(res, status, body, Object.assign({}, headers, extraHeaders)); },
  };
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/kalender/') || url.pathname === '/healthz';
  if (!isApi) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Nicht erlaubt');
    return serveStatic(req, res, url.pathname);
  }
  try {
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Unbekannte Adresse');
    if (r.role === 'family' && !role) throw new HttpError(401, 'Bitte anmelden');
    if (r.role === 'admin' && role !== 'admin') throw new HttpError(role ? 403 : 401, 'Nur für Administratoren');
    // Schutz gegen fremde Seiten: schreibende Anfragen nur mit eigenem Origin
    if (req.method !== 'GET' && req.headers.origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (new URL(req.headers.origin).host !== host) throw new HttpError(403, 'Fremde Herkunft');
    }
    // Angemeldete dürfen größere Dateien (Quellen) senden, Anmeldeseite nur kleine Anfragen
    ctx.body = await readBody(req, role ? 22 * 1024 * 1024 : 64 * 1024);
    const out = await r.fn(ctx, url.pathname.match(r.re));
    if (!ctx.done) send(res, 200, out, extraHeaders);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Interner Fehler' : e.message }, extraHeaders);
  }
});

server.listen(PORT, () => {
  console.log(`Stammbaum v${APP_VERSION}${GIT_SHA ? ' (' + GIT_SHA + ')' : ''} läuft auf Port ${PORT} · ${store.doc.persons.length} Personen · Daten in ${DATA_DIR}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
