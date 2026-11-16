'use strict';
// Abgleich einer GEDCOM-Datei mit dem vorhandenen Stammbaum.
// Ergebnis: Zuordnungen (mit Feld-Unterschieden), neu anzulegende Personen (mit Einhängepunkt), Nicht-Zuordenbares.
const { fieldsFromIndi } = require('./gedcom');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const yearOf = (s) => { const m = /(\d{4})/.exec(s || ''); return m ? Number(m[1]) : null; };
const COMPARE = ['firstName', 'lastName', 'birthName', 'sex', 'birth', 'birthPlace', 'death', 'deathPlace', 'city'];

function matchScore(i, p) {
  const gf = norm(i.given).split(' '), pf = norm(p.firstName).split(' ');
  if (!gf[0] || !pf[0]) return 0;
  const firstHit = gf[0] === pf[0] || gf.includes(pf[0]) || pf.includes(gf[0]);
  if (!firstHit) return 0;
  const sur = [norm(i.surname), norm(i.marriedName)].filter(Boolean), ours = [norm(p.lastName), norm(p.birthName)].filter(Boolean);
  const surHit = sur.some(s => ours.includes(s));
  if (!surHit && sur.length && ours.length) return 0;
  const yb = yearOf(i.birth), pb = yearOf(p.birth);
  let score = 2 + (surHit ? 2 : 0) + (norm(i.given) === norm(p.firstName) ? 1 : 0);
  if (yb && pb) { if (yb === pb) score += 3; else if (Math.abs(yb - pb) === 1) score += 1; else return 0; }
  if (i.birth && i.birth === p.birth) score += 2;
  if (i.sex && p.sex && i.sex !== p.sex) return 0;
  return score;
}

