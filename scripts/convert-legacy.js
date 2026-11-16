'use strict';
// Wandelt einen Export des alten HTML-Stammbaums (tree + edits) ins eigene Format um
// Aufruf: node scripts/convert-legacy.js alt.json neu.json
const fs = require('node:fs');
const { importAny, validateGraph } = require('../lib/importer');
const [src, dst] = process.argv.slice(2);
const r = importAny(JSON.parse(fs.readFileSync(src, 'utf8')));
const errs = validateGraph(r.persons);
if (errs.length) { console.error(errs); process.exit(1); }
const now = new Date().toISOString();
r.persons.forEach(p => { p.updatedAt = p.updatedAt || now; });
fs.writeFileSync(dst, JSON.stringify({ format: 'stammbaum-v1', title: r.title || 'Stammbaum', updatedAt: now, persons: r.persons }, null, 1));
console.log(`${r.persons.length} Personen geschrieben`);
r.notes.forEach(n => console.log('Hinweis:', n));
