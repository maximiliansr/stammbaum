'use strict';
// GEDCOM: Export, Abgleich (Vorschau) und Übernahme
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseGedcom, exportGedcom, fieldsFromIndi } = require('../gedcom');
const { planImport, refKey } = require('../gedcom-plan');

module.exports = function ({ route, store, notify, HttpError, createPerson, updatePerson, sanitizeFields, APP_VERSION, SITE_TITLE }) {
  const sessions = new Map(); // token → { ged, at }
  const sweep = () => { for (const [k, v] of sessions) if (Date.now() - v.at > 2 * 3600e3) sessions.delete(k); };

  route('GET', '/api/export\\.ged', 'admin', (ctx) => {
    const text = exportGedcom(store.doc.persons, { title: SITE_TITLE || store.doc.title, version: APP_VERSION });
    ctx.raw(200, text, { 'Content-Type': 'text/vnd.familysearch.gedcom; charset=utf-8', 'Content-Disposition': `attachment; filename="stammbaum-${new Date().toISOString().slice(0, 10)}.ged"` });
  });

  function makePlan(ged, b) {
    const plan = planImport(ged, store.doc.persons, { overrides: b.overrides || {}, rootGedId: b.rootGedId || null });
    // Abhängigkeiten für die Oberfläche (Abwählen eines Eintrags wählt abhängige mit ab)
    for (const a of plan.adds) {
      a.dependsOn = [a.anchor, a.otherParent, ...(a.parentRefs || [])].filter(r => r && r !== 'none' && r.plan).map(r => r.plan);
    }
    return plan;
  }

  route('POST', '/api/gedcom/vorschau', 'admin', (ctx) => {
    sweep();
    const b = ctx.body || {};
    let token = b.token, entry = token && sessions.get(token);
    if (!entry) {
      if (!b.text || typeof b.text !== 'string') throw new HttpError(400, 'Bitte eine GEDCOM-Datei (.ged) wählen');
      const ged = parseGedcom(b.text);
      if (!ged.indi.size) throw new HttpError(400, 'In der Datei wurden keine Personen gefunden – ist es eine GEDCOM-Datei?');
      token = crypto.randomBytes(12).toString('hex');
      entry = { ged, at: Date.now() }; sessions.set(token, entry);
    }
    entry.at = Date.now();
    const plan = makePlan(entry.ged, b);
    return Object.assign({ token, source: entry.ged.source, families: entry.ged.fam.size }, plan);
  });

  route('POST', '/api/gedcom/uebernehmen', 'admin', (ctx) => {
    const b = ctx.body || {};
    const entry = sessions.get(b.token);
    if (!entry) throw new HttpError(410, 'Die Vorschau ist abgelaufen – bitte die Datei erneut wählen.');
    const plan = makePlan(entry.ged, b);
    const selectedAdds = new Set(b.adds || []);
    const selectedUpdates = new Map((b.updates || []).map(u => [u.gedId, new Set(u.keys || [])]));

    // Sicherung vor dem Import
    store.backupIfNeeded();
    fs.copyFileSync(store.file, path.join(store.backupDir, `vor-gedcom-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));

    const created = new Map();
    const resolve = (r) => (!r || r === 'none' ? null : r.personId || created.get(r.plan) || null);
    const who = 'GEDCOM-Import';
    const errors = [];
    let added = 0, updated = 0;

    for (const a of plan.adds) {
      if (!selectedAdds.has(a.key)) continue;
      const anchorId = resolve(a.anchor);
      if (a.anchor && !anchorId) { errors.push(`${a.name}: Bezugsperson wurde nicht übernommen`); continue; }
      const f = Object.assign({}, a.fields);
      if (!f.firstName && !f.lastName) f.firstName = '(unbekannt)';
      if (a.as === 'partner') { f.marriage = a.marriage || ''; f.divorced = !!a.divorced; }
      const r = sanitizeFields(f);
      if (r.errors.length) { errors.push(`${a.name}: ${r.errors.join(', ')}`); continue; }
      try {
        let p;
        if (a.as === 'root' || a.as === 'rootParent') p = createPerson({ kind: 'root', fields: r.fields }, who);
        else if (a.as === 'partner') p = createPerson({ kind: 'partner', anchorId, fields: r.fields }, who);
        else if (a.as === 'child') {
          const op = a.otherParent === 'none' ? 'none' : resolve(a.otherParent) || 'none';
          p = createPerson({ kind: 'child', anchorId, fields: r.fields, otherParentId: op }, who);
        } else if (a.as === 'origin') {
          p = createPerson({ kind: 'origin', anchorId, fields: r.fields, role: a.role, relation: a.relation, parentIds: (a.parentRefs || []).map(resolve).filter(Boolean) }, who);
        }
        if (p) { created.set(a.key, p.id); added++; }
      } catch (e) { errors.push(`${a.name}: ${e.message}`); }
    }
    // Neue oberste Generation mit bisherigen Stammpersonen verbinden
    for (const a of plan.adds) {
      if (a.as !== 'rootParent' || !created.has(a.key)) continue;
      const child = store.byId.get(resolve(a.linkChild));
      if (!child || child.kind !== 'blood' || child.parentId) continue;
      child.parentId = created.get(a.key);
      const op = resolve(a.linkOther);
      if (op && store.byId.get(op)?.partnerOf === child.parentId) child.otherParentId = op;
      child.updatedAt = new Date().toISOString();
      store.save();
      store.log({ who, action: 'geändert', personId: child.id, name: [child.firstName, child.lastName].join(' '), changes: { parentId: [null, child.parentId] } });
    }
    // Felder vorhandener Personen ergänzen
    for (const m of plan.matches) {
      const keys = selectedUpdates.get(m.gedId); if (!keys || !keys.size) continue;
      const theirs = fieldsFromIndi(entry.ged.indi.get(m.gedId));
      const fields = {};
      for (const k of keys) { if (!m.diffs[k]) continue; fields[k] = k === 'custom' ? m.diffs.custom.value : theirs[k]; }
      const p = store.byId.get(m.personId);
      const r = sanitizeFields(Object.assign({}, fields, { __legacy: p }), { partial: true });
      if (r.errors.length) { errors.push(`${[p.firstName, p.lastName].join(' ')}: ${r.errors.join(', ')}`); continue; }
      try { if (Object.keys(updatePerson(m.personId, r.fields, who).changes).length) updated++; } catch (e) { errors.push(e.message); }
    }
    store.log({ who: 'Admin', action: 'GEDCOM-Import', name: `${added} neu, ${updated} ergänzt` });
    notify.send('import', 'GEDCOM-Import abgeschlossen', `${added} Personen neu, ${updated} ergänzt${errors.length ? `, ${errors.length} Hinweise` : ''}`, { tags: 'inbox_tray', click: '/#/admin/protokoll' });
    sessions.delete(b.token);
    return { ok: true, added, updated, errors };
  });
  void refKey;
};
