'use strict';
// Beziehungen aus dem Datenmodell ableiten (Spiegel der Logik in public/app.js)

function buildGraph(persons) {
  const byId = new Map(persons.map(p => [p.id, p]));
  const origins = new Map();
  for (const p of persons) if (p.kind === 'origin' && p.originOf) { if (!origins.has(p.originOf)) origins.set(p.originOf, []); origins.get(p.originOf).push(p); }
  const originParents = (qId) => (origins.get(qId) || []).filter(o => o.role === 'parent');
  const ids = (list) => list.filter(Boolean).map(x => x.id);

  function parentIds(p) {
    if (!p) return [];
    if (p.kind === 'blood') return [p.parentId, p.otherParentId].filter(id => id && byId.has(id));
    if (p.kind === 'partner') return ids(originParents(p.id));
    if (p.role === 'child') return byId.has(p.originOf) ? [p.originOf] : [];
    if (p.role === 'sibling') return (p.parentIds || []).length ? p.parentIds.filter(id => byId.has(id)) : ids(originParents(p.originOf));
    const own = (p.parentIds || []).filter(id => byId.has(id));
    if (own.length) return own;
    const s = p.siblingOfId && byId.get(p.siblingOfId);
    return s ? (s.parentIds || []).filter(id => byId.has(id)) : [];
  }

  // Paare: [a, b, divorced, marriage]
  function couples() {
    const out = [];
    for (const p of persons) {
      if (p.kind === 'partner' && byId.has(p.partnerOf)) out.push([p.partnerOf, p.id, !!p.divorced, p.marriage || '', p.marriagePlace || '']);
      if (p.kind === 'origin' && p.role === 'partnerOfParent' && byId.has(p.partnerOfId)) out.push([p.partnerOfId, p.id, false, p.marriage || '', p.marriagePlace || '']);
    }
    for (const [qId] of origins) {
      const par = originParents(qId);
      if (par.length >= 2) out.push([par[0].id, par[1].id, false, par[0].marriage || par[1].marriage || '', par[0].marriagePlace || par[1].marriagePlace || '']);
    }
    // Eltern weiterer Angehöriger, die gemeinsam Kinder haben
    for (const p of persons) {
      const ps = p.kind === 'origin' && ['parent', 'partnerOfParent', 'relative'].includes(p.role) ? (p.parentIds || []) : [];
      if (ps.length === 2 && !out.some(c => (c[0] === ps[0] && c[1] === ps[1]) || (c[0] === ps[1] && c[1] === ps[0]))) out.push([ps[0], ps[1], false, '']);
    }
    return out;
  }

  // Familien (für GEDCOM): Elternpaar → Kinder; Geschwistergruppen ohne erfasste Eltern als Familie ohne Eltern
  function families() {
    const fams = new Map();
    const key = (a, b) => [a || '', b || ''].sort().join('|');
    const get = (a, b) => { const k = key(a, b); if (!fams.has(k)) fams.set(k, { parents: [a, b].filter(Boolean), children: [], divorced: false, marriage: '' }); return fams.get(k); };
    for (const [a, b, div, mar, place] of couples()) { const f = get(a, b); f.divorced = div; f.marriage = mar; f.marriagePlace = place || ''; }
    for (const p of persons) {
      const ps = parentIds(p);
      if (ps.length) get(ps[0], ps[1]).children.push(p.id);
    }
    // Geschwister ohne Eltern (siblingOfId)
    const groups = new Map();
    for (const p of persons) {
      if (p.kind !== 'origin' || parentIds(p).length) continue;
      const g = p.siblingOfId || null;
      if (g) { if (!groups.has(g)) groups.set(g, new Set([g])); groups.get(g).add(p.id); }
    }
    for (const [g, set] of groups) fams.set('sib|' + g, { parents: [], children: [...set], divorced: false, marriage: '' });
    // Kinder nach Alter
    const ageKey = (id) => { const s = String((byId.get(id) || {}).birth || ''); let m; if ((m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return +m[3] * 1e4 + +m[2] * 100 + +m[1]; if ((m = /(\d{4})/.exec(s))) return +m[1] * 1e4; return 1e9; };
    for (const f of fams.values()) f.children.sort((a, b) => ageKey(a) - ageKey(b));
    return [...fams.values()].filter(f => f.parents.length + f.children.length > 1);
  }

  return { byId, parentIds, couples, families, origins };
}

module.exports = { buildGraph };