function planImport(ged, persons, { overrides = {}, rootGedId = null } = {}) {
  const byId = new Map(persons.map(p => [p.id, p]));
  const map = new Map();        // gedId → { ref, node }
  const used = new Set();       // vergebene personIds
  const matches = [], adds = [], notes = [];

  // 1) Zuordnung: _STB_ID, manuelle Vorgaben, dann beste Namens-/Datumstreffer
  const cand = [];
  for (const i of ged.indi.values()) {
    if (overrides[i.id] === null) continue;
    if (overrides[i.id] && byId.has(overrides[i.id])) { cand.push([100, i.id, overrides[i.id]]); continue; }
    if (i.stbId && byId.has(i.stbId)) { cand.push([90, i.id, i.stbId]); continue; }
    for (const p of persons) { const s = matchScore(i, p); if (s >= 6) cand.push([s, i.id, p.id]); }
  }
  cand.sort((a, b) => b[0] - a[0]);
  const candidatesFor = new Map();
  for (const [s, g, pid] of cand) { if (!candidatesFor.has(g)) candidatesFor.set(g, []); candidatesFor.get(g).push({ personId: pid, score: s }); }
  for (const [s, g, pid] of cand) {
    if (map.has(g) || used.has(pid)) continue;
    map.set(g, { ref: { personId: pid }, node: byId.get(pid), score: s });
    used.add(pid);
  }

  const refKey = (ref) => ref.personId || ref.plan;
  const nodeOf = (g) => map.get(g);
  let seq = 0;
  // Vorhandene Angehörige an derselben Stelle (für Abgleich über den Familienzusammenhang)
  function existingAt(as, anchor, extra) {
    const aId = anchor && anchor.personId; if (!aId) return [];
    const A = byId.get(aId);
    if (as === 'partner') return persons.filter(p => p.kind === 'partner' && p.partnerOf === aId);
    if (as === 'child') return persons.filter(p => p.kind === 'blood' && p.parentId === aId);
    if (as === 'origin') {
      if (extra.role === 'partnerOfParent') return persons.filter(p => p.partnerOfId === aId);
      if (extra.role === 'relative' && extra.relation === 'parent') return (A.parentIds || []).map(id => byId.get(id)).filter(Boolean);
      if (extra.role === 'relative') return persons.filter(p => p.kind === 'origin' && p.originOf === A.originOf && p.id !== aId && (p.siblingOfId === aId || A.siblingOfId === p.id || (p.siblingOfId && p.siblingOfId === A.siblingOfId)));
      const qId = A.kind === 'origin' ? A.originOf : aId;
      return persons.filter(p => p.kind === 'origin' && p.originOf === qId && p.role === extra.role);
    }
    return [];
  }

  function plan(gedId, as, anchor, extra = {}) {
    if (map.has(gedId)) return map.get(gedId);
    const near = existingAt(as, anchor, extra).filter(p => !used.has(p.id))
      .map(p => [matchScore(ged.indi.get(gedId), p), p]).filter(([sc]) => sc >= 2).sort((x, y) => y[0] - x[0])[0];
    if (near) {
      const m = { ref: { personId: near[1].id }, node: near[1], score: near[0], context: true };
      map.set(gedId, m); used.add(near[1].id); queue.push(gedId);
      return m;
    }
    const key = 'n' + (++seq);
    const i = ged.indi.get(gedId);
    const entry = { key, gedId, as, anchor, name: [i.given, i.surname].filter(Boolean).join(' '), birth: i.birth, death: i.death, fields: fieldsFromIndi(i), ...extra };
    adds.push(entry);
    const node = { kind: extra.kind, role: extra.role, virtual: true };
    const m = { ref: { plan: key }, node, entry };
    map.set(gedId, m);
    queue.push(gedId);
    return m;
  }

  // Startpunkte: alle Zuordnungen; ohne Zuordnung eine neue Stammperson
  const queue = [...map.keys()];
  if (!map.size || rootGedId) {
    let root = rootGedId && ged.indi.get(rootGedId);
    if (!root) {
      // Person ohne Eltern mit den meisten Nachkommen
      const desc = (id, seen = new Set()) => { if (seen.has(id)) return 0; seen.add(id); let n = 0; for (const f of ged.indi.get(id).fams) for (const c of (ged.fam.get(f) || {}).chil || []) if (ged.indi.has(c)) n += 1 + desc(c, seen); return n; };
      let best = -1;
      for (const i of ged.indi.values()) if (!i.famc.some(f => ged.fam.has(f) && [ged.fam.get(f).husb, ged.fam.get(f).wife].some(x => ged.indi.has(x)))) {
        const d = desc(i.id); if (d > best || (d === best && i.sex === 'm')) { best = d; root = i; }
      }
    }
    if (root && !map.has(root.id)) plan(root.id, 'root', null, { kind: 'blood', relText: 'neue Stammperson' });
  }

  const fam = (f) => ged.fam.get(f);
  const spouseIn = (f, g) => { const F = fam(f); return F ? (F.husb === g ? F.wife : F.husb) : null; };
  const label = (g) => { const i = ged.indi.get(g); return i ? [i.given, i.surname].filter(Boolean).join(' ') : g; };
  const rel = (txt, g) => `${txt} ${label(g)}`;

  while (queue.length) {
    const g = queue.shift();
    const me = nodeOf(g); if (!me) continue;
    const i = ged.indi.get(g); const n = me.node; const ref = me.ref;
    const kind = n.kind, role = n.role;

    if (kind === 'blood') {
      // Partner und Kinder
      for (const f of i.fams) {
        const F = fam(f); if (!F) continue;
        const s = spouseIn(f, g);
        let sm = s && ged.indi.has(s) ? nodeOf(s) : null;
        if (s && ged.indi.has(s) && !sm) sm = plan(s, 'partner', ref, { kind: 'partner', divorced: F.divorced, marriage: F.marriage, relText: rel('Partner/in von', g) });
        for (const c of F.chil) if (ged.indi.has(c) && !nodeOf(c)) plan(c, 'child', ref, { kind: 'blood', otherParent: sm && sm.node.kind === 'partner' ? sm.ref : 'none', relText: rel('Kind von', g) + (sm ? ' und ' + label(s) : '') });
      }
      // Eltern (neue oberste Generation, falls X eine Stammperson ist) und Geschwister
      for (const f of i.famc) {
        const F = fam(f); if (!F) continue;
        const ps = [F.husb, F.wife].filter(x => ged.indi.has(x));
        if (!ps.length) continue;
        let bp = ps.map(nodeOf).find(x => x && x.node.kind === 'blood');
        if (!bp) {
          const hasParent = n.virtual ? me.entry.as === 'child' : !!n.parentId;
          const free = ps.filter(x => !nodeOf(x));
          if (hasParent || !free.length) { notes.push(`Eltern von ${label(g)} passen nicht zu den vorhandenen Eltern – übersprungen.`); continue; }
          const bpG = free.find(x => ged.indi.get(x).sex === 'm') || free[0];
          bp = plan(bpG, 'rootParent', null, { kind: 'blood', linkChild: ref, relText: rel('Elternteil von', g) + ' (neue oberste Generation)' });
        }
        const bpG = ps.find(x => nodeOf(x) === bp);
        const other = ps.find(x => x !== bpG);
        let om = other ? nodeOf(other) : null;
        if (other && !om) om = plan(other, 'partner', bp.ref, { kind: 'partner', marriage: F.marriage, divorced: F.divorced, relText: rel('Partner/in von', bpG) });
        if (bp.entry && bp.entry.as === 'rootParent' && bp.entry.linkChild === ref && om && om.node.kind === 'partner') bp.entry.linkOther = om.ref;
        for (const c of F.chil) if (c !== g && ged.indi.has(c) && !nodeOf(c)) plan(c, 'child', bp.ref, { kind: 'blood', otherParent: om && om.node.kind === 'partner' ? om.ref : 'none', relText: rel('Geschwister von', g) });
      }
    }

    if (kind === 'partner') {
      for (const f of i.fams) {
        const F = fam(f); if (!F) continue;
        const s = spouseIn(f, g); const sm = s ? nodeOf(s) : null;
        const withBlood = sm && sm.node.kind === 'blood';
        if (s && ged.indi.has(s) && !sm) notes.push(`${label(g)} hat eine weitere Beziehung mit ${label(s)} – Partner von Angeheirateten werden nicht übernommen.`);
        for (const c of F.chil) {
          if (!ged.indi.has(c) || nodeOf(c)) continue;
          if (withBlood) plan(c, 'child', sm.ref, { kind: 'blood', otherParent: ref, relText: rel('Kind von', s) + ' und ' + label(g) });
          else plan(c, 'origin', ref, { kind: 'origin', role: 'child', relText: rel('Kind aus anderer Beziehung von', g) });
        }
      }
      for (const f of i.famc) {
        const F = fam(f); if (!F) continue;
        for (const p of [F.husb, F.wife]) if (ged.indi.has(p) && !nodeOf(p)) plan(p, 'origin', ref, { kind: 'origin', role: 'parent', relText: rel('Elternteil von', g) });
        for (const c of F.chil) if (c !== g && ged.indi.has(c) && !nodeOf(c)) plan(c, 'origin', ref, { kind: 'origin', role: 'sibling', relText: rel('Geschwister von', g) });
      }
    }

    if (kind === 'origin' && ['parent', 'partnerOfParent', 'relative'].includes(role)) {
      // weitere Partner und deren Kinder (Halbgeschwister) – nur bei Eltern der angeheirateten Person
      if (role === 'parent') {
        for (const f of i.fams) {
          const F = fam(f); if (!F) continue;
          const s = spouseIn(f, g); let sm = s && ged.indi.has(s) ? nodeOf(s) : null;
          if (s && ged.indi.has(s) && !sm) sm = plan(s, 'origin', ref, { kind: 'origin', role: 'partnerOfParent', relText: rel('Partner/in von', g) });
          for (const c of F.chil) if (ged.indi.has(c) && !nodeOf(c)) plan(c, 'origin', ref, { kind: 'origin', role: 'sibling', parentRefs: [ref, sm && sm.ref].filter(Boolean), relText: rel('Kind von', g) + (s ? ' und ' + label(s) : '') });
        }
      }
      // Eltern und Geschwister nach oben
      for (const f of i.famc) {
        const F = fam(f); if (!F) continue;
        for (const p of [F.husb, F.wife]) if (ged.indi.has(p) && !nodeOf(p)) plan(p, 'origin', ref, { kind: 'origin', role: 'relative', relation: 'parent', relText: rel('Elternteil von', g) });
        for (const c of F.chil) if (c !== g && ged.indi.has(c) && !nodeOf(c)) plan(c, 'origin', ref, { kind: 'origin', role: 'relative', relation: 'sibling', relText: rel('Geschwister von', g) });
      }
    }
  }

  // 2) Feld-Unterschiede der Zuordnungen
  for (const [g, m] of map) {
    if (!m.ref.personId) continue;
    const p = byId.get(m.ref.personId), f = fieldsFromIndi(ged.indi.get(g));
    const diffs = {};
    for (const k of COMPARE) {
      const a = String(p[k] || ''), b = String(f[k] || '');
      if (!b || a === b) continue;
      // GEDCOM führt meist den Geburtsnamen als Nachnamen
      if (k === 'lastName' && !ged.indi.get(g).marriedName && norm(b) === norm(p.birthName)) continue;
      if (['birth', 'death'].includes(k) && a && b && yearOf(a) === yearOf(b) && a.length > b.length) continue; // unsere Angabe ist genauer
      diffs[k] = { ours: a, theirs: b, fill: !a };
    }
    if (f.custom.length && !(p.custom || []).some(c => /beruf/i.test(c.label))) diffs.custom = { ours: '', theirs: f.custom.map(c => `${c.label}: ${c.value}`).join(', '), fill: true, value: [...(p.custom || []), ...f.custom] };
    const i = ged.indi.get(g);
    matches.push({ gedId: g, personId: p.id, score: m.score, gedName: [i.given, i.surname].filter(Boolean).join(' '), gedBirth: i.birth, diffs,
      alternatives: (candidatesFor.get(g) || []).filter(c => c.personId !== p.id).slice(0, 3) });
  }
  const unattached = [...ged.indi.values()].filter(i => !map.has(i.id)).map(i => ({ gedId: i.id, name: [i.given, i.surname].filter(Boolean).join(' '), birth: i.birth,
    candidates: (candidatesFor.get(i.id) || []).slice(0, 3) }));
  return { matches, adds, unattached, notes: [...new Set(notes)], total: ged.indi.size };
}

module.exports = { planImport, matchScore, refKey: (r) => r && (r.personId || r.plan) };
