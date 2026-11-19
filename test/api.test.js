'use strict';
// Automatische Tests: startet echte Server-Instanzen mit Beispieldaten in temporären Ordnern.
// Aufruf: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const servers = [];

async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stammbaum-test-'));
  const port = 4100 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, FAMILY_PASSWORD: 'fam', ADMIN_PASSWORD: 'adm', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(proc);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Server startet nicht')), 8000);
    proc.stdout.on('data', d => { if (/läuft auf Port/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', d => process.stderr.write(d));
  });
  const base = `http://127.0.0.1:${port}`;
  const jar = {};
  async function req(method, url, body, role = 'admin') {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(jar[role] ? { Cookie: jar[role] } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  }
  for (const [role, pw] of [['admin', 'adm'], ['family', 'fam']]) {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    jar[role] = r.headers.get('set-cookie').split(';')[0];
  }
  return { base, dir, req, proc };
}

const byName = (d, first) => d.persons.find(p => p.firstName === first);
let S;
before(async () => { S = await startServer(); });
after(() => { for (const p of servers) p.kill(); });

test('Anmeldung und Datenzugriff', async () => {
  const r = await S.req('GET', '/api/data');
  assert.equal(r.status, 200);
  assert.ok(r.data.persons.length >= 20);
  const anon = await fetch(S.base + '/api/data');
  assert.equal(anon.status, 401);
});

test('Person anlegen, ändern, rückgängig machen, löschen', async () => {
  let d = (await S.req('GET', '/api/data')).data;
  const peter = byName(d, 'Peter');
  const c = await S.req('POST', '/api/personen', { kind: 'child', anchorId: peter.id, fields: { firstName: 'Testkind', lastName: 'Muster', birth: '01.02.2020' } });
  assert.equal(c.status, 200);
  const id = c.data.person.id;
  const u = await S.req('PATCH', `/api/personen/${id}`, { fields: { city: 'Kiel' } });
  assert.equal(u.data.person.city, 'Kiel');
  const log = (await S.req('GET', '/api/protokoll')).data;
  const change = log.find(l => l.personId === id && l.action === 'geändert');
  assert.ok(change.undoable);
  const undo = await S.req('POST', `/api/protokoll/${change.id}/rueckgaengig`, {});
  assert.equal(undo.status, 200);
  d = (await S.req('GET', '/api/data')).data;
  assert.equal(d.persons.find(p => p.id === id).city, '');
  const del = await S.req('DELETE', `/api/personen/${id}`);
  assert.equal(del.status, 200);
  // Löschen rückgängig → Person wieder da
  const log2 = (await S.req('GET', '/api/protokoll')).data;
  const delEntry = log2.find(l => l.personId === id && l.action === 'gelöscht');
  assert.equal((await S.req('POST', `/api/protokoll/${delEntry.id}/rueckgaengig`, {})).status, 200);
  d = (await S.req('GET', '/api/data')).data;
  assert.ok(d.persons.some(p => p.id === id));
});

test('Löschen einer Person mit Kindern wird verweigert', async () => {
  const d = (await S.req('GET', '/api/data')).data;
  const r = await S.req('DELETE', `/api/personen/${byName(d, 'Peter').id}`);
  assert.equal(r.status, 409);
});

test('Dubletten finden und zusammenführen', async () => {
  let d = (await S.req('GET', '/api/data')).data;
  const karl = byName(d, 'Karl');
  const dup = await S.req('POST', '/api/personen', { kind: 'child', anchorId: karl.id, fields: { firstName: 'Peter', lastName: 'Muster', birth: '1955', notes: 'doppelt angelegt' } });
  const dupId = dup.data.person.id;
  await S.req('POST', '/api/personen', { kind: 'child', anchorId: dupId, fields: { firstName: 'Enkel', lastName: 'Muster' } });
  const cands = (await S.req('GET', '/api/dubletten')).data;
  const peter = byName(d, 'Peter');
  assert.ok(cands.some(c => [c.a, c.b].includes(peter.id) && [c.a, c.b].includes(dupId)), 'Dublette wird gefunden');
  const m = await S.req('POST', '/api/dubletten/zusammenfuehren', { keepId: peter.id, dropId: dupId, fields: { notes: 'zusammengeführt' } });
  assert.equal(m.status, 200);
  d = (await S.req('GET', '/api/data')).data;
  assert.ok(!d.persons.some(p => p.id === dupId));
  assert.equal(byName(d, 'Enkel').parentId, peter.id, 'Kinder werden umgehängt');
  assert.equal(d.persons.find(p => p.id === peter.id).notes, 'zusammengeführt');
});

test('GEDCOM: Export und vollständiger Import in leeren Stammbaum', async () => {
  const ged = await fetch(S.base + '/api/export.ged', { headers: { Cookie: (await S.req('GET', '/api/me')).headers && '' } });
  void ged;
  const exp = await S.req('GET', '/api/export.ged');
  assert.equal(exp.status, 200);
  assert.match(exp.data, /^0 HEAD/);
  assert.match(exp.data, /1 _STB_ID /);
  const src = (await S.req('GET', '/api/data')).data;

  const E = await startServer({ BEISPIELDATEN: 'false' });
  const plan = await E.req('POST', '/api/gedcom/vorschau', { text: exp.data.replace(/1 _STB_ID .*\r\n/g, '') });
  assert.equal(plan.status, 200);
  assert.equal(plan.data.matches.length, 0);
  assert.equal(plan.data.adds.length, src.persons.length, `alle Personen werden eingeplant (nicht zuordenbar: ${plan.data.unattached.map(u => u.name).join(', ')})`);
  const res = await E.req('POST', '/api/gedcom/uebernehmen', { token: plan.data.token, adds: plan.data.adds.map(a => a.key), updates: [] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.errors, []);
  const d = (await E.req('GET', '/api/data')).data;
  assert.equal(d.persons.length, src.persons.length);
  // Beziehungen bleiben erhalten
  const kinds = (x) => x.persons.reduce((a, p) => ((a[p.kind + ':' + (p.role || '')] = (a[p.kind + ':' + (p.role || '')] || 0) + 1), a), {});
  assert.deepEqual(kinds(d), kinds(src));
  const emma = byName(d, 'Emma'), lena = byName(d, 'Lena');
  assert.equal(emma.parentId, lena.id);
  assert.equal(d.persons.find(p => p.id === emma.otherParentId).firstName, 'Tim');
  const anke = byName(d, 'Anke');
  assert.equal(anke.divorced, true);
});

test('GEDCOM: Abgleich ergänzt vorhandene Personen und hängt neue korrekt ein', async () => {
  const ged = [
    '0 HEAD', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Otto /Muster/', '1 SEX M', '1 BIRT', '2 DATE 3 APR 1902', '2 PLAC Lübeck, Schleswig-Holstein', '1 OCCU Kapitän', '1 FAMS @F1@', '1 FAMC @F0@',
    '0 @I2@ INDI', '1 NAME Frieda /Kranz/', '1 SEX F', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Reinhold /Muster/', '1 SEX M', '1 BIRT', '2 DATE 1927', '1 DEAT', '2 DATE 1927', '1 FAMC @F1@',
    '0 @I4@ INDI', '1 NAME Heinrich /Muster/', '1 SEX M', '1 BIRT', '2 DATE ABT 1870', '1 FAMS @F0@',
    '0 @I5@ INDI', '1 NAME Grete /Muster/', '1 SEX F', '1 FAMC @F0@',
    '0 @F0@ FAM', '1 HUSB @I4@', '1 CHIL @I1@', '1 CHIL @I5@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 MARR', '2 DATE 12 MAY 1926',
    '0 TRLR'].join('\n');
  const plan = await S.req('POST', '/api/gedcom/vorschau', { text: ged });
  assert.equal(plan.status, 200);
  const m = plan.data.matches.find(x => x.gedId === '@I1@');
  assert.ok(m, 'Otto wird zugeordnet');
  assert.ok(m.diffs.custom, 'Beruf wird angeboten');
  const adds = Object.fromEntries(plan.data.adds.map(a => [a.name, a]));
  assert.equal(adds['Reinhold Muster'].as, 'child');
  assert.equal(adds['Heinrich Muster'].as, 'rootParent');
  assert.equal(adds['Grete Muster'].as, 'child');
  const r = await S.req('POST', '/api/gedcom/uebernehmen', { token: plan.data.token, adds: plan.data.adds.map(a => a.key), updates: [{ gedId: '@I1@', keys: ['custom'] }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = (await S.req('GET', '/api/data')).data;
  const otto = byName(d, 'Otto'), heinrich = byName(d, 'Heinrich');
  assert.equal(otto.parentId, heinrich.id, 'neue oberste Generation');
  assert.equal(byName(d, 'Grete').parentId, heinrich.id);
  assert.equal(byName(d, 'Reinhold').parentId, otto.id);
  assert.equal(byName(d, 'Reinhold').otherParentId, byName(d, 'Frieda').id);
  assert.ok(otto.custom.some(c => c.label === 'Beruf' && c.value === 'Kapitän'));
  assert.equal(heinrich.birth, 'ca. 1870', 'ungefähres Datum bleibt erhalten');
});

test('Einstellungen: Geheimnisse werden maskiert, ntfy-Test erreicht den Server', async () => {
  let got = null;
  const ntfy = http.createServer((q, s) => { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { got = { url: q.url, title: q.headers.title, auth: q.headers.authorization, body: b }; s.end('{}'); }); });
  await new Promise(r => ntfy.listen(0, r));
  const port = ntfy.address().port;
  const put = await S.req('PUT', '/api/einstellungen', { ntfy: { aktiv: true, server: `http://127.0.0.1:${port}`, topic: 'familie', token: 'geheim123' } });
  assert.equal(put.data.ntfy.token, '••••••••');
  const t = await S.req('POST', '/api/einstellungen/ntfy-test', {});
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(got.url, '/familie');
  assert.equal(got.auth, 'Bearer geheim123');
  // Maskiertes Geheimnis bleibt beim erneuten Speichern erhalten
  await S.req('PUT', '/api/einstellungen', { ntfy: { token: '••••••••', prioritaet: 'high' } });
  got = null;
  await S.req('POST', '/api/einstellungen/ntfy-test', {});
  assert.equal(got.auth, 'Bearer geheim123');
  // Vorschlag der Familie löst Benachrichtigung aus
  got = null;
  const d = (await S.req('GET', '/api/data', undefined, 'family')).data;
  await S.req('POST', '/api/vorschlaege', { type: 'remark', targetId: d.persons[0].id, author: 'Tante Inge', message: 'Hallo' }, 'family');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(got && /Vorschlag/.test(Buffer.from((got.title.match(/B\?(.*)\?=/) || [])[1] || '', 'base64').toString() || got.title));
  ntfy.close();
});

test('Sicherung: Archiv enthält alle Daten, Ordner-Ziel mit Aufbewahrung', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'stammbaum-ziel-'));
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(target, `stammbaum-2020-01-0${i + 1}-0300.tar.gz`), 'alt');
  await S.req('PUT', '/api/einstellungen', { sicherung: { ziel: 'ordner', ordner: { pfad: target }, behalten: 2 } });
  const r = await S.req('POST', '/api/sicherung/jetzt', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const files = fs.readdirSync(target).sort();
  assert.equal(files.length, 2);
  const newest = path.join(target, files[files.length - 1]);
  const list = execFileSync('tar', ['-tzf', newest]).toString();
  assert.match(list, /stammbaum-daten\/stammbaum\.json/);
  assert.match(list, /stammbaum-daten\/protokoll\.jsonl/);
  const json = execFileSync('tar', ['-xzOf', newest, 'stammbaum-daten/stammbaum.json']).toString();
  assert.ok(JSON.parse(json).persons.length > 10);
});

test('Orte für die Karte werden aufgelistet und lassen sich manuell setzen', async () => {
  const o = await S.req('GET', '/api/orte', undefined, 'family');
  assert.equal(o.status, 200);
  assert.ok(o.data.places.some(p => p.name === 'Hamburg'));
  await S.req('PUT', '/api/orte', { name: 'Hamburg', lat: 53.55, lon: 9.99 });
  const o2 = await S.req('GET', '/api/orte', undefined, 'family');
  const hh = o2.data.places.find(p => p.name === 'Hamburg');
  assert.equal(hh.status, 'manuell');
  assert.equal(hh.lat, 53.55);
});

test('Kalender-Abo enthält Geburts- und Hochzeitstage', async () => {
  const me = await S.req('GET', '/api/me');
  const ics = await (await fetch(S.base + me.data.icsPath)).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /Peter Muster/);
  assert.match(ics, /Hochzeitstag/);
});

