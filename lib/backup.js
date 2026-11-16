'use strict';
// Komplettsicherung als .tar.gz und Übertragung zu Ordner, WebDAV oder S3 – ohne externe Abhängigkeiten
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const INCLUDE_FILES = ['stammbaum.json', 'vorschlaege.json', 'protokoll.jsonl', 'einstellungen.json', 'orte.json', '.secret'];
const INCLUDE_DIRS = ['fotos', 'quellen', 'fotos-vorschlaege'];

// ---------- tar (ustar) ----------
function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512, 0);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); name = name.slice(i + 1); }
  const put = (str, off, len) => h.write(str, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
  put(oct(size, 12), 124, 12); put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8); put('0', 156, 1); put('ustar\0', 257, 6); put('00', 263, 2);
  put('stammbaum', 265, 32); put('stammbaum', 297, 32); put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

function listFiles(dataDir) {
  const out = [];
  for (const f of INCLUDE_FILES) { const p = path.join(dataDir, f); if (fs.existsSync(p)) out.push(f); }
  for (const d of INCLUDE_DIRS) {
    const dir = path.join(dataDir, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).isFile()) out.push(`${d}/${f}`);
  }
  return out;
}

async function* tarChunks(dataDir) {
  for (const rel of listFiles(dataDir)) {
    const full = path.join(dataDir, rel);
    const st = fs.statSync(full);
    const buf = fs.readFileSync(full);
    yield tarHeader('stammbaum-daten/' + rel, buf.length, st.mtimeMs);
    yield buf;
    const padLen = (512 - (buf.length % 512)) % 512;
    if (padLen) yield Buffer.alloc(padLen, 0);
  }
  yield Buffer.alloc(1024, 0);
}

// Schreibt das Archiv in eine Datei, gibt Pfad und Größe zurück
async function createArchive(dataDir, targetFile) {
  await pipeline(Readable.from(tarChunks(dataDir)), zlib.createGzip({ level: 6 }), fs.createWriteStream(targetFile));
  return { file: targetFile, size: fs.statSync(targetFile).size };
}

const archiveName = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `stammbaum-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.tar.gz`;
};
const isArchive = (n) => /^stammbaum-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz$/.test(n);

// ---------- Ziele ----------
async function toFolder(cfg, file, name, keep) {
  const dir = cfg.pfad;
  if (!dir) throw new Error('Kein Zielordner eingestellt');
  if (!fs.existsSync(dir)) throw new Error(`Zielordner ${dir} existiert nicht (im Container eingebunden?)`);
  fs.copyFileSync(file, path.join(dir, name));
  const old = fs.readdirSync(dir).filter(isArchive).sort();
  while (old.length > keep) fs.unlinkSync(path.join(dir, old.shift()));
}

function bodyStream(file) { return Readable.toWeb(fs.createReadStream(file)); }

