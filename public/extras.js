'use strict';
/* Erweiterungen: Jubiläen, Karte, Poster/PDF, Verwaltung (Einstellungen, Dubletten, GEDCOM)
   Nutzt die globalen Hilfen aus app.js (S, api, esc, $, $$, toast, dialog, …). */

// ================= Jubiläen =================
const WEDDING_NAMES = { 1: 'Papierhochzeit', 5: 'Hölzerne Hochzeit', 10: 'Rosenhochzeit', 15: 'Kristallhochzeit', 20: 'Porzellanhochzeit',
  25: 'Silberne Hochzeit', 30: 'Perlenhochzeit', 35: 'Leinwandhochzeit', 40: 'Rubinhochzeit', 45: 'Messinghochzeit', 50: 'Goldene Hochzeit',
  55: 'Platinhochzeit', 60: 'Diamantene Hochzeit', 65: 'Eiserne Hochzeit', 70: 'Gnadenhochzeit', 75: 'Kronjuwelenhochzeit' };

function nextOccurrence(f, today) {
  let n = new Date(today.getFullYear(), f.m - 1, f.d);
  if (f.m === 2 && f.d === 29 && n.getMonth() !== 1) n = new Date(today.getFullYear(), 1, 28);
  if (n < today) n = new Date(today.getFullYear() + 1, f.m - 1, f.d);
  return n;
}

// Hochzeitstage von Paaren, die beide leben und nicht geschieden sind
function upcomingWeddings(days = 366) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const s of S.persons) {
    if (s.kind !== 'partner' || s.divorced || !isLiving(s)) continue;
    const b = S.byId.get(s.partnerOf); if (!b || !isLiving(b)) continue;
    const f = parseFull(s.marriage); if (!f) continue;
    const next = nextOccurrence(f, today);
    const inDays = Math.round((next - today) / 864e5);
    if (inDays <= days) out.push({ wedding: true, a: b, b: s, p: b, next, inDays, years: next.getFullYear() - f.y });
  }
  return out;
}
// Todestage aller Verstorbenen mit vollständigem Sterbedatum
function upcomingDeathDays(days = 366) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const p of S.persons) {
    const f = parseFull(p.death); if (!f) continue;
    const next = nextOccurrence(f, today);
    const inDays = Math.round((next - today) / 864e5);
    const years = next.getFullYear() - f.y;
    if (inDays <= days && years > 0) out.push({ memorial: true, p, next, inDays, years });
  }
  return out;
}
function memorialRow(m) {
  const rel = shortRelToMe(m.p.id);
  return `<a class="bday-row mem${m.inDays === 0 ? ' today' : ''}" href="#/p/${esc(m.p.id)}">
    <div class="bday-date"><b>${m.next.getDate()}</b><span>${MON3[m.next.getMonth()]}</span></div>
    ${avatar(m.p)}
    <div class="who">${esc(fullName(m.p))} <span class="kind-tag mem">† ${m.years}. Todestag</span><small>${esc([lifespan(m.p), rel].filter(Boolean).join(' · '))}</small></div>
    <span class="when">${whenText(m.inDays)}</span></a>`;
}
// Alle Gedenktage gemischt: Geburtstage, Hochzeitstage, Todestage
function upcomingDays(days, { weddings = true, deaths = true } = {}) {
  return [...upcomingBirthdays(days), ...(weddings ? upcomingWeddings(days) : []), ...(deaths ? upcomingDeathDays(days) : [])]
    .sort((a, b) => a.inDays - b.inDays || (a.memorial ? 1 : 0) - (b.memorial ? 1 : 0));
}

function coupleName(a, b) {
  return a.lastName && a.lastName === b.lastName ? `${a.firstName.split(' ')[0]} & ${b.firstName.split(' ')[0]} ${a.lastName}` : `${fullName(a)} & ${fullName(b)}`;
}
function weddingRow(w) {
  const special = WEDDING_NAMES[w.years];
  return `<a class="bday-row wed${w.inDays === 0 ? ' today' : ''}" href="#/p/${esc(w.a.id)}">
    <div class="bday-date"><b>${w.next.getDate()}</b><span>${MON3[w.next.getMonth()]}</span></div>
    <span class="mono ring" aria-hidden="true">⚭</span>
    <div class="who">${esc(coupleName(w.a, w.b))} <span class="kind-tag wed">⚭ ${w.years}. Hochzeitstag</span>${special ? ` <span class="pill warn">${esc(special)}</span>` : ''}<small>verheiratet seit ${esc(w.b.marriage)}</small></div>
    <span class="when${w.inDays < 7 ? ' soon' : ''}">${whenText(w.inDays)}</span></a>`;
}

// Alle Jubiläen der nächsten Tage: runde Geburtstage, besondere Hochzeitstage, „heute vor X Jahren“
function jubilees(days = 60) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = [];
  for (const b of upcomingBirthdays(days)) if (isRoundAge(b.turns)) items.push({ inDays: b.inDays, next: b.next, kind: 'geb', p: b.p, title: `${b.turns}. Geburtstag`, who: fullName(b.p) });
  for (const w of upcomingWeddings(days)) if (WEDDING_NAMES[w.years] || w.years % 5 === 0) items.push({ inDays: w.inDays, next: w.next, kind: 'hochzeit', p: w.a, title: WEDDING_NAMES[w.years] || `${w.years}. Hochzeitstag`, who: coupleName(w.a, w.b) });
  // Gedenken: runde Jahre seit Geburt/Tod/Heirat verstorbener bzw. historischer Ereignisse
  const ROUND = [50, 75, 100, 125, 150, 175, 200];
  for (const p of S.persons) {
    const evs = [];
    if (!isLiving(p)) evs.push(['birth', p.birth, 'Geburtstag']);
    evs.push(['death', p.death, 'Todestag']);
    for (const [, val, label] of evs) {
      const f = parseFull(val); if (!f) continue;
      const next = nextOccurrence(f, today), years = next.getFullYear() - f.y, inDays = Math.round((next - today) / 864e5);
      if (inDays <= days && ROUND.includes(years)) items.push({ inDays, next, kind: 'gedenken', p, title: `${years}. ${label}`, who: `${fullName(p)} (${lifespan(p)})` });
    }
  }
  return items.sort((a, b) => a.inDays - b.inDays);
}