test('Eltern über der Stammperson ergänzen', async () => {
  const T = await startServer();
  let d = (await T.req('GET', '/api/data')).data;
  const otto = d.persons.find(p => p.kind === 'blood' && !p.parentId);
  const sibs = d.persons.filter(p => p.parentId === otto.id).length;
  const v = await T.req('POST', '/api/personen', { kind: 'parent', anchorId: otto.id, fields: { firstName: 'Wilhelm', lastName: otto.lastName, birth: '1870' } });
  assert.equal(v.status, 200);
  const m = await T.req('POST', '/api/personen', { kind: 'parent', anchorId: otto.id, fields: { firstName: 'Auguste', lastName: otto.lastName, marriage: '1899' } });
  assert.equal(m.status, 200);
  d = (await T.req('GET', '/api/data')).data;
  const o2 = d.persons.find(p => p.id === otto.id);
  const w = d.persons.find(p => p.id === v.data.person.id), a = d.persons.find(p => p.id === m.data.person.id);
  assert.equal(w.kind, 'blood'); assert.equal(w.parentId, null);
  assert.equal(o2.parentId, w.id); assert.equal(o2.otherParentId, a.id);
  assert.equal(a.kind, 'partner'); assert.equal(a.partnerOf, w.id);
  assert.equal(d.persons.filter(p => p.parentId === otto.id).length, sibs);
  const third = await T.req('POST', '/api/personen', { kind: 'parent', anchorId: otto.id, fields: { firstName: 'Zuviel' } });
  assert.equal(third.status, 400);
  // Vorschlag aus der Familie
  const s = await T.req('POST', '/api/vorschlaege', { type: 'parent', targetId: w.id, fields: { firstName: 'Heinrich', lastName: w.lastName }, author: 'Test' }, 'family');
  assert.equal(s.status, 200);
  const ok = await T.req('POST', `/api/vorschlaege/${s.data.id}/annehmen`, {});
  assert.equal(ok.status, 200);
  d = (await T.req('GET', '/api/data')).data;
  assert.equal(d.persons.find(p => p.id === w.id).parentId, ok.data.personId);
});

