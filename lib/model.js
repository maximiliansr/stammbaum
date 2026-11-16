'use strict';
// Datenmodell: flache Personenliste.
//  kind 'blood'   = Blutsverwandte/r, hängt über parentId am Elternteil der Stammlinie
//  kind 'partner' = (Ehe-)Partner/in, hängt über partnerOf an einer Person
//  otherParentId  = optional: Partner/in, mit dem/der das Kind gemeinsam ist

const TEXT_FIELDS = {
  firstName: 120, lastName: 120, birthName: 120, birth: 20, birthPlace: 120,
  death: 20, deathPlace: 120, marriage: 20, street: 160, zip: 12, city: 120,
  notes: 3000, code: 40,
};
const SEX = ['', 'm', 'w', 'd'];
const DATE_RE = /^(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\.\d{4}|\d{4})$/;

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
  for (const k of ['birth', 'death', 'marriage']) {
    if (k === 'death' && /^verstorben$/i.test(out[k])) { out[k] = 'verstorben'; continue; }
    if (out[k] && !DATE_RE.test(out[k]) && out[k] !== (input.__legacy || {})[k]) {
      errors.push(`${label(k)}: bitte als TT.MM.JJJJ, MM.JJJJ oder JJJJ eingeben`);
    }
  }
  if (!partial || 'sex' in input) out.sex = SEX.includes(input.sex) ? input.sex : '';
  if (!partial || 'divorced' in input) out.divorced = !!input.divorced;
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
  return ({ birth: 'Geburtsdatum', death: 'Sterbedatum', marriage: 'Heiratsdatum' })[k] || k;
}

function emptyPerson() {
  const p = { id: '', kind: 'blood', parentId: null, otherParentId: null, partnerOf: null, originOf: null, role: '', parentIds: [], partnerOfId: null, siblingOfId: null, order: 0,
    sex: '', divorced: false, hasPhoto: false, custom: [], updatedAt: '' };
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

module.exports = { TEXT_FIELDS, SEX, DATE_RE, SOURCE_KINDS, sanitizeFields, sanitizeSource, emptyPerson, newId, clean };