function renderJubilees(host) {
  if (!host) return;
  const list = jubilees(60);
  if (!list.length) { host.innerHTML = ''; return; }
  const icon = { geb: '🎂', hochzeit: '💍', gedenken: '🕯' };
  host.innerHTML = `<div class="card"><h2>Jubiläen in den nächsten 60 Tagen</h2>${list.slice(0, 8).map(j => `
    <a class="bday-row${j.inDays === 0 ? ' today' : ''}" href="#/p/${esc(j.p.id)}">
      <div class="bday-date"><b>${j.next.getDate()}</b><span>${MON3[j.next.getMonth()]}</span></div>
      <span class="jub-ic" aria-hidden="true">${icon[j.kind]}</span>
      <div class="who"><b class="jub-t">${esc(j.title)}</b><small>${esc(j.who)}</small></div>
      <span class="when${j.inDays < 7 ? ' soon' : ''}">${whenText(j.inDays)}</span></a>`).join('')}</div>`;
}

// ================= Karte =================
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js'; s.onload = resolve; s.onerror = () => reject(new Error('Karte konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}
const placeKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function viewMap(main) {
  const filter = LS.get('stb.mapfilter', 'alle');
  main.innerHTML = `<div class="page map-page">
    <div class="page-head"><div><div class="eyebrow">Wo die Familie herkommt</div><h1>Karte der Orte</h1></div>
      <div class="seg" role="group" aria-label="Filter">${[['alle', 'Alle'], ['geboren', 'Geburtsorte'], ['wohnt', 'Wohnorte'], ['gestorben', 'Sterbeorte']].map(([k, t]) => `<button data-mf="${k}" aria-pressed="${filter === k}">${t}</button>`).join('')}</div></div>
    <div class="map-grid"><div id="map" class="map"></div><aside class="card map-side" id="mapSide"><div class="empty">Lädt …</div></aside></div>
    <div id="mapAdmin"></div></div>`;
  let data;
  try { [data] = await Promise.all([api('GET', '/api/orte'), loadLeaflet()]); }
  catch (e) { $('#mapSide').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  // Personen je Ort sammeln
  const byPlace = new Map();
  const add = (name, p, type) => {
    const k = placeKey(name); if (!k) return;
    if (!byPlace.has(k)) byPlace.set(k, { name: name.trim(), persons: [] });
    byPlace.get(k).persons.push({ p, type });
  };
  for (const p of S.persons) {
    if (p.birthPlace) add(p.birthPlace, p, 'geboren');
    if (p.deathPlace) add(p.deathPlace, p, 'gestorben');
    if (p.city) add(p.city, p, p.death ? 'wohnte' : 'wohnt');
  }
  const coords = new Map(data.places.map(pl => [pl.key, pl]));
  const map = L.map('map', { scrollWheelZoom: true, worldCopyJump: true });
  L.tileLayer(data.kacheln, { attribution: esc(data.quelle), maxZoom: 18 }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const typeTxt = { geboren: 'geboren', gestorben: 'gestorben', wohnt: 'wohnt', wohnte: 'wohnte' };
  let pickFor = null;

  function draw(f) {
    layer.clearLayers();
    const shown = [];
    for (const [k, pl] of byPlace) {
      const entries = pl.persons.filter(x => f === 'alle' || x.type === f || (f === 'wohnt' && x.type === 'wohnte'));
      if (!entries.length) continue;
      const c = coords.get(k);
      shown.push({ k, pl, entries, c });
      if (!c || c.lat === undefined || c.lat === null) continue;
      const n = new Set(entries.map(e => e.p.id)).size;
      const m = L.circleMarker([c.lat, c.lon], { radius: Math.min(26, 6 + Math.sqrt(n) * 4), color: '#8c2a21', weight: 1.5, fillColor: '#B4352A', fillOpacity: 0.55 }).addTo(layer);
      m.bindTooltip(`${esc(pl.name)} · ${n}`, { direction: 'top' });
      m.bindPopup(() => `<div class="map-pop"><b>${esc(pl.name)}</b>${groupEntries(entries)}${isAdmin() ? `<button class="btn sm" data-fix="${esc(k)}">Position korrigieren</button>` : ''}</div>`, { maxWidth: 320 });
    }
    const pts = shown.filter(s => s.c && s.c.lat !== undefined && s.c.lat !== null).map(s => [s.c.lat, s.c.lon]);
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 9 }); else map.setView([51.2, 10.4], 5);
    shown.sort((a, b) => new Set(b.entries.map(e => e.p.id)).size - new Set(a.entries.map(e => e.p.id)).size);
    const located = shown.filter(s => s.c && s.c.lat !== undefined && s.c.lat !== null);
    $('#mapSide').innerHTML = `<h2>${shown.length} Orte</h2>
      ${data.job && data.job.running ? `<p class="hint">Orte werden gerade nachgeschlagen (${data.job.done}/${data.job.total}) …</p>` : ''}
      <ol class="place-list">${shown.map(s => `<li><button data-goto="${esc(s.k)}"${s.c && s.c.lat !== undefined && s.c.lat !== null ? '' : ' disabled title="Noch ohne Koordinaten"'}><b>${esc(s.pl.name)}</b><span>${new Set(s.entries.map(e => e.p.id)).size}</span></button></li>`).join('')}</ol>
      ${shown.length - located.length ? `<p class="hint">${shown.length - located.length} Orte noch ohne Position.</p>` : ''}`;
  }
  function groupEntries(entries) {
    const groups = {};
    for (const e of entries) (groups[e.type] = groups[e.type] || []).push(e.p);
    return Object.entries(groups).map(([t, ps]) => `<div class="pop-g"><small>${typeTxt[t]}</small>${[...new Map(ps.map(p => [p.id, p])).values()].sort((a, b) => sortKey(a.birth) - sortKey(b.birth)).map(p => `<a href="#/p/${esc(p.id)}">${esc(fullName(p))}</a> <span class="muted">${esc(lifespan(p))}</span>`).join('<br>')}</div>`).join('');
  }
  draw(filter);
  main.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mf]'); if (!b) return;
    LS.set('stb.mapfilter', b.dataset.mf); $$('[data-mf]', main).forEach(x => x.setAttribute('aria-pressed', x === b)); draw(b.dataset.mf);
  });
  $('#mapSide').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    const c = coords.get(b.dataset.goto); if (c) { map.setView([c.lat, c.lon], 11); layer.eachLayer(l => { const ll = l.getLatLng(); if (ll.lat === c.lat && ll.lng === c.lon) l.openPopup(); }); }
  });
  // Verwaltung: fehlende Orte, Koordinaten per Klick setzen
  map.getContainer().addEventListener('click', (e) => { const b = e.target.closest('[data-fix]'); if (b) { pickFor = b.dataset.fix; map.closePopup(); toast('Jetzt auf die richtige Stelle in der Karte klicken'); } });
  map.on('click', async (e) => {
    if (!pickFor) return;
    const pl = byPlace.get(pickFor); const k = pickFor; pickFor = null;
    try {
      await api('PUT', '/api/orte', { name: pl.name, lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) });
      coords.set(k, { key: k, name: pl.name, lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5), status: 'manuell' });
      toast(`${pl.name} gesetzt`); draw(LS.get('stb.mapfilter', 'alle')); renderMapAdmin();
    } catch (err) { toast(err.message, true); }
  });
  function renderMapAdmin() {
    if (!isAdmin()) return;
    const missing = [...byPlace.entries()].filter(([k]) => { const c = coords.get(k); return !c || c.lat === undefined || c.lat === null; });
    $('#mapAdmin').innerHTML = `<div class="card" style="margin-top:16px"><h2>Orte verwalten</h2>
      <p class="hint" style="margin-top:0">Positionen werden automatisch über OpenStreetMap (Nominatim) nachgeschlagen. Falsch erkannte Orte im Popup über „Position korrigieren“ anpassen.</p>
      <div class="btn-row"><button class="btn" id="geoRun">Fehlende Orte jetzt nachschlagen</button></div>
      ${missing.length ? `<h3 style="font-size:15px;margin:14px 0 6px">Ohne Position (${missing.length})</h3><div class="chips">${missing.map(([k, pl]) => `<button class="btn sm" data-setpos="${esc(k)}">${esc(pl.name)} – setzen</button>`).join('')}</div>` : '<p class="hint">Alle Orte haben eine Position.</p>'}</div>`;
    $('#geoRun').onclick = async () => { await api('POST', '/api/orte/nachschlagen', {}); toast('Nachschlagen gestartet – das dauert etwa 1 Sekunde pro Ort'); setTimeout(() => viewMap(main), 4000); };
    $('#mapAdmin').onclick = (e) => { const b = e.target.closest('[data-setpos]'); if (b) { pickFor = b.dataset.setpos; toast(`Auf die Position von „${byPlace.get(pickFor).name}“ klicken`); map.getContainer().scrollIntoView({ behavior: 'smooth' }); } };
  }
  renderMapAdmin();
  if (data.job && data.job.running) setTimeout(() => { if (location.hash.startsWith('#/karte')) viewMap(main); }, 8000);
}

