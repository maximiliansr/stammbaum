'use strict';
// Änderungen aus dem Protokoll rückgängig machen
const STRUCT = ['parentId', 'otherParentId', 'partnerOf', 'role', 'parentIds'];

module.exports = function ({ route, store, HttpError, deletePerson, displayName }) {
  function undoneIds() {
    return new Set(store.readLog(5000).filter(l => l.action === 'rückgängig gemacht' && l.refId).map(l => l.refId));
  }
  function undoable(l) {
    if (!l.id || l.action === 'rückgängig gemacht') return false;
    if (l.action === 'geändert' && l.changes) return true;
    if (l.action === 'gelöscht' && l.snapshot) return true;
    if (/hinzugefügt|angelegt/.test(l.action) && l.personId) return true;
    return false;
  }

  // Protokoll mit Hinweis, was rückgängig gemacht werden kann
  route('GET', '/api/protokoll', 'admin', () => {
    const done = undoneIds();
    return store.readLog(500).map(l => Object.assign({}, l, { undoable: undoable(l) && !done.has(l.id), undone: done.has(l.id) }));
  });

  route('POST', '/api/protokoll/([a-zA-Z0-9_-]+)/rueckgaengig', 'admin', (ctx, m) => {
    const l = store.readLog(5000).find(x => x.id === m[1]);
    if (!l) throw new HttpError(404, 'Eintrag nicht gefunden');
    if (undoneIds().has(l.id)) throw new HttpError(409, 'Wurde bereits rückgängig gemacht');
    if (!undoable(l)) throw new HttpError(400, 'Dieser Eintrag lässt sich nicht automatisch rückgängig machen – bitte eine Sicherung verwenden.');
    const force = !!(ctx.body || {}).force;

    if (l.action === 'geändert') {
      const p = store.byId.get(l.personId);
      if (!p) throw new HttpError(409, 'Die Person gibt es nicht mehr.');
      // Konflikt: wurde das Feld seitdem erneut geändert?
      const conflicts = Object.entries(l.changes).filter(([k, [, now]]) => JSON.stringify(p[k] ?? '') !== JSON.stringify(now ?? ''));
      if (conflicts.length && !force) throw new HttpError(409, `Inzwischen erneut geändert: ${conflicts.map(c => c[0]).join(', ')}. Trotzdem zurücksetzen?`);
      for (const [k, [before]] of Object.entries(l.changes)) {
        if (STRUCT.includes(k)) {
          if ((k === 'parentId' || k === 'partnerOf') && before && !store.byId.has(before)) throw new HttpError(409, 'Die frühere Bezugsperson gibt es nicht mehr.');
          p[k] = before;
        } else p[k] = before;
      }
      p.updatedAt = new Date().toISOString();
      store.save();
    } else if (l.action === 'gelöscht') {
      const snap = l.snapshot;
      if (store.byId.has(snap.id)) throw new HttpError(409, 'Die Person ist bereits wieder vorhanden.');
      for (const k of ['parentId', 'partnerOf', 'originOf', 'partnerOfId']) if (snap[k] && !store.byId.has(snap[k])) throw new HttpError(409, 'Eine Bezugsperson dieser Person gibt es nicht mehr – bitte eine Sicherung verwenden.');
      if (snap.otherParentId && !store.byId.has(snap.otherParentId)) snap.otherParentId = null;
      snap.hasPhoto = false;
      store.doc.persons.push(snap);
      store.save();
    } else {
      deletePerson(l.personId, 'Admin (rückgängig)');
    }
    store.log({ who: 'Admin', action: 'rückgängig gemacht', refId: l.id, personId: l.personId, name: `${l.action}: ${l.name || displayName(store.byId.get(l.personId) || {})}` });
    return { ok: true };
  });
};
