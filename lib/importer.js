'use strict';
// Liest das bisherige Export-Format (tree + edits) oder das eigene Format ein.
const { emptyPerson, clean, TEXT_FIELDS } = require('./model');

const FEMALE = new Set(('Alina Ana Andrea Anita Anna Annemarie Antonia April Barbara Betsy Bettina Birgit Birte Birthe ' +
  'Brenda Brigitte Bärbel Celina Charleen Christina Cindy Claudia Donna Elena Elke Emilie Emma Finja Franziska ' +
  'Gisela Greta Grete Hannelore Heidi Heike Helga Hilde Ingeborg Iris Ivy Jana Jennifer Katharina Kathleen Kathrin ' +
  'Kathy Kaylee Keanna Kerstin Kirsten Laura Leah Lena Lilli Lina Luise Manuela Margret Marie Marie-Anne Marlies ' +
  'Mary Melissa Melody Monica Nicole Nora Regina Rosemarie Rosi Ruth Sabine Sandra Sara Sarah Söngul Susanne Tanja ' +
  'Ursula Ute Veronica Waltraut Wendy Zoe').split(' '));
const AMBIGUOUS = new Set(['Alexis', 'Cameron', 'Kris', 'Jasmin', 'Francis', 'Kim', 'Robin', 'Toni', 'Charlie', '']);

function guessSex(firstName) {
  const fn = (firstName || '').trim();
  const first = fn.split(/\s+/)[0];
  if (FEMALE.has(first)) return 'w';
  if (AMBIGUOUS.has(first)) return '';
  return 'm';
}

function fromLegacyPerson(lp) {
  const p = emptyPerson();
  p.id = clean(lp.id, 40) || null;
  for (const k of Object.keys(TEXT_FIELDS)) if (k in lp) p[k] = clean(lp[k], TEXT_FIELDS[k]);
  p.code = clean(lp.code, 40);
  p.custom = Array.isArray(lp.custom) ? lp.custom.map(c => ({ label: clean(c.label, 60), value: clean(c.value, 500) })) : [];
  p.sex = guessSex(p.firstName);
  return p;
}

function importLegacy(doc) {
  const persons = [];
  const notes = [];
  const seen = new Set();
  const uid = (id) => {
    let x = id || ('p' + Math.random().toString(36).slice(2, 10));
    while (seen.has(x)) x = x + 'x';
    seen.add(x); return x;
  };
  function walk(node, parentId, order) {
    const lp = node.person;
    const p = fromLegacyPerson(lp);
    p.id = uid(p.id);
    p.kind = 'blood';
    p.parentId = parentId;
    p.order = parseInt(lp.marker, 10) || order;
    const ownMarriage = p.marriage; p.marriage = '';
    persons.push(p);

    const partners = [];
    (node.spouses || []).forEach((ls, i) => {
      const s = fromLegacyPerson(ls);
      s.id = uid(s.id);
      s.kind = 'partner';
      s.partnerOf = p.id;
      s.order = i + 1;
      if (ls.marker === '&-' || /gesch/i.test(s.marriage)) { s.divorced = true; if (/gesch/i.test(s.marriage)) s.marriage = ''; }
      partners.push(s); persons.push(s);
    });
    if (ownMarriage && !partners.some(s => s.marriage === ownMarriage)) {
      // Datum dem Partner ohne eigenes Heiratsdatum zuordnen (z. B. frühere Ehe)
      const target = partners.find(s => !s.marriage && !s.divorced) || partners.find(s => !s.marriage);
      if (target) target.marriage = ownMarriage;
      else p.notes = (p.notes ? p.notes + '\n' : '') + 'Heirat: ' + ownMarriage;
    }
    const coParent = partners.find(s => !s.divorced) || partners[0];
    (node.children || []).forEach((c, i) => {
      const child = walk(c, p.id, i + 1);
      if (coParent) child.otherParentId = coParent.id;
    });
    return p;
  }
  (doc.tree || []).forEach((root, i) => walk(root, null, i + 1));
  return { persons, notes };
}

// Akzeptiert: eigenes Format {format:'stammbaum-v1', persons:[]} oder bisheriges {tree:[]}
function importAny(doc) {
  if (doc && Array.isArray(doc.persons)) {
    const persons = doc.persons.map(x => {
      const p = Object.assign(emptyPerson(), fromLegacyPerson(x));
      p.id = clean(x.id, 40); p.kind = ['partner', 'origin'].includes(x.kind) ? x.kind : 'blood';
      p.parentId = x.parentId || null; p.otherParentId = x.otherParentId || null; p.partnerOf = x.partnerOf || null;
      p.originOf = x.originOf || null; p.role = ['parent', 'sibling', 'child', 'partnerOfParent', 'relative'].includes(x.role) ? x.role : '';
      p.parentIds = Array.isArray(x.parentIds) ? x.parentIds.slice(0, 2) : []; p.partnerOfId = x.partnerOfId || null; p.siblingOfId = x.siblingOfId || null;
      p.order = Number(x.order) || 0; p.sex = ['m', 'w', 'd'].includes(x.sex) ? x.sex : '';
      p.divorced = !!x.divorced; p.hasPhoto = !!x.hasPhoto; p.updatedAt = x.updatedAt || '';
      return p;
    });
    const sources = Array.isArray(doc.sources) ? doc.sources.filter(s => s && s.id && s.file) : [];
    return { persons, notes: [], title: doc.title, sources };
  }
  if (doc && Array.isArray(doc.tree)) {
    const r = importLegacy(doc);
    r.title = doc.meta && doc.meta.title;
    return r;
  }
  throw new Error('Unbekanntes Dateiformat – erwartet wird ein Stammbaum-Export (JSON).');
}

// Prüft Verweise und Zyklen
function validateGraph(persons) {
  const byId = new Map(persons.map(p => [p.id, p]));
  const errors = [];
  for (const p of persons) {
    if (!p.id) errors.push('Person ohne ID');
    if (p.kind === 'blood' && p.parentId && !byId.has(p.parentId)) errors.push(`${p.id}: Elternteil fehlt`);
    if (p.kind === 'partner' && !byId.has(p.partnerOf)) errors.push(`${p.id}: Partner fehlt`);
    if (p.kind === 'origin' && (!byId.has(p.originOf) || byId.get(p.originOf).kind !== 'partner')) errors.push(`${p.id}: zugehörige/r Partner/in fehlt`);
    if (p.otherParentId && !byId.has(p.otherParentId)) p.otherParentId = null;
    if (Array.isArray(p.parentIds)) p.parentIds = p.parentIds.filter(id => byId.has(id));
    if (p.partnerOfId && !byId.has(p.partnerOfId)) p.partnerOfId = null;
    if (p.siblingOfId && !byId.has(p.siblingOfId)) p.siblingOfId = null;
    let cur = p, steps = 0;
    while (cur && cur.parentId && steps < 500) { cur = byId.get(cur.parentId); steps++; }
    if (steps >= 500) errors.push(`${p.id}: Kreisbezug in der Abstammung`);
  }
  return errors;
}

module.exports = { importAny, validateGraph, guessSex };