// ================= Poster / PDF =================
const PAPER = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

function posterLayout(roots, opt) {
  const W = 220, COL = 262, GAP = 10, ROW_MAIN = 38, ROW_P = 32;
  const boxes = [], links = [];
  let maxDepth = 0;
  function h(u) { return 8 + ROW_MAIN + (opt.partners ? (u.partners || []).length * ROW_P : 0); }
  function place(u, depth, top) {
    maxDepth = Math.max(maxDepth, depth);
    const kids = depth + 1 < opt.maxGen ? (u.kids || []) : [];
    const box = { u, depth, x: depth * COL, h: h(u), y: top };
    boxes.push(box);
    if (!kids.length) return top + box.h;
    let cursor = top; const kb = [];
    for (const k of kids) { const before = boxes.length; const bottom = place(k, depth + 1, cursor); kb.push(boxes[before]); cursor = bottom + GAP; }
    const first = kb[0], last = kb[kb.length - 1];
    box.y = Math.max(top, (first.y + 20 + last.y + 20) / 2 - 20);
    for (const c of kb) links.push([box, c]);
    return Math.max(cursor - GAP, box.y + box.h);
  }
  let y = 0;
  for (const r of roots) y = place(r, 0, y) + 24;
  return { boxes, links, width: (maxDepth + 1) * COL - (COL - W), height: y - 24, W, ROW_MAIN, ROW_P };
}

function posterSvg(opt) {
  const roots = opt.stem ? [stemUnit(opt.stem)] : opt.start ? [unitOf(S.byId.get(opt.start))] : S.roots.map(unitOf);
  const L = posterLayout(roots, opt);
  const M = 40, TH = opt.title ? 96 : 20, FH = 36;
  const Wt = L.width + 2 * M, Ht = L.height + TH + FH + M;
  const col = opt.color ? { line: '#78868D', box: '#FFFFFF', boxLine: '#C9D2D6', ink: '#17242C', sub: '#5d6b72', accent: '#B4352A', gone: '#F3F5F5', head: '#24546B' }
    : { line: '#777', box: '#FFF', boxLine: '#999', ink: '#000', sub: '#444', accent: '#000', gone: '#F2F2F2', head: '#000' };
  const t = (s, max) => { s = String(s || ''); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
  const line = (p, x, y, main) => {
    const name = `${p.firstName || '?'} ${p.lastName || ''}`.trim();
    const sub = [opt.dates ? lifespan(p) : '', opt.places ? (p.birthPlace || p.city || '') : '', p.birthName ? 'geb. ' + p.birthName : ''].filter(Boolean).join(' · ');
    return `<text x="${x}" y="${y}" font-size="${main ? 13.5 : 12.5}" font-weight="${main ? 600 : 400}" fill="${col.ink}" font-family="Literata, Georgia, serif">${esc(t(name, main ? 28 : 27))}<title>${esc(fullName(p))}</title></text>
      ${sub ? `<text x="${x}" y="${y + 14}" font-size="10.5" fill="${col.sub}" font-family="'IBM Plex Sans', Arial, sans-serif">${esc(t(sub, 38))}</text>` : ''}`;
  };
  let out = '';
  for (const [a, b] of L.links) {
    const x1 = M + a.x + L.W, y1 = TH + a.y + 22, x2 = M + b.x, y2 = TH + b.y + 22, xm = x1 + (x2 - x1) / 2;
    out += `<path d="M${x1} ${y1} H${xm} V${y2} H${x2}" fill="none" stroke="${col.line}" stroke-width="1.2"/>`;
  }
  for (const b of L.boxes) {
    const x = M + b.x, y = TH + b.y, u = b.u;
    const p = u.main;
    out += `<rect x="${x}" y="${y}" width="${L.W}" height="${b.h}" rx="7" fill="${p && p.death ? col.gone : col.box}" stroke="${col.boxLine}"/>`;
    if (p) out += line(p, x + 10, y + 20, true); else out += `<text x="${x + 10}" y="${y + 24}" font-size="12" font-style="italic" fill="${col.sub}">${esc(u.placeholder || '')}</text>`;
    if (p && p.id === S.me && opt.color) out += `<rect x="${x}" y="${y}" width="4" height="${L.ROW_MAIN}" fill="${col.accent}"/>`;
    if (opt.partners) (u.partners || []).forEach((s, i) => {
      const py = y + 8 + L.ROW_MAIN + i * L.ROW_P;
      out += `<line x1="${x + 8}" y1="${py - 2}" x2="${x + L.W - 8}" y2="${py - 2}" stroke="${col.boxLine}" stroke-dasharray="3 3"/>`;
      out += `<text x="${x + 10}" y="${py + 15}" font-size="12" fill="${col.sub}">${s.divorced ? '⚮' : '⚭'}</text>` + line(s, x + 26, py + 14, false);
    });
  }
  const today = new Date().toLocaleDateString('de-DE');
  const head = opt.title ? `<text x="${M}" y="52" font-size="34" font-weight="600" fill="${col.head}" font-family="Literata, Georgia, serif">${esc(opt.title)}</text>
    ${opt.subtitle ? `<text x="${M}" y="78" font-size="15" fill="${col.sub}" font-style="italic" font-family="Literata, Georgia, serif">${esc(opt.subtitle)}</text>` : ''}` : '';
  const foot = `<text x="${M}" y="${Ht - 14}" font-size="10" fill="${col.sub}" font-family="'IBM Plex Sans', Arial, sans-serif">Stand ${today} · ${L.boxes.length} Familien · Familien-Stammbaum${S.version && S.version.version ? ' v' + esc(S.version.version) : ''}</text>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Wt} ${Ht}" width="${Wt}" height="${Ht}"><rect width="100%" height="100%" fill="#fff"/>${head}${out}${foot}</svg>`, w: Wt, h: Ht };
}