async function toWebdav(cfg, file, name, keep) {
  if (!cfg.url) throw new Error('Keine WebDAV-Adresse eingestellt');
  const base = cfg.url.replace(/\/?$/, '/');
  const auth = cfg.benutzer ? { Authorization: 'Basic ' + Buffer.from(`${cfg.benutzer}:${cfg.passwort || ''}`).toString('base64') } : {};
  await fetch(base, { method: 'MKCOL', headers: auth, signal: AbortSignal.timeout(20000) }).catch(() => {});
  const size = fs.statSync(file).size;
  const r = await fetch(base + name, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/gzip', 'Content-Length': String(size) }, body: bodyStream(file), duplex: 'half', signal: AbortSignal.timeout(30 * 60e3) });
  if (!r.ok) throw new Error(`WebDAV-Upload: ${r.status} ${r.statusText}`);
  // Alte Sicherungen aufräumen
  const list = await fetch(base, { method: 'PROPFIND', headers: { ...auth, Depth: '1' }, signal: AbortSignal.timeout(20000) });
  if (list.ok) {
    const xml = await list.text();
    const names = [...xml.matchAll(/<[^>]*href>([^<]+)<\/[^>]*href>/gi)].map(m => decodeURIComponent(m[1]).split('/').filter(Boolean).pop()).filter(isArchive).sort();
    while (names.length > keep) {
      const n = names.shift();
      await fetch(base + encodeURIComponent(n), { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(20000) }).catch(() => {});
    }
  }
}

// S3 (AWS Signature V4) – funktioniert mit AWS, MinIO, Backblaze B2, Wasabi, Hetzner Object Storage …
function s3Request(cfg, method, key, { query = {}, headers = {}, body, size } = {}) {
  const ep = new URL(/^https?:\/\//.test(cfg.endpoint || '') ? cfg.endpoint : `https://${cfg.endpoint || `s3.${cfg.region}.amazonaws.com`}`);
  const host = cfg.pathStyle ? ep.host : `${cfg.bucket}.${ep.host}`;
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const uriPath = (cfg.pathStyle ? `/${cfg.bucket}` : '') + '/' + key.split('/').map(enc).join('/');
  const qs = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join('&');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payload = body ? 'UNSIGNED-PAYLOAD' : crypto.createHash('sha256').update('').digest('hex');
  const h = Object.assign({ host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate }, headers);
  const names = Object.keys(h).map(k => k.toLowerCase()).sort();
  const canon = [method, uriPath, qs, names.map(n => `${n}:${String(h[Object.keys(h).find(k => k.toLowerCase() === n)]).trim()}`).join('\n') + '\n', names.join(';'), payload].join('\n');
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canon).digest('hex')].join('\n');
  let k = crypto.createHmac('sha256', 'AWS4' + cfg.secretKey).update(day).digest();
  for (const part of [cfg.region, 's3', 'aws4_request']) k = crypto.createHmac('sha256', k).update(part).digest();
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  h.Authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
  delete h.host;
  if (size !== undefined) h['Content-Length'] = String(size);
  const url = `${ep.protocol}//${host}${uriPath}${qs ? '?' + qs : ''}`;
  return fetch(url, { method, headers: h, body, duplex: body ? 'half' : undefined, signal: AbortSignal.timeout(30 * 60e3) });
}

async function toS3(cfg, file, name, keep) {
  if (!cfg.bucket || !cfg.accessKey || !cfg.secretKey) throw new Error('S3: Bucket und Zugangsdaten fehlen');
  const prefix = (cfg.praefix || '').replace(/^\//, '');
  const size = fs.statSync(file).size;
  const r = await s3Request(cfg, 'PUT', prefix + name, { headers: { 'content-type': 'application/gzip' }, body: bodyStream(file), size });
  if (!r.ok) throw new Error(`S3-Upload: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const l = await s3Request(cfg, 'GET', '', { query: { 'list-type': '2', prefix } });
  if (l.ok) {
    const keys = [...(await l.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]).filter(kk => isArchive(kk.split('/').pop())).sort();
    while (keys.length > keep) await s3Request(cfg, 'DELETE', keys.shift()).catch(() => {});
  }
}

async function runBackup(dataDir, cfg) {
  const tmpDir = path.join(dataDir, 'backups');
  fs.mkdirSync(tmpDir, { recursive: true });
  const name = archiveName();
  const tmp = path.join(tmpDir, '.' + name + '.tmp');
  try {
    const { size } = await createArchive(dataDir, tmp);
    const keep = Math.max(1, Number(cfg.behalten) || 30);
    if (cfg.ziel === 'webdav') await toWebdav(cfg.webdav, tmp, name, keep);
    else if (cfg.ziel === 's3') await toS3(cfg.s3, tmp, name, keep);
    else await toFolder(cfg.ordner, tmp, name, keep);
    return { name, size };
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

module.exports = { createArchive, runBackup, archiveName, listFiles, s3Request };
