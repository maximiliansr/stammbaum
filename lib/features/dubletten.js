'use strict';
// Doppelte Personen finden und zusammenführen
const fs = require('node:fs');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const yearOf = (s) => { const m = /(\d{4})/.exec(s || ''); return m ? Number(m[1]) : null; };

// Ähnlichkeit zweier Personen (0 = keine Dublette)
function similarity(a, b) {
  const fa = norm(a.firstName).split(' '), fb = norm(b.firstName).split(' ');
  if (!fa[0] || !fb[0]) return 0;
  const firstHit = fa[0] === fb[0] || fa.includes(fb[0]) || fb.includes(fa[0]);
  if (!firstHit) return 0;
  const na = [norm(a.lastName), norm(a.birthName)].filter(Boolean), nb = [norm(b.lastName), norm(b.birthName)].filter(Boolean);
  const surHit = na.some(x => nb.includes(x));
  if (!surHit && na.length && nb.length) return 0;
  if (a.sex && b.sex && a.sex !== b.sex) return 0;
  const ya = yearOf(a.birth), yb = yearOf(b.birth);
  if (ya && yb && Math.abs(ya - yb) > 1) return 0;
  let s = 1 + (surHit ? 1 : 0) + (norm(a.firstName) === norm(b.firstName) ? 1 : 0);
  if (ya && yb && ya === yb) s += 2;
  if (a.birth && a.birth === b.birth) s += 2;
  if (!ya || !yb) s -= 1;
  return s;
}

module.exports = function ({ route, store, settings, HttpError, sanitizeFields, displayName, isDescendant }) {
  const ignored = () => new Set(settings.get().dublettenIgnoriert || []);
  const pairKey = (a, b) => [a, b].sort().join('|');

  route('GET', '/api/dubletten', 'admin', () => {
    const ps = store.doc.persons, ign = ignored(), out = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (ign.has(pairKey(a.id, b.id))) continue;
      // Ehepartner sind keine Dubletten
      if (a.partnerOf === b.id || b.partnerOf === a.id) continue;
      const s = similarity(a, b);
      if (s >= 3) out.push({ a: a.id, b: b.id, score: s, sameKind: a.kind === b.kind });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 200);
  });

  route('POST', '/api/dubletten/ignorieren', 'admin', (ctx) => {
    const { a, b } = ctx.body || {};
    if (!store.byId.has(a) || !store.byId.has(b)) throw new HttpError(400, 'Person nicht gefunden');
    const list = settings.get().dublettenIgnoriert || [];
    const k = pairKey(a, b);
    if (!list.includes(k)) list.push(k);
    settings.get().dublettenIgnoriert = list; settings.save();
    return { ok: true };
  });

  route('POST', '/api/dubletten/zusammenfuehren', 'admin', (ctx) => {
    const { keepId, dropId, fields } = ctx.body || {};
    const keep = store.byId.get(keepId), drop = store.byId.get(dropId);
    if (!keep || !drop || keep === drop) throw new HttpError(400, 'Bitte zwei verschiedene Personen wählen');
    if (keep.kind !== drop.kind) throw new HttpError(400, 'Nur Personen derselben Art lassen sich zusammenführen (Familie/Partner/Herkunftsfamilie). Bitte erst eine davon umhängen.');
    if (keep.kind === 'blood') {
      if (keep.parentId && drop.parentId && keep.parentId !== drop.parentId) throw new HttpError(400, 'Die beiden hängen an unterschiedlichen Eltern – bitte erst die Eltern angleichen.');
      if (isDescendant(keep.id, drop.id) || isDescendant(drop.id, keep.id)) throw new HttpError(400, 'Eine der beiden ist Vorfahr/Nachkomme der anderen.');
    }
    if (keep.kind === 'partner' && keep.partnerOf !== drop.partnerOf) throw new HttpError(400, 'Die beiden sind Partner unterschiedlicher Personen.');
    if (keep.kind === 'origin' && keep.originOf !== drop.originOf) throw new HttpError(400, 'Die beiden gehören zu unterschiedlichen Herkunftsfamilien.');

    const r = sanitizeFields(Object.assign({}, fields || {}, { __legacy: keep }), { partial: true });
    if (r.errors.length) throw new HttpError(400, r.errors.join(' · '));
    const snapshot = JSON.parse(JSON.stringify(drop));
    Object.assign(keep, r.fields);
    if (keep.kind === 'blood') {
      keep.parentId = keep.parentId || drop.parentId;
      keep.otherParentId = keep.otherParentId || drop.otherParentId;
    }
    if (keep.kind === 'partner' && drop.marriage && !keep.marriage) keep.marriage = drop.marriage;
    // Alle Verweise auf die entfernte Person umhängen
    for (const p of store.doc.persons) {
      if (p === drop) continue;
      for (const k of ['parentId', 'otherParentId', 'partnerOf', 'originOf', 'partnerOfId', 'siblingOfId']) if (p[k] === drop.id) p[k] = keep.id;
      if (Array.isArray(p.parentIds) && p.parentIds.includes(drop.id)) p.parentIds = [...new Set(p.parentIds.map(x => (x === drop.id ? keep.id : x)))];
    }
    if (keep.siblingOfId === keep.id) keep.siblingOfId = null;
    if (Array.isArray(keep.parentIds)) keep.parentIds = keep.parentIds.filter(x => x !== keep.id);
    for (const s of store.doc.sources) if ((s.personIds || []).includes(drop.id)) s.personIds = [...new Set(s.personIds.map(x => (x === drop.id ? keep.id : x)))];
    for (const s of store.suggestions) if (s.targetId === drop.id && s.status === 'offen') s.targetId = keep.id;
    if (!keep.hasPhoto && drop.hasPhoto && fs.existsSync(store.photoPath(drop.id))) { fs.renameSync(store.photoPath(drop.id), store.photoPath(keep.id)); keep.hasPhoto = true; }
    else { try { fs.unlinkSync(store.photoPath(drop.id)); } catch {} }
    store.doc.persons = store.doc.persons.filter(p => p !== drop);
    keep.updatedAt = new Date().toISOString();
    store.save(); store.saveSuggestions();
    const list = settings.get().dublettenIgnoriert || [];
    settings.get().dublettenIgnoriert = list.filter(k => !k.split('|').includes(drop.id)); settings.save();
    store.log({ who: 'Admin', action: 'zusammengeführt', personId: keep.id, name: `${displayName(drop)} → ${displayName(keep)}`, snapshot });
    return { person: keep };
  });
};
module.exports.similarity = similarity;