function descendantList(opt) {
  const roots = opt.stem ? [stemUnit(opt.stem)] : opt.start ? [unitOf(S.byId.get(opt.start))] : S.roots.map(unitOf);
  const rows = [];
  const walk = (u, num, depth) => {
    if (depth >= opt.maxGen) return;
    const p = u.main;
    const who = p ? `<b>${esc(fullName(p))}</b>${p.birthName ? ' geb. ' + esc(p.birthName) : ''} <span class="dl-d">${esc([p.birth && '* ' + p.birth + (p.birthPlace ? ' in ' + p.birthPlace : ''), p.death && '† ' + p.death].filter(Boolean).join('  '))}</span>` : `<i>${esc(u.placeholder || '')}</i>`;
    const parts = (u.partners || []).map(s => `${s.divorced ? '⚮' : '⚭'}${s.marriage ? ' ' + esc(s.marriage) : ''} ${esc(fullName(s))}${s.birthName ? ' geb. ' + esc(s.birthName) : ''} <span class="dl-d">${esc(lifespan(s))}</span>`).join('<br>');
    rows.push(`<div class="dl-row" style="padding-left:${depth * 18}px"><span class="dl-n">${num}</span><div>${who}${parts ? `<div class="dl-p">${parts}</div>` : ''}</div></div>`);
    (u.kids || []).forEach((k, i) => walk(k, `${num}.${i + 1}`, depth + 1));
  };
  roots.forEach((r, i) => walk(r, String(i + 1), 0));
  return `<div class="dl"><h1>${esc(opt.title || 'Nachfahrenliste')}</h1>${opt.subtitle ? `<p class="dl-sub">${esc(opt.subtitle)}</p>` : ''}${rows.join('')}<p class="dl-foot">Stand ${new Date().toLocaleDateString('de-DE')}</p></div>`;
}

