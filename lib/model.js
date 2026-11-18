'use strict';
// Datenmodell: flache Personenliste.
//  kind 'blood'   = Blutsverwandte/r, hängt über parentId am Elternteil der Stammlinie
//  kind 'partner' = (Ehe-)Partner/in, hängt über partnerOf an einer Person
//  otherParentId  = optional: Partner/in, mit dem/der das Kind gemeinsam ist

const TEXT_FIELDS = {
  firstName: 120, callName: 60, lastName: 120, birthName: 120, birth: 40, birthPlace: 120,
  death: 40, deathPlace: 120, marriage: 40, marriagePlace: 120, street: 160, zip: 12, city: 120,
  baptism: 40, baptismPlace: 120, burial: 40, burialPlace: 120, religion: 60,
  notes: 3000, code: 40,
};
const DATE_FIELDS = ['birth', 'death', 'marriage', 'baptism', 'burial'];
const PEDI = ['', 'adopted', 'foster'];
const SEX = ['', 'm', 'w', 'd'];
// Erlaubt: TT.MM.JJJJ, MM.JJJJ, JJJJ – auch ungefähr: „ca. 1900“, „vor 1850“, „nach 03.1850“, „zw. 1920 und 1925“
const BASE = '(?:\\d{2}\\.\\d{2}\\.\\d{4}|\\d{2}\\.\\d{4}|\\d{4})';
const DATE_RE = new RegExp(`^(?:(?:ca\\.|vor|nach) )?${BASE}$|^zw\\. ${BASE} und ${BASE}$`);

// Schreibweisen vereinheitlichen: „um 1900“ → „ca. 1900“, „1920-1925“ → „zw. 1920 und 1925“, „1.2.1900“ → „01.02.1900“
function normDate(v) {
  let s = String(v || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const one = (x) => {
    x = x.trim().replace(/[,/-]/g, '.').replace(/\s+/g, '');
    if (/^\d{8}$/.test(x)) x = `${x.slice(0, 2)}.${x.slice(2, 4)}.${x.slice(4)}`;
    let m;
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(x))) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
    if ((m = /^(\d{1,2})\.(\d{4})$/.exec(x))) return `${m[1].padStart(2, '0')}.${m[2]}`;
    return x;
  };
  let m;
  if ((m = /^(?:zwischen|zw\.?)\s*(.+?)\s+(?:und|u\.|bis|-|–)\s+(.+)$/i.exec(s))) return `zw. ${one(m[1])} und ${one(m[2])}`;
  if ((m = /^(\d{4})\s*[-–]\s*(\d{4})$/.exec(s))) return `zw. ${m[1]} und ${m[2]}`;
  if ((m = /^(?:ca\.?|um|etwa|circa|~|geschätzt|err\.?)\s*(.+)$/i.exec(s))) return `ca. ${one(m[1])}`;
  if ((m = /^(?:vor|bis|<)\s*(.+)$/i.exec(s))) return `vor ${one(m[1])}`;
  if ((m = /^(?:nach|ab|>)\s*(.+)$/i.exec(s))) return `nach ${one(m[1])}`;
  if (/^verstorben$/i.test(s)) return 'verstorben';
  return one(s);
}

function clean(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

// Normalisiert/prüft Felder, die über die API kommen. Gibt {fields, errors} zurück.
function sanitizeFields(input, { partial = false } = {}) {
  const out = {};
  const errors = [];
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    if (partial && !(k in input)) continue;
    out[k] = clean(input[k], max);
  }
  for (const k of DATE_FIELDS) {
    if (!(k in out)) continue;
    out[k] = normDate(out[k]);
    if (k === 'death' && /^verstorben$/i.test(out[k])) { out[k] = 'verstorben'; continue; }
    if (out[k] && !DATE_RE.test(out[k]) && out[k] !== (input.__legacy || {})[k]) {
      errors.push(`${label(k)}: bitte als TT.MM.JJJJ, MM.JJJJ oder JJJJ eingeben (ungefähr: „ca. 1900“, „vor 1850“, „zw. 1920 und 1925“)`);
    }
  }
  // Rufname muss einer der Vornamen sein
  if ('callName' in out) {
    const given = String(('firstName' in out ? out.firstName : (input.__legacy || {}).firstName) || '').split(/\s+/);
    const hit = given.find(g => g.toLowerCase() === out.callName.toLowerCase());
    out.callName = hit && given.length > 1 ? hit : '';
  }
  if (!partial || 'sex' in input) out.sex = SEX.includes(input.sex) ? input.sex : '';
  if (!partial || 'divorced' in input) out.divorced = !!input.divorced;
  if (!partial || 'pedi' in input) out.pedi = PEDI.includes(input.pedi) ? input.pedi : '';
  if (!partial || 'custom' in input) {
    const c = Array.isArray(input.custom) ? input.custom : [];
    out.custom = c.slice(0, 25)
      .map(x => ({ label: clean(x && x.label, 60), value: clean(x && x.value, 500) }))
      .filter(x => x.label || x.value);
  }
  if (!partial && !out.firstName && !out.lastName) errors.push('Bitte mindestens Vor- oder Nachnamen angeben');
  return { fields: out, errors };
}

function label(k) {
  return ({ birth: 'Geburtsdatum', death: 'Sterbedatum', marriage: 'Heiratsdatum', baptism: 'Taufdatum', burial: 'Beerdigungsdatum' })[k] || k;
}

function emptyPerson() {
  const p = { id: '', kind: 'blood', parentId: null, otherParentId: null, partnerOf: null, originOf: null, role: '', parentIds: [], partnerOfId: null, siblingOfId: null, order: 0,
    sex: '', divorced: false, pedi: '', hasPhoto: false, custom: [], updatedAt: '' };
  for (const k of Object.keys(TEXT_FIELDS)) p[k] = '';
  return p;
}

const SOURCE_KINDS = ['Traueranzeige', 'Stammbuch / Familienbuch', 'Geburtsurkunde', 'Taufschein', 'Heiratsurkunde', 'Sterbeurkunde',
  'Foto', 'Brief', 'Zeitungsartikel', 'Sonstiges'];

function sanitizeSource(input) {
  const s = {
    title: clean(input.title, 160), kind: SOURCE_KINDS.includes(input.kind) ? input.kind : 'Sonstiges',
    date: clean(input.date, 20), note: clean(input.note, 2000),
  };
  if (!s.title) s.title = s.kind;
  return s;
}

function newId() {
  return 'p' + Date.now().toString(36) + require('node:crypto').randomBytes(3).toString('hex');
}

module.exports = { TEXT_FIELDS, DATE_FIELDS, PEDI, normDate, SEX, DATE_RE, SOURCE_KINDS, sanitizeFields, sanitizeSource, emptyPerson, newId, clean };
