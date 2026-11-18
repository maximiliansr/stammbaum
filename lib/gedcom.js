'use strict';
// GEDCOM 5.5.1 lesen und schreiben
const { buildGraph } = require('./graph');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_DE = { JAN: 1, FEB: 2, MAR: 3, MAE: 3, MÄR: 3, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };
const pad = (n) => String(n).padStart(2, '0');

// ---------- Lesen ----------
function decode(buf) {
  if (typeof buf === 'string') return buf.replace(/^﻿/, '');
  let text = buf.toString('utf8');
  if (/�/.test(text) && /^\s*0\s+HEAD/m.test(buf.toString('latin1'))) text = buf.toString('latin1');
  return text.replace(/^﻿/, '');
}

function parseLines(text) {
  const root = { children: [] };
  const stack = [root];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (!line) continue;
    const m = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(line);
    if (!m) continue;
    const level = Number(m[1]);
    const node = { level, xref: m[2] || null, tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };
    if (node.tag === 'CONC' || node.tag === 'CONT') {
      const parent = stack[Math.min(level, stack.length - 1)];
      if (parent) parent.value += (node.tag === 'CONT' ? '\n' : '') + node.value;
      continue;
    }
    while (stack.length > level + 1) stack.pop();
    const parent = stack[stack.length - 1] || root;
    parent.children.push(node);
    stack.push(node);
  }
  return root.children;
}

const first = (n, tag) => n.children.find(c => c.tag === tag);
const all = (n, tag) => n.children.filter(c => c.tag === tag);
const val = (n, path) => { let cur = n; for (const t of path.split('.')) { cur = cur && first(cur, t); } return cur ? cur.value.trim() : ''; };