function viewPoster(main, stemArg) {
  const saved = LS.get('stb.poster', {});
  const opt = Object.assign({ format: 'A1', orient: 'quer', title: S.title, subtitle: '', dates: true, places: false, partners: true, color: true, maxGen: 99 }, saved, { stem: stemArg && S.byId.has(stemArg) ? stemArg : saved.stem || '', start: saved.start || '' });
  if (opt.stem && !S.byId.has(opt.stem)) opt.stem = '';
  const stems = stemList();
  main.innerHTML = `<div class="page poster-page">
    <div class="page-head"><div><div class="eyebrow">Zum Ausdrucken</div><h1>Poster &amp; PDF</h1></div>
      <div class="btn-row"><button class="btn primary" id="pPrint">Drucken / als PDF speichern</button><button class="btn" id="pSvg">SVG herunterladen</button><button class="btn" id="pList">Nachfahrenliste drucken</button></div></div>
    <div class="poster-grid">
      <form class="card poster-opts" id="pForm">
        <label class="fld"><span>Stamm</span><select class="input" name="stem"><option value="">${esc(S.title.replace(/^Stammbaum\s+/i, '') || 'Hauptstamm')}</option>${stems.map(P => `<option value="${esc(P.id)}"${opt.stem === P.id ? ' selected' : ''}>${esc(stemName(P))} (Herkunft von ${esc(fullName(P))})</option>`).join('')}</select></label>
        <label class="fld"><span>Ab Person (optional)</span><input class="input" id="pStart" value="${esc(opt.start && S.byId.get(opt.start) ? fullName(S.byId.get(opt.start)) : '')}" placeholder="ganzer Stamm"></label>
        <div class="form-grid">
          <label class="fld"><span>Format</span><select class="input" name="format">${Object.keys(PAPER).map(f => `<option${opt.format === f ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
          <label class="fld"><span>Ausrichtung</span><select class="input" name="orient"><option value="quer"${opt.orient === 'quer' ? ' selected' : ''}>Quer</option><option value="hoch"${opt.orient === 'hoch' ? ' selected' : ''}>Hoch</option></select></label>
        </div>
        <label class="fld"><span>Titel</span><input class="input" name="title" value="${esc(opt.title)}"></label>
        <label class="fld"><span>Untertitel</span><input class="input" name="subtitle" value="${esc(opt.subtitle)}" placeholder="z. B. Familientreffen 2027"></label>
        <label class="fld"><span>Generationen</span><select class="input" name="maxGen">${[[99, 'alle'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']].map(([v, t]) => `<option value="${v}"${+opt.maxGen === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="partners"${opt.partners ? ' checked' : ''}> Partner zeigen</label>
        <label class="check"><input type="checkbox" name="dates"${opt.dates ? ' checked' : ''}> Lebensdaten</label>
        <label class="check"><input type="checkbox" name="places"${opt.places ? ' checked' : ''}> Orte</label>
        <label class="check"><input type="checkbox" name="color"${opt.color ? ' checked' : ''}> Farbig</label>
        <p class="hint" id="pHint"></p>
      </form>
      <div class="poster-prev card" id="pPrev"></div>
    </div></div>`;
  const form = $('#pForm');
  const read = () => {
    const fd = new FormData(form);
    Object.assign(opt, { stem: fd.get('stem'), format: fd.get('format'), orient: fd.get('orient'), title: fd.get('title'), subtitle: fd.get('subtitle'), maxGen: +fd.get('maxGen'),
      partners: !!fd.get('partners'), dates: !!fd.get('dates'), places: !!fd.get('places'), color: !!fd.get('color') });
    if (!$('#pStart').value.trim()) opt.start = '';
    if (opt.stem) opt.start = '';
    LS.set('stb.poster', opt);
  };
  const page = () => { const [a, b] = PAPER[opt.format]; return opt.orient === 'quer' ? [a, b] : [b, a]; };
  let cur;
  const render = () => {
    read();
    cur = posterSvg(opt);
    const [pw, ph] = page();
    const usable = [pw - 20, ph - 20];
    const scale = Math.min(usable[0] / cur.w, usable[1] / cur.h); // mm je Einheit
    const pt = 13.5 * scale * 2.835;
    $('#pPrev').innerHTML = `<div class="paper" style="aspect-ratio:${pw}/${ph}">${cur.svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" ')}</div>`;
    $('#pHint').innerHTML = `Namen im Druck ca. <b>${pt.toFixed(1)} pt</b> groß${pt < 6 ? ' – <span class="err">zu klein, größeres Format oder weniger Generationen wählen</span>' : pt < 8 ? ' – gut mit Lupe lesbar' : ''}.`;
  };
  form.addEventListener('change', render);
  form.addEventListener('input', (e) => { if (e.target.name === 'title' || e.target.name === 'subtitle') render(); });
  attachPicker($('#pStart'), (p) => { opt.start = p.kind === 'blood' ? p.id : ''; if (p.kind !== 'blood') toast('Bitte eine Person aus der Familie (nicht angeheiratet) wählen', true); form.stem.value = ''; render(); }, { filter: (p) => p.kind === 'blood' });
  render();
  const printWith = (html, size) => {
    const host = document.createElement('div'); host.id = 'printHost'; host.innerHTML = html; document.body.appendChild(host);
    const st = document.createElement('style'); st.id = 'printPage'; st.textContent = `@page { size: ${size}; margin: 10mm; }`; document.head.appendChild(st);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); host.remove(); st.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 60);
  };
  $('#pPrint').onclick = () => { const [pw, ph] = page(); printWith(`<div class="print-poster" style="width:${pw - 20}mm;height:${ph - 20}mm">${cur.svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" ')}</div>`, `${pw}mm ${ph}mm`); };
  $('#pList').onclick = () => printWith(descendantList(opt), 'A4 portrait');
  $('#pSvg').onclick = () => {
    const blob = new Blob([cur.svg], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stammbaum-poster-${new Date().toISOString().slice(0, 10)}.svg`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}

// ================= Verwaltung: Einstellungen =================
async function adminSettings(at) {
  const c = await api('GET', '/api/einstellungen');
  const n = c.ntfy, b = c.sicherung, k = c.karte;
  const chk = (name, on, label) => `<label class="check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
  const inp = (name, value, label, extra = '') => `<label class="fld"><span>${label}</span><input class="input" name="${name}" value="${esc(value ?? '')}" ${extra}></label>`;
  const last = b.letzterLauf;
  at.innerHTML = `<form id="setForm" class="grid" style="gap:18px">
    <div class="card"><h2>Benachrichtigungen (ntfy)</h2>
      <p class="hint" style="margin-top:0">Push-Nachrichten aufs Handy über <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a> – öffentlicher Server oder eigener (z. B. als Docker-Container). In der ntfy-App das gleiche Topic abonnieren.</p>
      <div class="form-grid">
        ${chk('ntfy.aktiv', n.aktiv, 'Benachrichtigungen aktiv')}<span></span>
        ${inp('ntfy.server', n.server, 'Server', 'placeholder="https://ntfy.sh"')}${inp('ntfy.topic', n.topic, 'Topic', 'placeholder="z. B. stammbaum-familie-x7k2"')}
        ${inp('ntfy.token', n.token, 'Zugangs-Token (optional)', 'autocomplete="off"')}
        <label class="fld"><span>Priorität</span><select class="input" name="ntfy.prioritaet">${[['min', 'sehr niedrig'], ['low', 'niedrig'], ['default', 'normal'], ['high', 'hoch'], ['urgent', 'dringend']].map(([v, t]) => `<option value="${v}"${n.prioritaet === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${inp('ntfy.benutzer', n.benutzer, 'oder Benutzer', 'autocomplete="off"')}${inp('ntfy.passwort', n.passwort, 'Passwort', 'type="password" autocomplete="new-password"')}
      </div>
      <div class="fld-label" style="margin-top:12px">Benachrichtigen bei</div>
      <div class="btn-row">${chk('ntfy.ereignisse.vorschlag', n.ereignisse.vorschlag, 'neuem Vorschlag')}${chk('ntfy.ereignisse.import', n.ereignisse.import, 'Import')}${chk('ntfy.ereignisse.sicherungFehler', n.ereignisse.sicherungFehler, 'Sicherung fehlgeschlagen')}${chk('ntfy.ereignisse.sicherungOk', n.ereignisse.sicherungOk, 'Sicherung erfolgreich')}</div>
      <div class="btn-row" style="margin-top:12px"><button type="button" class="btn" id="ntfyTest">Test-Nachricht senden</button></div>
      <p class="hint">Tipp: Ein schwer zu erratendes Topic wählen – wer es kennt, kann mitlesen.</p></div>

    <div class="card"><h2>Externe Sicherung</h2>
      <p class="hint" style="margin-top:0">Einmal täglich wird ein Komplettarchiv (Daten, Fotos, Quellen, Protokoll) als <code>.tar.gz</code> erstellt und übertragen. Uhrzeit gilt in der Zeitzone des Containers (<code>TZ=Europe/Berlin</code> setzen).</p>
      <div class="form-grid">
        ${chk('sicherung.aktiv', b.aktiv, 'Tägliche Sicherung aktiv')}<span></span>
        <label class="fld"><span>Ziel</span><select class="input" name="sicherung.ziel" id="bkZiel">${[['ordner', 'Ordner (z. B. NAS-Freigabe als Volume)'], ['webdav', 'WebDAV (Nextcloud, Synology …)'], ['s3', 'S3-kompatibel (Backblaze, Hetzner, MinIO …)']].map(([v, t]) => `<option value="${v}"${b.ziel === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="form-grid" style="grid-column:auto;gap:12px">${inp('sicherung.uhrzeit', b.uhrzeit, 'Uhrzeit', 'placeholder="03:30"')}${inp('sicherung.behalten', b.behalten, 'Anzahl behalten', 'type="number" min="1" max="365"')}</div>
      </div>
      <div class="bk-ziel" data-z="ordner"><div class="form-grid">${inp('sicherung.ordner.pfad', b.ordner.pfad, 'Ordner im Container', 'placeholder="/backup"')}</div>
        <p class="hint">Im Stack ein Volume einbinden, z. B. <code>- /mnt/nas/stammbaum:/backup</code>.</p></div>
      <div class="bk-ziel" data-z="webdav"><div class="form-grid">${inp('sicherung.webdav.url', b.webdav.url, 'WebDAV-Ordner-URL', 'placeholder="https://cloud.example.de/remote.php/dav/files/max/Backups/Stammbaum/"')}<span></span>
        ${inp('sicherung.webdav.benutzer', b.webdav.benutzer, 'Benutzer', 'autocomplete="off"')}${inp('sicherung.webdav.passwort', b.webdav.passwort, 'Passwort / App-Passwort', 'type="password" autocomplete="new-password"')}</div></div>
      <div class="bk-ziel" data-z="s3"><div class="form-grid">${inp('sicherung.s3.endpoint', b.s3.endpoint, 'Endpoint', 'placeholder="https://s3.eu-central-003.backblazeb2.com"')}${inp('sicherung.s3.region', b.s3.region, 'Region')}
        ${inp('sicherung.s3.bucket', b.s3.bucket, 'Bucket')}${inp('sicherung.s3.praefix', b.s3.praefix, 'Präfix (Ordner)')}
        ${inp('sicherung.s3.accessKey', b.s3.accessKey, 'Access Key', 'autocomplete="off"')}${inp('sicherung.s3.secretKey', b.s3.secretKey, 'Secret Key', 'type="password" autocomplete="new-password"')}
        ${chk('sicherung.s3.pathStyle', b.s3.pathStyle, 'Path-Style-Adressen (für MinIO u. a.)')}</div></div>
      <div class="bk-status">${last ? `Letzte Sicherung: <b>${fmtTime(last.at)}</b> – ${last.ok ? `<span class="pill ok">erfolgreich</span> ${esc(last.datei || '')} (${((last.groesse || 0) / 1048576).toFixed(1)} MB)` : `<span class="pill warn">fehlgeschlagen</span> ${esc(last.meldung || '')}`}` : 'Noch keine Sicherung gelaufen.'}</div>
      <div class="btn-row" style="margin-top:12px"><button type="button" class="btn" id="bkNow">Jetzt sichern</button><a class="btn" href="/api/sicherung/archiv.tar.gz">Komplettarchiv herunterladen</a></div></div>

    <div class="card"><h2>Karte</h2><div class="form-grid">
      ${inp('karte.kacheln', k.kacheln, 'Kartenkacheln (URL)')}${inp('karte.quelle', k.quelle, 'Quellenangabe')}
      ${inp('karte.laender', k.laender, 'Ortssuche auf Länder beschränken', 'placeholder="z. B. de,at,ch – leer = weltweit"')}
      ${chk('karte.automatisch', k.automatisch, 'Neue Orte automatisch nachschlagen')}</div></div>

    <div class="card"><h2>Allgemein</h2><div class="form-grid">
      ${inp('allgemein.adresse', c.allgemein.adresse, 'Öffentliche Adresse', 'placeholder="https://stammbaum.example.de"')}
      <p class="hint" style="align-self:end">Wird für Links in Benachrichtigungen verwendet.</p></div></div>

    <div class="btn-row"><button class="btn primary" id="setSave">Einstellungen speichern</button><span class="err" id="setErr"></span></div>
  </form>`;
  const form = $('#setForm');
  const syncZiel = () => $$('.bk-ziel', form).forEach(d => { d.hidden = d.dataset.z !== $('#bkZiel').value; });
  $('#bkZiel').onchange = syncZiel; syncZiel();
  const collect = () => {
    const out = {};
    const set = (path, v) => { const ks = path.split('.'); let o = out; ks.slice(0, -1).forEach(k2 => (o = o[k2] = o[k2] || {})); o[ks[ks.length - 1]] = v; };
    for (const el of form.elements) {
      if (!el.name || !el.name.includes('.')) continue;
      set(el.name, el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim());
    }
    return out;
  };
  const save = async () => { await api('PUT', '/api/einstellungen', collect()); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await save(); toast('Einstellungen gespeichert'); $('#setErr').textContent = ''; } catch (err) { $('#setErr').textContent = err.message; }
  };
  $('#ntfyTest').onclick = async () => {
    try { await save(); await api('POST', '/api/einstellungen/ntfy-test', {}); toast('Test-Nachricht gesendet – kam sie an?'); } catch (err) { toast(err.message, true); }
  };
  $('#bkNow').onclick = async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Sichert …';
    try { await save(); await api('POST', '/api/sicherung/jetzt', {}); toast('Sicherung erfolgreich'); } catch (err) { toast(err.message, true); }
    adminSettings(at);
  };
}

// ================= Verwaltung: Dubletten =================
const MERGE_FIELDS = ['firstName', 'lastName', 'birthName', 'sex', 'birth', 'birthPlace', 'death', 'deathPlace', 'street', 'zip', 'city', 'notes'];
async function adminDupes(at) {
  await loadData();
  const list = await api('GET', '/api/dubletten');
  const pairs = list.filter(x => S.byId.has(x.a) && S.byId.has(x.b));
  const relCount = (p) => childrenOf(p).length + partnersOf(p).length + parentsOf(p).length + S.sources.filter(s => (s.personIds || []).includes(p.id)).length;
  const card = (x) => {
    const a = S.byId.get(x.a), b = S.byId.get(x.b);
    const side = (p) => `<div class="dup-side">${chip(p)}<div class="hint">${esc(relLabel(p) || 'Familie')} · ${relCount(p)} Verbindungen</div></div>`;
    return `<div class="card dup" data-a="${esc(a.id)}" data-b="${esc(b.id)}"><div class="dup-pair">${side(a)}<span class="dup-vs">≈</span>${side(b)}</div>
      <div class="btn-row">${x.sameKind ? '<button class="btn primary sm" data-dm>Zusammenführen …</button>' : '<span class="hint">Unterschiedliche Art (z. B. Familie/Partner) – erst umhängen, dann zusammenführen.</span>'}<button class="btn sm" data-di>Keine Dublette</button></div></div>`;
  };
  at.innerHTML = `<p class="muted">Personen mit gleichem Vornamen, passendem Nachnamen und Geburtsjahr. Beim Zusammenführen wandern Kinder, Partner, Quellen und Fotos zur verbleibenden Person.</p>
    ${pairs.length ? pairs.map(card).join('') : '<div class="card empty">Keine möglichen Dubletten gefunden. 🎉</div>'}`;
  at.onclick = async (e) => {
    const c = e.target.closest('.dup'); if (!c) return;
    if (e.target.closest('[data-di]')) { await api('POST', '/api/dubletten/ignorieren', { a: c.dataset.a, b: c.dataset.b }); c.remove(); toast('Wird nicht mehr angezeigt'); }
    if (e.target.closest('[data-dm]')) openMergeDialog(S.byId.get(c.dataset.a), S.byId.get(c.dataset.b), relCount);
  };
}
function openMergeDialog(a, b, relCount) {
  if (relCount(b) > relCount(a)) [a, b] = [b, a];
  const fmt = (k, v) => (k === 'sex' ? ({ m: 'männlich', w: 'weiblich', d: 'divers' })[v] || '' : v || '');
  const rows = MERGE_FIELDS.filter(k => (a[k] || '') !== (b[k] || ''));
  const pick = (k) => { const va = a[k] || '', vb = b[k] || ''; if (!va) return 'b'; if (!vb) return 'a'; return vb.length > va.length && ['birth', 'death'].includes(k) ? 'b' : 'a'; };
  const dlg = dialog(`<form id="mf"><div class="dlg-head"><h2>Zusammenführen</h2><p>Bleibt erhalten: <b>${esc(fullName(a))}</b> (mit ${relCount(a)} Verbindungen). Alles von ${esc(fullName(b))} wird übertragen, danach wird der doppelte Eintrag gelöscht.</p></div>
    <div class="dlg-body">${rows.length ? `<table class="diff merge"><tr><td></td><td><b>${esc(fullName(a))}</b></td><td><b>${esc(fullName(b))}</b></td></tr>
      ${rows.map(k => `<tr><td>${esc(FIELD_LABELS[k] || k)}</td>${['a', 'b'].map(s => `<td><label class="check"><input type="radio" name="${k}" value="${s}"${pick(k) === s ? ' checked' : ''}> ${esc(fmt(k, (s === 'a' ? a : b)[k])) || '<span class="muted">(leer)</span>'}</label></td>`).join('')}</tr>`).join('')}</table>`
      : '<p>Alle Angaben sind gleich.</p>'}
      <label class="check" style="margin-top:12px"><input type="checkbox" name="swap"> Stattdessen ${esc(fullName(b))} als Haupteintrag behalten</label>
      <div class="err" id="mfErr"></div></div>
    <div class="dlg-foot"><button type="button" class="btn" data-cancel>Abbrechen</button><button class="btn primary">Zusammenführen</button></div></form>`);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  $('#mf', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const swap = !!fd.get('swap');
    const keep = swap ? b : a, drop = swap ? a : b;
    const fields = {};
    for (const k of rows) fields[k] = (fd.get(k) === 'a' ? a : b)[k] || '';
    try { await api('POST', '/api/dubletten/zusammenfuehren', { keepId: keep.id, dropId: drop.id, fields }); dlg.close(); toast('Zusammengeführt'); await loadData(); shell(); router(); }
    catch (err) { $('#mfErr', dlg).textContent = err.message; }
  };
}

// ================= Verwaltung: GEDCOM =================
const GED = { token: null, plan: null, overrides: {}, rootGedId: null, file: '' };
function adminGedcom(at) {
  at.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><h2>Exportieren</h2><p class="hint" style="margin-top:0">GEDCOM 5.5.1 (UTF-8) – lässt sich in Ancestry, MyHeritage, Gramps, FamilySearch u. a. einlesen.</p>
      <a class="btn primary" href="/api/export.ged">GEDCOM herunterladen</a></div>
    <div class="card"><h2>Importieren &amp; abgleichen</h2><p class="hint" style="margin-top:0">Die Datei wird zuerst mit dem Stammbaum abgeglichen. Du siehst, wer erkannt wurde, was ergänzt würde und wer neu dazukommt – und entscheidest selbst. Vorher wird automatisch gesichert.</p>
      <input type="file" accept=".ged,.gedcom,text/plain" id="gedFile"><div class="err" id="gedErr" style="margin-top:8px"></div></div>
  </div><div id="gedPlan"></div>`;
  $('#gedFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#gedErr').textContent = '';
    try {
      const buf = await f.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
      Object.assign(GED, { token: null, overrides: {}, rootGedId: null, file: f.name });
      $('#gedPlan').innerHTML = '<div class="card empty">Wird abgeglichen …</div>';
      await gedPreview({ text });
    } catch (err) { $('#gedErr').textContent = err.message; $('#gedPlan').innerHTML = ''; }
  };
  if (GED.plan) renderGedPlan();
}
async function gedPreview(extra = {}) {
  const r = await api('POST', '/api/gedcom/vorschau', Object.assign({ token: GED.token, overrides: GED.overrides, rootGedId: GED.rootGedId }, extra));
  GED.token = r.token; GED.plan = r;
  renderGedPlan();
}
function renderGedPlan() {
  const P = GED.plan, host = $('#gedPlan'); if (!host || !P) return;
  const fmtD = (k, v) => (k === 'sex' ? ({ m: 'männlich', w: 'weiblich' })[v] || v : v);
  const matchRows = P.matches.map(m => {
    const p = S.byId.get(m.personId);
    const diffs = Object.entries(m.diffs);
    return `<div class="ged-m" data-g="${esc(m.gedId)}">
      <div class="ged-head"><span><b>${esc(m.gedName)}</b> ${m.gedBirth ? `<span class="muted">* ${esc(m.gedBirth)}</span>` : ''} → ${p ? `<a href="#/p/${esc(p.id)}" target="_blank">${esc(fullName(p))}</a> <span class="muted">${esc(lifespan(p))}</span>` : '?'}</span>
        <select class="input sm ged-ov" aria-label="Zuordnung ändern"><option value="">Zuordnung behalten</option>${m.alternatives.map(a2 => `<option value="${esc(a2.personId)}">stattdessen: ${esc(fullName(S.byId.get(a2.personId)))} ${esc(lifespan(S.byId.get(a2.personId)))}</option>`).join('')}<option value="__neu">keine – als neue Person behandeln</option></select></div>
      ${diffs.length ? `<table class="diff">${diffs.map(([k, d]) => `<tr><td><label class="check"><input type="checkbox" data-uk="${esc(k)}"${d.fill ? ' checked' : ''}> ${esc(FIELD_LABELS[k] || k)}</label></td><td>${d.ours ? `<del>${esc(fmtD(k, d.ours))}</del> ` : ''}<ins>${esc(fmtD(k, d.theirs))}</ins>${d.fill ? '' : ' <span class="pill warn">abweichend</span>'}</td></tr>`).join('')}</table>` : '<div class="hint">Keine neuen Angaben.</div>'}</div>`;
  }).join('');
  const addRows = P.adds.map(a => `<label class="ged-a check" data-k="${esc(a.key)}" data-dep="${esc((a.dependsOn || []).join(','))}"><input type="checkbox" checked>
    <span><b>${esc(a.name || '(ohne Namen)')}</b> <span class="muted">${esc([a.birth && '* ' + a.birth, a.death && '† ' + a.death].filter(Boolean).join(' '))}</span><br><small>${esc(a.relText || '')}</small></span></label>`).join('');
  const un = P.unattached.map(u => `<li>${esc(u.name)} ${u.birth ? `<span class="muted">* ${esc(u.birth)}</span>` : ''}
    <button class="btn sm ghost" data-root="${esc(u.gedId)}">als neue Stammlinie</button>
    ${u.candidates.length ? `<select class="input sm" data-umap="${esc(u.gedId)}"><option value="">zuordnen zu …</option>${u.candidates.map(c => `<option value="${esc(c.personId)}">${esc(fullName(S.byId.get(c.personId)))} ${esc(lifespan(S.byId.get(c.personId)))}</option>`).join('')}</select>` : ''}</li>`).join('');
  const nUpd = P.matches.reduce((n, m) => n + Object.values(m.diffs).filter(d => d.fill).length, 0);
  host.innerHTML = `<div class="card ged-sum"><h2>${esc(GED.file || 'GEDCOM-Datei')}</h2>
      <div class="stats"><div class="stat"><b>${P.total}</b><span>Personen in der Datei</span></div><div class="stat"><b>${P.matches.length}</b><span>erkannt</span></div><div class="stat"><b>${P.adds.length}</b><span>neu</span></div><div class="stat"><b>${P.unattached.length}</b><span>nicht zuordenbar</span></div></div>
      ${P.notes.length ? `<ul class="hint">${P.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="gedApply">Ausgewählte übernehmen</button><button class="btn" id="gedCancel">Verwerfen</button><span class="hint" id="gedCount"></span></div></div>
    ${P.matches.length ? `<div class="card"><h2>Erkannte Personen (${P.matches.length})</h2><p class="hint" style="margin-top:0">Fehlende Angaben sind vorausgewählt, abweichende nicht. ${nUpd} Ergänzungen vorgeschlagen.</p>${matchRows}</div>` : ''}
    ${P.adds.length ? `<div class="card"><h2>Neu hinzufügen (${P.adds.length})</h2><div class="btn-row" style="margin-bottom:8px"><button class="btn sm" data-all="1">alle</button><button class="btn sm" data-all="0">keine</button></div><div class="ged-adds">${addRows}</div></div>` : ''}
    ${P.unattached.length ? `<div class="card"><h2>Nicht zuordenbar (${P.unattached.length})</h2><p class="hint" style="margin-top:0">Diese Personen haben keine Verbindung zu erkannten Personen. Eine davon kann eine neue Stammlinie beginnen, oder sie lässt sich von Hand einer Person zuordnen.</p><ul class="ged-un">${un}</ul></div>` : ''}`;
  const count = () => { $('#gedCount').textContent = `${$$('.ged-a input:checked', host).length} neue Personen, ${$$('[data-uk]:checked', host).length} Ergänzungen`; };
  count();
  // Abwählen nimmt abhängige Personen mit
  host.querySelector('.ged-adds')?.addEventListener('change', (e) => {
    const lab = e.target.closest('.ged-a'); if (!lab) return;
    if (!e.target.checked) {
      const off = new Set([lab.dataset.k]); let grew = true;
      while (grew) { grew = false; for (const l of $$('.ged-a', host)) if (!off.has(l.dataset.k) && l.dataset.dep.split(',').some(d => off.has(d))) { off.add(l.dataset.k); l.querySelector('input').checked = false; grew = true; } }
    } else {
      // Anhaken setzt nötige Bezugspersonen mit an
      const need = (k) => { const l = host.querySelector(`.ged-a[data-k="${k}"]`); if (!l) return; l.querySelector('input').checked = true; l.dataset.dep.split(',').filter(Boolean).forEach(need); };
      need(lab.dataset.k);
    }
    count();
  });
  host.addEventListener('change', async (e) => {
    if (e.target.matches('[data-uk]')) return count();
    if (e.target.matches('.ged-ov') && e.target.value) {
      const g = e.target.closest('.ged-m').dataset.g;
      GED.overrides[g] = e.target.value === '__neu' ? null : e.target.value; await gedPreview();
    }
    if (e.target.matches('[data-umap]') && e.target.value) { GED.overrides[e.target.dataset.umap] = e.target.value; await gedPreview(); }
  });
  host.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-root]'); if (r) { GED.rootGedId = r.dataset.root; await gedPreview(); return; }
    const all = e.target.closest('[data-all]'); if (all) { $$('.ged-a input', host).forEach(i => (i.checked = all.dataset.all === '1')); count(); }
  });
  $('#gedCancel').onclick = () => { GED.plan = null; GED.token = null; host.innerHTML = ''; $('#gedFile').value = ''; };
  $('#gedApply').onclick = async (e) => {
    const adds = $$('.ged-a', host).filter(l => l.querySelector('input').checked).map(l => l.dataset.k);
    const updates = $$('.ged-m', host).map(m => ({ gedId: m.dataset.g, keys: $$('[data-uk]:checked', m).map(i => i.dataset.uk) })).filter(u => u.keys.length);
    if (!adds.length && !updates.length) { toast('Nichts ausgewählt', true); return; }
    if (!confirm(`${adds.length} Personen hinzufügen und ${updates.reduce((n, u) => n + u.keys.length, 0)} Angaben ergänzen?`)) return;
    e.target.disabled = true; e.target.textContent = 'Wird übernommen …';
    try {
      const r = await api('POST', '/api/gedcom/uebernehmen', { token: GED.token, overrides: GED.overrides, rootGedId: GED.rootGedId, adds, updates });
      GED.plan = null; GED.token = null;
      await loadData(); shell();
      if (location.hash !== '#/admin/gedcom') history.replaceState(null, '', '#/admin/gedcom');
      await router();
      const h = $('#gedPlan');
      if (h) h.innerHTML = `<div class="card"><h2>Import abgeschlossen</h2><p>${r.added} Personen hinzugefügt, ${r.updated} ergänzt.</p>${r.errors.length ? `<ul class="hint">${r.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="hint">Jede Änderung steht im Änderungsprotokoll. Vor dem Import wurde eine Sicherung angelegt (Ordner <code>backups</code>, Name „vor-gedcom-…“).</p></div>`;
      toast('Import abgeschlossen');
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Ausgewählte übernehmen'; }
  };
}