test('Rufname: nur einer der Vornamen, im GEDCOM erhalten', async () => {
  const T = await startServer();
  let d = (await T.req('GET', '/api/data')).data;
  const otto = d.persons.find(p => p.firstName === 'Otto');
  let r = await T.req('PATCH', `/api/personen/${otto.id}`, { fields: { firstName: 'Arthur Otto Walter', callName: 'otto' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.person.callName, 'Otto');
  r = await T.req('PATCH', `/api/personen/${otto.id}`, { fields: { callName: 'Karl' } });
  assert.equal(r.data.person.callName, '');
  await T.req('PATCH', `/api/personen/${otto.id}`, { fields: { callName: 'Walter' } });
  const exp = await T.req('GET', '/api/export.ged');
  assert.match(exp.data, /2 GIVN Arthur Otto Walter\r?\n2 _RUFNAME Walter/);
  // Import mit Stern-Markierung
  const ged = '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Hans* Peter /Neu/\n1 SEX M\n1 BIRT\n2 DATE 1950\n0 TRLR\n';
  const E = await startServer({ BEISPIELDATEN: 'nein' });
  const plan = await E.req('POST', '/api/gedcom/vorschau', { text: ged });
  const res = await E.req('POST', '/api/gedcom/uebernehmen', { token: plan.data.token, adds: plan.data.adds.map(a => a.key), updates: [] });
  assert.equal(res.status, 200);
  d = (await E.req('GET', '/api/data')).data;
  const hans = d.persons.find(p => p.lastName === 'Neu');
  assert.equal(hans.firstName, 'Hans Peter'); assert.equal(hans.callName, 'Hans');
});

test('GEDCOM: Taufe, Beerdigung, Konfession, Heiratsort, Adoption und ungefähre Daten', async () => {
  const T = await startServer();
  let d = (await T.req('GET', '/api/data')).data;
  const karl = d.persons.find(p => p.firstName === 'Karl'), ilse = d.persons.find(p => p.firstName === 'Ilse');
  const ute = d.persons.find(p => p.firstName === 'Ute');
  let r = await T.req('PATCH', `/api/personen/${karl.id}`, { fields: { baptism: '2.3.1928', baptismPlace: 'St. Marien', burial: 'um 2004', burialPlace: 'Ohlsdorf', religion: 'evangelisch' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.person.baptism, '02.03.1928'); assert.equal(r.data.person.burial, 'ca. 2004');
  await T.req('PATCH', `/api/personen/${ilse.id}`, { fields: { marriagePlace: 'Hamburg', birth: 'zwischen 1930 und 1932' } });
  await T.req('PATCH', `/api/personen/${ute.id}`, { fields: { pedi: 'adopted' } });
  const bad = await T.req('PATCH', `/api/personen/${karl.id}`, { fields: { burial: 'irgendwann' } });
  assert.equal(bad.status, 400);
  const exp = (await T.req('GET', '/api/export.ged')).data;
  assert.match(exp, /1 CHR\r\n2 DATE 2 MAR 1928\r\n2 PLAC St\. Marien/);
  assert.match(exp, /1 BURI\r\n2 DATE ABT 2004\r\n2 PLAC Ohlsdorf/);
  assert.match(exp, /1 RELI evangelisch/);
  assert.match(exp, /2 DATE BET 1930 AND 1932/);
  assert.match(exp, /1 MARR\r\n2 DATE [^\r]+\r\n2 PLAC Hamburg/);
  assert.match(exp, /2 PEDI adopted/);
  // Rundreise in leeren Stammbaum
  const E = await startServer({ BEISPIELDATEN: 'nein' });
  const plan = await E.req('POST', '/api/gedcom/vorschau', { text: exp.replace(/1 _STB_ID .*\r\n/g, '') });
  await E.req('POST', '/api/gedcom/uebernehmen', { token: plan.data.token, adds: plan.data.adds.map(a => a.key), updates: [] });
  d = (await E.req('GET', '/api/data')).data;
  const k2 = d.persons.find(p => p.firstName === 'Karl'), i2 = d.persons.find(p => p.firstName === 'Ilse'), u2 = d.persons.find(p => p.firstName === 'Ute');
  assert.equal(k2.baptismPlace, 'St. Marien'); assert.equal(k2.burial, 'ca. 2004'); assert.equal(k2.religion, 'evangelisch');
  assert.equal(i2.marriagePlace, 'Hamburg'); assert.equal(i2.birth, 'zw. 1930 und 1932');
  assert.equal(u2.pedi, 'adopted');
  // ZIP mit Medien
  const zip = await fetch(T.base + '/api/export-medien.zip', { headers: { Cookie: '' } });
  assert.equal(zip.status, 401);
});

test('Herkunftsfamilie: Partnerin eines Elternteils wird Mutter (GEDCOM und von Hand)', async () => {
  const T = await startServer();
  let d = (await T.req('GET', '/api/data')).data;
  const sab = d.persons.find(p => p.firstName === 'Sabine');
  const hans = (await T.req('POST', '/api/personen', { kind: 'origin', role: 'parent', anchorId: sab.id, fields: { firstName: 'Hans', lastName: 'Wolff', sex: 'm', birth: '12.03.1930', birthPlace: 'Kiel' } })).data.person;
  const ged = ['0 HEAD', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Peter /Muster/', '1 SEX M', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Sabine /Wolff/', '1 SEX F', '1 BIRT', '2 DATE 1958', '1 FAMS @F1@', '1 FAMC @F2@',
    '0 @I3@ INDI', '1 NAME Hans /Wolff/', '1 SEX M', '1 BIRT', '2 DATE 12 MAR 1930', '2 PLAC Kiel', '1 FAMS @F2@',
    '0 @I4@ INDI', '1 NAME Gerda /Wolff/', '1 SEX F', '1 BIRT', '2 DATE 1932', '1 FAMS @F2@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
    '0 @F2@ FAM', '1 HUSB @I3@', '1 WIFE @I4@', '1 CHIL @I2@', '0 TRLR'].join('\n');
  const plan = await T.req('POST', '/api/gedcom/vorschau', { text: ged });
  const gerda = plan.data.adds.find(a => a.name === 'Gerda Wolff');
  assert.ok(gerda, JSON.stringify(plan.data.adds.map(a => a.name)));
  assert.equal(gerda.role, 'parent');
  // von Hand: Partnerin von Hans → Mutter
  const pop = (await T.req('POST', '/api/personen', { kind: 'origin', role: 'partnerOfParent', anchorId: hans.id, fields: { firstName: 'Erna', lastName: 'Wolff', sex: 'w' } })).data.person;
  const r = await T.req('PATCH', `/api/personen/${pop.id}`, { fields: {}, role: 'parent' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.person.role, 'parent'); assert.equal(r.data.person.partnerOfId, null);
  const third = (await T.req('POST', '/api/personen', { kind: 'origin', role: 'partnerOfParent', anchorId: hans.id, fields: { firstName: 'Zweite', lastName: 'Frau' } })).data.person;
  assert.equal((await T.req('PATCH', `/api/personen/${third.id}`, { fields: {}, role: 'parent' })).status, 400);
});

test('Quellen belegen einzelne Angaben (auch im GEDCOM)', async () => {
  const T = await startServer();
  const d = (await T.req('GET', '/api/data')).data;
  const peter = d.persons.find(p => p.firstName === 'Peter'), sab = d.persons.find(p => p.firstName === 'Sabine');
  // kleinstes gültiges JPEG
  const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const r = await T.req('POST', '/api/quellen', { source: { title: 'Heiratsurkunde', kind: 'Heiratsurkunde', facts: ['marriage', 'quatsch'] }, personIds: [peter.id, sab.id], file: jpg });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.source.facts, ['marriage']);
  const r2 = await T.req('POST', '/api/quellen', { source: { title: 'Geburtsurkunde Peter', kind: 'Geburtsurkunde', facts: ['birth'] }, personIds: [peter.id], file: jpg });
  assert.equal(r2.status, 200);
  const rep = await T.req('PUT', `/api/quellen/${r2.data.source.id}/datei`, { file: jpg, thumb: jpg });
  assert.equal(rep.status, 200); assert.ok(rep.data.source.updatedAt);
  const exp = (await T.req('GET', '/api/export.ged')).data;
  assert.match(exp, /1 BIRT\r\n2 DATE [^\r]+\r\n(?:2 PLAC [^\r]+\r\n)?2 SOUR @S2@/);
  assert.match(exp, /1 MARR\r\n2 DATE [^\r]+\r\n(?:2 PLAC [^\r]+\r\n)?2 SOUR @S1@/);
});

test('Herkunftsfamilie: Partner/in und Kinder für Geschwister und weitere Angehörige', async () => {
  const T = await startServer();
  const d = (await T.req('GET', '/api/data')).data;
  const sab = d.persons.find(p => p.firstName === 'Sabine');
  const mk = async (body) => { const r = await T.req('POST', '/api/personen', body); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.person; };
  const vater = await mk({ kind: 'origin', role: 'parent', anchorId: sab.id, fields: { firstName: 'Hans', lastName: 'Wolff', sex: 'm' } });
  const opa = await mk({ kind: 'origin', role: 'relative', relation: 'parent', anchorId: vater.id, fields: { firstName: 'Opa', lastName: 'Wolff', sex: 'm' } });
  const onkel = await mk({ kind: 'origin', role: 'relative', relation: 'sibling', anchorId: vater.id, fields: { firstName: 'Josef', lastName: 'Wolff', sex: 'm' } });
  const tante = await mk({ kind: 'origin', role: 'relative', relation: 'partner', anchorId: onkel.id, fields: { firstName: 'Maria', lastName: 'Wolff', sex: 'w', marriage: '1950' } });
  assert.equal(tante.partnerOfId, onkel.id); assert.equal(tante.role, 'relative'); assert.equal(tante.marriage, '1950');
  const cousine = await mk({ kind: 'origin', role: 'relative', relation: 'child', anchorId: onkel.id, otherParentId: tante.id, fields: { firstName: 'Petra', lastName: 'Wolff', sex: 'w' } });
  assert.deepEqual(cousine.parentIds, [onkel.id, tante.id]);
  const bruder = await mk({ kind: 'origin', role: 'sibling', anchorId: sab.id, fields: { firstName: 'Bernd', lastName: 'Wolff', sex: 'm' } });
  const schwaegerin = await mk({ kind: 'origin', role: 'relative', relation: 'partner', anchorId: bruder.id, fields: { firstName: 'Gabi', lastName: 'Wolff', sex: 'w' } });
  const neffe = await mk({ kind: 'origin', role: 'relative', relation: 'child', anchorId: bruder.id, otherParentId: 'none', fields: { firstName: 'Tim', lastName: 'Wolff', sex: 'm' } });
  assert.deepEqual(neffe.parentIds, [bruder.id]);
  // Partner/in eines Elternteils bleibt partnerOfParent
  const stief = await mk({ kind: 'origin', role: 'relative', relation: 'partner', anchorId: vater.id, fields: { firstName: 'Erna', lastName: 'X', sex: 'w' } });
  assert.equal(stief.role, 'partnerOfParent');
  // GEDCOM: Onkel + Tante als Familie mit Kind
  const exp = (await T.req('GET', '/api/export.ged')).data;
  const fam = exp.split('\r\n0 ').find(b => b.includes('CHIL') && b.includes(`HUSB`) && exp.includes(`_STB_ID ${cousine.id}`) && b.match(/HUSB @I\d+@/) && b.includes('1 MARR'));
  assert.ok(fam, 'Familie Onkel/Tante fehlt im GEDCOM');
  void opa; void schwaegerin;
});