// GEDCOM-Datum → TT.MM.JJJJ / MM.JJJJ / JJJJ
function dateFromGed(s) {
  s = String(s || '').trim().toUpperCase().replace(/@#D[A-Z ]+@\s*/, '');
  if (!s || s.startsWith('(')) return '';
  const approx = /^(ABT|CAL|EST|BEF|AFT|FROM|TO|BET|INT|ABOUT|CA\.?|UM|VOR|NACH)\b/.test(s);
  const m = /(?:(\d{1,2})\s+)?([A-ZÄ]{3,4})?\s*(\d{3,4})(?:\/\d+)?/.exec(s.replace(/^(ABT|CAL|EST|BEF|AFT|FROM|TO|BET|INT)\s+/, ''));
  if (!m) return '';
  const y = m[3].padStart(4, '0');
  if (approx) return y;
  const mon = m[2] ? MONTHS_DE[m[2]] : null;
  if (m[1] && mon) return `${pad(m[1])}.${pad(mon)}.${y}`;
  if (mon) return `${pad(mon)}.${y}`;
  return y;
}
function placeFromGed(s) { return String(s || '').split(',')[0].trim(); }

function parseGedcom(input) {
  const recs = parseLines(decode(input));
  const indi = new Map(), fam = new Map(), notes = new Map();
  for (const r of recs) if (r.tag === 'NOTE' && r.xref) notes.set(r.xref, r.value);
  const noteText = (n) => (/^@.+@$/.test(n.value.trim()) ? notes.get(n.value.trim()) || '' : n.value);
  for (const r of recs) {
    if (r.tag === 'INDI' && r.xref) {
      const names = all(r, 'NAME');
      const main = names.find(n => !/married|aka/i.test(val(n, 'TYPE'))) || names[0];
      const married = names.find(n => /married/i.test(val(n, 'TYPE')));
      const split = (n) => {
        if (!n) return { given: '', surname: '' };
        const mm = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(n.value || '');
        return { given: (val(n, 'GIVN') || (mm ? mm[1] : n.value)).trim().replace(/\s+/g, ' '), surname: (val(n, 'SURN') || (mm ? mm[2] : '')).trim() };
      };
      const nm = split(main);
      let callName = val(main || r, '_RUFNAME') || val(main || r, '_CALLNAME') || val(r, '_RUFNAME');
      const star = /(\S+)\*/.exec(nm.given);
      if (star) { callName = callName || star[1]; nm.given = nm.given.replace(/\*/g, ''); }
      const marriedName = married ? split(married).surname : val(main || r, '_MARNM');
      const ev = (tag) => { const e = first(r, tag); return e ? { date: dateFromGed(val(e, 'DATE')), place: placeFromGed(val(e, 'PLAC')), present: true, flag: e.value.trim() } : null; };
      const birt = ev('BIRT') || ev('CHR') || ev('BAPM'), deat = ev('DEAT') || ev('BURI');
      const resi = all(r, 'RESI').pop();
      const occu = all(r, 'OCCU').map(o => o.value.trim()).filter(Boolean);
      const sex = (val(r, 'SEX') || '').toUpperCase();
      indi.set(r.xref, {
        id: r.xref, given: nm.given, callName: (callName || '').trim(), surname: nm.surname, marriedName: marriedName || '',
        sex: sex === 'M' ? 'm' : sex === 'F' ? 'w' : '',
        birth: birt ? birt.date : '', birthPlace: birt ? birt.place : '',
        death: deat ? (deat.date || (deat.present ? 'verstorben' : '')) : '', deathPlace: deat ? deat.place : '',
        city: resi ? placeFromGed(val(resi, 'PLAC') || val(resi, 'ADDR.CITY') || val(resi, 'ADDR')) : '',
        street: resi ? val(resi, 'ADDR.ADR1') : '', zip: resi ? val(resi, 'ADDR.POST') : '',
        occupation: occu.join(', '), notes: all(r, 'NOTE').map(noteText).filter(Boolean).join('\n\n'),
        stbId: val(r, '_STB_ID'), famc: all(r, 'FAMC').map(x => x.value.trim()), fams: all(r, 'FAMS').map(x => x.value.trim()),
      });
    }
    if (r.tag === 'FAM' && r.xref) {
      const marr = first(r, 'MARR');
      fam.set(r.xref, {
        id: r.xref, husb: val(r, 'HUSB'), wife: val(r, 'WIFE'), chil: all(r, 'CHIL').map(c => c.value.trim()),
        marriage: marr ? dateFromGed(val(marr, 'DATE')) : '', divorced: !!first(r, 'DIV'),
      });
    }
  }
  // Fehlende Querverweise ergänzen
  for (const f of fam.values()) {
    for (const s of [f.husb, f.wife]) { const i = indi.get(s); if (i && !i.fams.includes(f.id)) i.fams.push(f.id); }
    for (const c of f.chil) { const i = indi.get(c); if (i && !i.famc.includes(f.id)) i.famc.push(f.id); }
  }
  const head = recs.find(r => r.tag === 'HEAD');
  return { indi, fam, source: head ? val(head, 'SOUR.NAME') || val(head, 'SOUR') : '' };
}

// GEDCOM-Person → Felder des Stammbaums
function fieldsFromIndi(i) {
  const custom = [];
  if (i.occupation) custom.push({ label: 'Beruf', value: i.occupation });
  return {
    firstName: i.given, callName: i.callName || '', lastName: i.marriedName || i.surname, birthName: i.marriedName && i.marriedName !== i.surname ? i.surname : '',
    sex: i.sex, birth: i.birth, birthPlace: i.birthPlace, death: i.death, deathPlace: i.deathPlace,
    street: i.street, zip: i.zip, city: i.city, notes: i.notes, custom,
  };
}

// ---------- Schreiben ----------
function dateToGed(s) {
  s = String(s || '').trim();
  let m;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return `${Number(m[1])} ${MONTHS[Number(m[2]) - 1]} ${m[3]}`;
  if ((m = /^(\d{1,2})\.(\d{4})$/.exec(s))) return `${MONTHS[Number(m[1]) - 1]} ${m[2]}`;
  if (/^\d{4}$/.test(s)) return s;
  return s ? `(${s})` : '';
}
function textLines(level, tag, text) {
  const out = [];
  String(text).split('\n').forEach((line, i) => {
    const chunks = line.match(/.{1,200}/gu) || [''];
    chunks.forEach((c, j) => out.push(`${i === 0 && j === 0 ? level : level + 1} ${i === 0 && j === 0 ? tag : j === 0 ? 'CONT' : 'CONC'}${c ? ' ' + c : ''}`));
  });
  return out;
}

function exportGedcom(persons, { title = 'Stammbaum', version = '' } = {}) {
  const g = buildGraph(persons);
  const xid = new Map(persons.map((p, i) => [p.id, `@I${i + 1}@`]));
  const fams = g.families();
  const famOf = { c: new Map(), s: new Map() };
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  fams.forEach((f, i) => { f.x = `@F${i + 1}@`; f.parents.forEach(p => add(famOf.s, p, f.x)); f.children.forEach(c => add(famOf.c, c, f.x)); });
  const now = new Date();
  const L = ['0 HEAD', '1 SOUR FAMILIEN-STAMMBAUM', `2 VERS ${version || '1'}`, '2 NAME Familien-Stammbaum', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8', '1 LANG German', `1 DATE ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`, ...textLines(1, 'NOTE', title)];
  for (const p of persons) {
    const surname = p.birthName || p.lastName || '';
    L.push(`0 ${xid.get(p.id)} INDI`, `1 NAME ${p.firstName || ''} /${surname}/`.replace(/\s+\//, ' /'));
    if (p.firstName) L.push(`2 GIVN ${p.firstName}`);
    if (p.callName) L.push(`2 _RUFNAME ${p.callName}`);
    if (surname) L.push(`2 SURN ${surname}`);
    if (p.birthName && p.lastName && p.lastName !== p.birthName) L.push(`1 NAME ${p.firstName || ''} /${p.lastName}/`, '2 TYPE married');
    L.push(`1 SEX ${p.sex === 'm' ? 'M' : p.sex === 'w' ? 'F' : 'U'}`);
    if (p.birth || p.birthPlace) { L.push('1 BIRT'); if (p.birth) L.push(`2 DATE ${dateToGed(p.birth)}`); if (p.birthPlace) L.push(`2 PLAC ${p.birthPlace}`); }
    if (p.death || p.deathPlace) {
      const d = p.death === 'verstorben' ? '' : p.death;
      L.push(d || p.deathPlace ? '1 DEAT' : '1 DEAT Y'); if (d) L.push(`2 DATE ${dateToGed(d)}`); if (p.deathPlace) L.push(`2 PLAC ${p.deathPlace}`);
    }
    if (p.city || p.street) {
      L.push('1 RESI'); if (p.city) L.push(`2 PLAC ${p.city}`);
      if (p.street || p.zip) { L.push(`2 ADDR ${[p.street, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`); if (p.street) L.push(`3 ADR1 ${p.street}`); if (p.zip) L.push(`3 POST ${p.zip}`); if (p.city) L.push(`3 CITY ${p.city}`); }
    }
    for (const c of p.custom || []) {
      if (/^beruf$/i.test(c.label) && c.value) L.push(`1 OCCU ${c.value}`);
      else if (c.label || c.value) L.push(...textLines(1, 'NOTE', `${c.label}: ${c.value}`));
    }
    if (p.notes) L.push(...textLines(1, 'NOTE', p.notes));
    L.push(`1 _STB_ID ${p.id}`);
    for (const f of famOf.c.get(p.id) || []) L.push(`1 FAMC ${f}`);
    for (const f of famOf.s.get(p.id) || []) L.push(`1 FAMS ${f}`);
  }
  for (const f of fams) {
    L.push(`0 ${f.x} FAM`);
    const [a, b] = f.parents.map(id => g.byId.get(id));
    let husb = a, wife = b;
    if ((a && a.sex === 'w') || (b && b.sex === 'm')) { husb = b; wife = a; }
    if (husb) L.push(`1 HUSB ${xid.get(husb.id)}`);
    if (wife) L.push(`1 WIFE ${xid.get(wife.id)}`);
    for (const c of f.children) L.push(`1 CHIL ${xid.get(c)}`);
    if (f.marriage) L.push('1 MARR', `2 DATE ${dateToGed(f.marriage)}`);
    else if (f.parents.length === 2) L.push('1 MARR Y');
    if (f.divorced) L.push('1 DIV Y');
  }
  L.push('0 TRLR');
  return L.join('\r\n') + '\r\n';
}

module.exports = { parseGedcom, exportGedcom, fieldsFromIndi, dateFromGed, dateToGed };
