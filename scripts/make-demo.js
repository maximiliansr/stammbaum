'use strict';
// Erzeugt seed/beispiel.json – eine frei erfundene Beispielfamilie (keine echten Personen)
const fs = require('node:fs');
const path = require('node:path');
const persons = [];
const base = { otherParentId: null, partnerOf: null, originOf: null, role: '', parentId: null, divorced: false, hasPhoto: false, custom: [],
  birthName: '', birthPlace: '', death: '', deathPlace: '', marriage: '', street: '', zip: '', city: '', notes: '', code: '' };
let n = 0;
function add(o) { const p = Object.assign({}, base, { id: 'd' + (++n), order: n, updatedAt: '2026-01-01T00:00:00.000Z' }, o); persons.push(p); return p; }
const blood = (o) => add(Object.assign({ kind: 'blood' }, o));
const partner = (of, o) => add(Object.assign({ kind: 'partner', partnerOf: of.id }, o));
const origin = (of, role, o) => add(Object.assign({ kind: 'origin', originOf: of.id, role }, o));

const otto = blood({ firstName: 'Otto', lastName: 'Muster', sex: 'm', birth: '03.04.1902', birthPlace: 'Lübeck', death: '11.09.1975', deathPlace: 'Lübeck', city: 'Lübeck', notes: 'Kapitän auf der Ostsee-Linie.' });
const frieda = partner(otto, { firstName: 'Frieda', lastName: 'Muster', birthName: 'Kranz', sex: 'w', birth: '19.01.1905', death: '1988', marriage: '12.05.1926', city: 'Lübeck' });
const karl = blood({ parentId: otto.id, otherParentId: frieda.id, firstName: 'Karl', lastName: 'Muster', sex: 'm', birth: '02.02.1928', death: '23.03.2004', city: 'Hamburg' });
const ilse = partner(karl, { firstName: 'Ilse', lastName: 'Muster', birthName: 'Behrens', sex: 'w', birth: '14.07.1931', death: '05.12.2019', marriage: '1952', city: 'Hamburg' });
origin(ilse, 'parent', { firstName: 'August', lastName: 'Behrens', sex: 'm', birth: '1899', death: '1961' });
origin(ilse, 'sibling', { firstName: 'Gerda', lastName: 'Lohse', birthName: 'Behrens', sex: 'w', birth: '1934', death: '2015' });
const hanna = blood({ parentId: otto.id, otherParentId: frieda.id, firstName: 'Hanna', lastName: 'Clausen', birthName: 'Muster', sex: 'w', birth: '30.11.1932', city: 'Kiel' });
const jens = partner(hanna, { firstName: 'Jens', lastName: 'Clausen', sex: 'm', birth: '08.08.1930', death: '17.02.2010', marriage: '1956' });
const peter = blood({ parentId: karl.id, otherParentId: ilse.id, firstName: 'Peter', lastName: 'Muster', sex: 'm', birth: '21.06.1955', city: 'Hamburg', street: 'Musterweg 1', zip: '20095' });
const sabine = partner(peter, { firstName: 'Sabine', lastName: 'Muster', birthName: 'Wolff', sex: 'w', birth: '04.12.1958', marriage: '18.08.1984', city: 'Hamburg' });
origin(sabine, 'child', { firstName: 'Lukas', lastName: 'Wolff', sex: 'm', birth: '10.10.1979', city: 'Berlin' });
const anke = partner(peter, { firstName: 'Anke', lastName: 'Jansen', sex: 'w', birth: '1957', marriage: '1977', divorced: true });
blood({ parentId: peter.id, otherParentId: anke.id, firstName: 'Mia', lastName: 'Jansen', sex: 'w', birth: '02.03.1978', city: 'Bremen' });
const lena = blood({ parentId: peter.id, otherParentId: sabine.id, firstName: 'Lena', lastName: 'Brandt', birthName: 'Muster', sex: 'w', birth: '27.11.1986', city: 'München' });
const tim = partner(lena, { firstName: 'Tim', lastName: 'Brandt', sex: 'm', birth: '15.05.1984', marriage: '09.06.2012' });
blood({ parentId: lena.id, otherParentId: tim.id, firstName: 'Emma', lastName: 'Brandt', sex: 'w', birth: '19.11.2014', city: 'München' });
blood({ parentId: lena.id, otherParentId: tim.id, firstName: 'Noah', lastName: 'Brandt', sex: 'm', birth: '30.12.2017', city: 'München' });
blood({ parentId: peter.id, otherParentId: sabine.id, firstName: 'Jonas', lastName: 'Muster', sex: 'm', birth: '22.11.1990', city: 'Hamburg' });
const ute = blood({ parentId: karl.id, otherParentId: ilse.id, firstName: 'Ute', lastName: 'Muster', sex: 'w', birth: '1960' });
void ute;
const finn = blood({ parentId: hanna.id, otherParentId: jens.id, firstName: 'Finn', lastName: 'Clausen', sex: 'm', birth: '12.12.1960', city: 'Kiel' });
const maren = partner(finn, { firstName: 'Maren', lastName: 'Clausen', sex: 'w', birth: '03.01.1963' });
blood({ parentId: finn.id, otherParentId: maren.id, firstName: 'Ole', lastName: 'Clausen', sex: 'm', birth: '25.11.1993', city: 'Flensburg' });

const doc = { format: 'stammbaum-v1', title: 'Stammbaum Familie Muster', updatedAt: '2026-01-01T00:00:00.000Z', persons, sources: [] };
fs.writeFileSync(path.join(__dirname, '..', 'seed', 'beispiel.json'), JSON.stringify(doc, null, 1));
console.log(persons.length + ' erfundene Personen geschrieben (seed/beispiel.json)');
