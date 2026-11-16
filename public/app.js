'use strict';
/* Familien-Stammbaum – Oberfläche (ohne Framework) */

// ================= Grundlagen =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON3 = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const S = {
  role: null, title: '', persons: [], byId: new Map(), kids: new Map(), partners: new Map(), gen: new Map(),
  roots: [], me: LS.get('stb.me', null), icsPath: null, openSugg: 0, updatedAt: '',
  origins: new Map(), sources: [], sourceKinds: [], version: null,
};
const isAdmin = () => S.role === 'admin';

async function api(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  if (r.status === 401 && !url.endsWith('/login')) { S.role = null; renderLogin(); throw new Error('Bitte erneut anmelden'); }
  if (!r.ok) throw new Error((data && data.error) || `Fehler ${r.status}`);
  return data;
}

let toastT;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, bad ? 5000 : 2600);
}

// ================= Daten & Hilfen =================
function index(persons) {
  S.persons = persons;
  S.byId = new Map(persons.map(p => [p.id, p]));
  S.kids = new Map(); S.partners = new Map(); S.gen = new Map(); S.origins = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const p of persons) {
    if (p.kind === 'blood' && p.parentId && S.byId.has(p.parentId)) push(S.kids, p.parentId, p);
    if (p.kind === 'partner') push(S.partners, p.partnerOf, p);
    if (p.kind === 'origin' && S.byId.has(p.originOf)) push(S.origins, p.originOf, p);
  }
  const RO = { parent: 0, partnerOfParent: 1, sibling: 2, child: 3 };
  for (const list of S.origins.values()) list.sort((a, b) => (a.role === b.role ? sortKey(a.birth) - sortKey(b.birth) : (RO[a.role] ?? 0) - (RO[b.role] ?? 0)));
  for (const list of S.kids.values()) list.sort((a, b) => (a.order - b.order) || (sortKey(a.birth) - sortKey(b.birth)));
  for (const list of S.partners.values()) list.sort((a, b) => (a.order - b.order));
  S.roots = persons.filter(p => p.kind === 'blood' && (!p.parentId || !S.byId.has(p.parentId)));
  const walk = (p, g) => { S.gen.set(p.id, g); (S.partners.get(p.id) || []).forEach(s => S.gen.set(s.id, g)); (S.kids.get(p.id) || []).forEach(k => walk(k, g + 1)); };
  S.roots.forEach(r => walk(r, 0));
  for (const [pid, list] of S.origins) { const g = S.gen.get(pid); if (g !== undefined) list.forEach(o => S.gen.set(o.id, o.role === 'parent' || o.role === 'partnerOfParent' ? g - 1 : o.role === 'child' ? g + 1 : g)); }
  if (S.me && !S.byId.has(S.me)) { S.me = null; LS.set('stb.me', null); }
}

const FULL = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
function parseFull(s) { const m = FULL.exec(s || ''); return m ? { d: +m[1], m: +m[2], y: +m[3] } : null; }
function yearOf(s) { const m = /(\d{4})/.exec(s || ''); return m ? +m[1] : null; }
function sortKey(s) { const f = parseFull(s); if (f) return f.y * 10000 + f.m * 100 + f.d; const y = yearOf(s); return y ? y * 10000 : 99999999; }
function fullName(p) { return p ? ([p.firstName, p.lastName].filter(Boolean).join(' ') || '(ohne Namen)') : '?'; }
function initials(p) { return ((p.firstName || '?')[0] + ((p.lastName || '')[0] || '')).toUpperCase(); }
function ageNow(p) {
  const f = parseFull(p.birth); const y = f ? f.y : yearOf(p.birth); if (!y) return null;
  const now = new Date(); let a = now.getFullYear() - y;
  if (f && (now.getMonth() + 1 < f.m || (now.getMonth() + 1 === f.m && now.getDate() < f.d))) a--;
  return a;
}
// Ohne Sterbedatum, aber über 100 → für Geburtstage nicht berücksichtigen
function isLiving(p) { if (p.death) return false; const a = ageNow(p); return a === null || a <= 100; }
function lifespan(p) {
  const b = yearOf(p.birth), d = yearOf(p.death) || (p.death ? '?' : null);
  if (b && d) return `${b} – ${d}`;
  if (d) return `† ${d}`;
  if (b) return `* ${b}`;
  return '';
}
function genderOf(p) { return p.sex === 'w' ? 'w' : p.sex === 'm' ? 'm' : ''; }
function avatar(p, cls = '') {
  const g = p.sex === 'w' ? ' w' : '';
  const gone = p.death ? ' gone' : '';
  if (p.hasPhoto) return `<span class="mono${g}${gone} ${cls}"><img src="/api/fotos/${esc(p.id)}.jpg?v=${encodeURIComponent(p.updatedAt || '')}" alt="" loading="lazy"></span>`;
  return `<span class="mono${g}${gone} ${cls}" aria-hidden="true">${esc(initials(p))}</span>`;
}
function relLabel(p) {
  if (p.kind === 'partner') return 'Partner/in von ' + fullName(S.byId.get(p.partnerOf));
  if (p.kind === 'origin' && p.role === 'partnerOfParent') return 'Partner/in von ' + fullName(S.byId.get(p.partnerOfId)) + ' (Familie von ' + fullName(S.byId.get(p.originOf)) + ')';
  if (p.kind === 'origin' && p.role === 'sibling' && isHalfOrigin(p)) return 'Halbgeschwister von ' + fullName(S.byId.get(p.originOf));
  if (p.kind === 'origin') return (ROLE_TXT[p.role] || 'Elternteil') + ' von ' + fullName(S.byId.get(p.originOf));
  return '';
}
function chip(p, extra = '') {
  return `<a class="chip${p.id === S.me ? ' is-me' : ''}" href="#/p/${esc(p.id)}">${avatar(p)}<span>${esc(fullName(p))}${p.id === S.me ? ' (du)' : ''}<small>${esc([lifespan(p), extra].filter(Boolean).join(' · '))}</small></span></a>`;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
function searchText(p) { return norm([p.firstName, p.lastName, p.birthName, p.city, p.birthPlace, yearOf(p.birth)].join(' ')); }
const G = (sex, m, w, n) => sex === 'm' ? m : sex === 'w' ? w : n;
const ROLE_TXT = { parent: 'Elternteil', sibling: 'Geschwister', child: 'Kind aus anderer Beziehung', partnerOfParent: 'Partner/in eines Elternteils' };
// Eltern eines Geschwisters der Herkunftsfamilie (parentIds leer = beide Eltern)
const originSibParents = (o) => (o.parentIds && o.parentIds.length ? o.parentIds.map(id => S.byId.get(id)).filter(Boolean) : originParents(o.originOf));
const isHalfOrigin = (o) => !!(o.parentIds && o.parentIds.length) && originSibParents(o).map(x => x.id).sort().join() !== originParents(o.originOf).map(x => x.id).sort().join();
const originKids = (partnerId) => (S.origins.get(partnerId) || []).filter(o => o.role === 'child');
const originParents = (partnerId) => (S.origins.get(partnerId) || []).filter(o => o.role === 'parent');
function parentsOf(p) {
  if (!p) return [];
  if (p.kind === 'partner') return originParents(p.id);
  if (p.kind === 'origin') return p.role === 'sibling' ? originSibParents(p) : p.role === 'child' ? [S.byId.get(p.originOf)].filter(Boolean) : [];
  return [p.parentId, p.otherParentId].filter(id => id && S.byId.has(id)).map(id => S.byId.get(id));
}
function childrenOf(p) {
  if (p.kind === 'blood') return S.kids.get(p.id) || [];
  if (p.kind === 'origin' && (p.role === 'parent' || p.role === 'partnerOfParent')) {
    const sibs = (S.origins.get(p.originOf) || []).filter(o => o.role === 'sibling' && originSibParents(o).some(x => x.id === p.id));
    return p.role === 'parent' ? [S.byId.get(p.originOf), ...sibs].filter(Boolean) : sibs;
  }
  if (p.kind === 'origin') return [];
  return [...(S.kids.get(p.partnerOf) || []).filter(k => k.otherParentId === p.id), ...originKids(p.id)];
}
function siblingsOf(p) {
  if (p.kind === 'partner') return (S.origins.get(p.id) || []).filter(o => o.role === 'sibling');
  if (p.kind === 'origin' && p.role === 'child') {
    // Halbgeschwister: gemeinsame Kinder des Partners + weitere Kinder aus anderen Beziehungen
    const Q = S.byId.get(p.originOf);
    return [...originKids(p.originOf).filter(o => o.id !== p.id), ...(Q ? (S.kids.get(Q.partnerOf) || []).filter(k => k.otherParentId === Q.id) : [])];
  }
  if (p.kind === 'origin') return p.role === 'sibling' ? [S.byId.get(p.originOf), ...(S.origins.get(p.originOf) || []).filter(o => o.role === 'sibling' && o.id !== p.id)].filter(Boolean) : [];
  if (p.kind !== 'blood' || !p.parentId) return [];
  const half = p.otherParentId ? originKids(p.otherParentId) : [];
  if (half.length) return [...(S.kids.get(p.parentId) || []).filter(k => k.id !== p.id), ...half];
  return (S.kids.get(p.parentId) || []).filter(k => k.id !== p.id);
}
function partnersOf(p) {
  if (p.kind === 'blood') return S.partners.get(p.id) || [];
  if (p.kind === 'origin' && p.role === 'parent') return [...originParents(p.originOf).filter(o => o.id !== p.id), ...(S.origins.get(p.originOf) || []).filter(o => o.role === 'partnerOfParent' && o.partnerOfId === p.id)];
  if (p.kind === 'origin' && p.role === 'partnerOfParent') return [S.byId.get(p.partnerOfId)].filter(Boolean);
  if (p.kind === 'origin') return [];
  const other = S.byId.get(p.partnerOf); return other ? [other] : [];
}

// ================= Verwandtschaft =================
function ancestry(id) {
  const m = new Map([[id, { d: 0, via: null }]]); const q = [id];
  while (q.length) {
    const x = q.shift();
    for (const par of parentsOf(S.byId.get(x))) {
      if (!m.has(par.id)) { m.set(par.id, { d: m.get(x).d + 1, via: x }); q.push(par.id); }
    }
  }
  return m;
}
function bloodRel(aId, bId) {
  const A = ancestry(aId), B = ancestry(bId);
  let best = null;
  for (const [id, ia] of A) {
    if (!B.has(id)) continue;
    const ib = B.get(id), sum = ia.d + ib.d;
    const pref = S.byId.get(id).kind === 'blood' ? 0 : 1;
    if (!best || sum < best.sum || (sum === best.sum && pref < best.pref)) best = { anc: id, a: ia.d, b: ib.d, sum, pref, A, B };
  }
  return best;
}
const ur = (n) => n <= 0 ? '' : 'Ur' + 'ur'.repeat(n - 1);
function termFor(a, b, sex) {
  if (a === 0 && b === 0) return 'dieselbe Person';
  if (a === 0) {
    if (b === 1) return G(sex, 'Sohn', 'Tochter', 'Kind');
    if (b === 2) return G(sex, 'Enkel', 'Enkelin', 'Enkelkind');
    return ur(b - 2) + G(sex, 'enkel', 'enkelin', 'enkelkind');
  }
  if (b === 0) {
    if (a === 1) return G(sex, 'Vater', 'Mutter', 'Elternteil');
    if (a === 2) return G(sex, 'Großvater', 'Großmutter', 'Großelternteil');
    return ur(a - 2) + G(sex, 'großvater', 'großmutter', 'großelternteil');
  }
  if (a === 1 && b === 1) return G(sex, 'Bruder', 'Schwester', 'Geschwister');
  if (a === 1) {
    if (b === 2) return G(sex, 'Neffe', 'Nichte', 'Neffe/Nichte');
    const base = G(sex, 'großneffe', 'großnichte', 'großneffe/-nichte');
    return b === 3 ? base[0].toUpperCase() + base.slice(1) : ur(b - 3) + base;
  }
  if (b === 1) {
    if (a === 2) return G(sex, 'Onkel', 'Tante', 'Onkel/Tante');
    const base = G(sex, 'großonkel', 'großtante', 'großonkel/-tante');
    return a === 3 ? base[0].toUpperCase() + base.slice(1) : ur(a - 3) + base;
  }
  const k = Math.min(a, b) - 1, r = Math.abs(a - b);
  let t = G(sex, 'Cousin', 'Cousine', 'Cousin/Cousine') + (k > 1 ? ` ${k}. Grades` : '');
  if (r) t += ` (${r} Generation${r > 1 ? 'en' : ''} ${b > a ? 'jünger' : 'älter'})`;
  return t;
}
// Ergebnis: { term, sentence, kind, rel?, via? }
function kinship(aId, bId) {
  const A = S.byId.get(aId), B = S.byId.get(bId);
  if (!A || !B) return null;
  if (A.id === B.id) return { term: 'Das bist du', sentence: '', kind: 'self' };
  const nB = fullName(B);
  if (B.partnerOf === A.id || A.partnerOf === B.id) {
    const div = (B.partnerOf === A.id ? B : A).divorced;
    return { term: (div ? 'Ex-' : '') + G(B.sex, 'Ehemann', 'Ehefrau', 'Ehepartner/in'), sentence: `${nB} ist ${div ? 'geschieden von' : 'verheiratet mit'} ${fullName(A)}.`, kind: 'spouse' };
  }
  const r = bloodRel(A.id, B.id);
  if (r) {
    let t = termFor(r.a, r.b, B.sex);
    if (r.a === 1 && r.b === 1) {
      // Halbgeschwister: nur ein Elternteil gemeinsam
      const pa = parentsOf(A).map(x => x.id).sort().join(), pb = parentsOf(B).map(x => x.id).sort().join();
      if (pa !== pb) t = G(B.sex, 'Halbbruder', 'Halbschwester', 'Halbgeschwister');
    }
    return { term: t, sentence: sentenceFor(A, B, t), kind: 'blood', rel: r };
  }
  if (B.kind === 'origin' || A.kind === 'origin') {
    const swap = B.kind !== 'origin';
    const X = swap ? A : B, Y = swap ? B : A;           // X = Person der Herkunftsfamilie
    const Q = S.byId.get(X.originOf);                   // zugehörige/r Partner/in
    const sib = X.role === 'sibling';
    if (Q && X.role === 'partnerOfParent' && !swap) {
      const Z = S.byId.get(X.partnerOfId);
      if (Z && Y.id === Q.id) return { term: G(X.sex, 'Stiefvater', 'Stiefmutter', 'Stiefelternteil'), sentence: `${fullName(X)} ist ${G(X.sex, 'Partner', 'Partnerin', 'Partner/in')} von ${fullName(Z)}.`, kind: 'origin' };
      const kz = Z && kinship(Y.id, Z.id);
      if (kz && kz.kind !== 'none') return { term: `${G(X.sex, 'Partner', 'Partnerin', 'Partner/in')} von ${Z.firstName.split(' ')[0]} (${kz.term})`, sentence: `${fullName(X)} ist ${G(X.sex, 'Partner', 'Partnerin', 'Partner/in')} von ${fullName(Z)}.`, kind: 'origin' };
    }
    if (Q && X.role === 'child') {
      const P = S.byId.get(Q.partnerOf);
      const halfTerm = (s) => G(s, 'Halbbruder', 'Halbschwester', 'Halbgeschwister');
      const isJointKid = (z) => z && z.kind === 'blood' && z.otherParentId === Q.id;
      // X ist Kind von Q (nicht aus der Ehe mit P)
      if (!swap) {
        if (Y.id === Q.id) return { term: G(X.sex, 'Sohn', 'Tochter', 'Kind'), sentence: `${fullName(X)} ist ein Kind von ${fullName(Q)} aus einer anderen Beziehung.`, kind: 'origin' };
        if (P && Y.id === P.id) return { term: G(X.sex, 'Stiefsohn', 'Stieftochter', 'Stiefkind'), sentence: `${fullName(X)} ist ein Kind von ${fullName(Q)} aus einer anderen Beziehung.`, kind: 'origin' };
        if (isJointKid(Y) || (Y.kind === 'origin' && Y.role === 'child' && Y.originOf === Q.id)) return { term: halfTerm(X.sex), sentence: `${fullName(X)} und ${fullName(Y)} haben ${G(Q.sex, 'denselben Vater', 'dieselbe Mutter', 'ein gemeinsames Elternteil')}: ${fullName(Q)}.`, kind: 'origin' };
        const rp = P && bloodRel(Y.id, P.id);
        if (rp && rp.a === 0 && rp.b === 1) return { term: G(X.sex, 'Stiefenkel', 'Stiefenkelin', 'Stiefenkelkind'), sentence: `${fullName(X)} ist ein Kind von ${fullName(Q)} (verheiratet mit ${fullName(P)}) aus einer anderen Beziehung.`, kind: 'origin' };
        if (rp && rp.b === 0 && rp.a === 1) return { term: G(X.sex, 'Stiefbruder', 'Stiefschwester', 'Stiefgeschwister'), sentence: `${fullName(X)} ist ein Kind von ${fullName(Q)} aus einer anderen Beziehung.`, kind: 'origin' };
        const kq = kinship(Y.id, Q.id);
        if (kq && kq.kind !== 'none') return { term: `${G(X.sex, 'Sohn', 'Tochter', 'Kind')} von ${Q.firstName.split(' ')[0]} (${kq.term})`, sentence: `${fullName(X)} ist ein Kind von ${fullName(Q)} aus einer anderen Beziehung.`, kind: 'origin' };
      } else {
        if (Y.id === Q.id) return { term: G(Y.sex, 'Vater', 'Mutter', 'Elternteil'), sentence: '', kind: 'origin' };
        if (P && Y.id === P.id) return { term: G(Y.sex, 'Stiefvater', 'Stiefmutter', 'Stiefelternteil'), sentence: `${fullName(Y)} ist mit ${fullName(Q)} verheiratet.`, kind: 'origin' };
        if (isJointKid(Y)) return { term: halfTerm(Y.sex), sentence: `Gemeinsames Elternteil: ${fullName(Q)}.`, kind: 'origin' };
      }
    }
    if (Q && !swap) {
      if (Q.id === Y.id) return { term: sib ? G(X.sex, 'Bruder', 'Schwester', 'Geschwister') : G(X.sex, 'Vater', 'Mutter', 'Elternteil'), sentence: `${fullName(X)} ist ${sib ? 'Geschwister' : 'Elternteil'} von ${fullName(Q)}.`, kind: 'origin' };
      if (Q.partnerOf === Y.id) return { term: sib ? G(X.sex, 'Schwager', 'Schwägerin', 'Schwager/Schwägerin') : G(X.sex, 'Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil'), sentence: `${fullName(X)} ist ${sib ? 'Geschwister' : 'Elternteil'} von ${fullName(Q)}, ${G(Q.sex, 'dem Ehemann', 'der Ehefrau', 'dem/der Partner/in')} von ${fullName(Y)}.`, kind: 'origin' };
      const qp = S.byId.get(Q.partnerOf), rc = qp && bloodRel(Y.id, qp.id);
      if (!sib && rc && rc.a === 0 && rc.b === 1) return { term: G(X.sex, 'Gegenschwiegervater', 'Gegenschwiegermutter', 'Gegenschwiegerelternteil'), sentence: `${fullName(X)} ist ${G(X.sex, 'der Vater', 'die Mutter', 'Elternteil')} von ${fullName(Q)}, die/der mit ${fullName(qp)} verheiratet ist.`, kind: 'origin' };
      const rq = bloodRel(Y.id, Q.id);
      if (rq && rq.b === 0) { const t = termFor(rq.a + 1, sib ? 1 : 0, X.sex); return { term: t, sentence: sentenceFor(Y, X, t), kind: 'origin' }; }
      const kq = kinship(Y.id, Q.id);
      if (kq && kq.kind !== 'none') return { term: `${sib ? G(X.sex, 'Bruder', 'Schwester', 'Geschwister') : G(X.sex, 'Vater', 'Mutter', 'Elternteil')} von ${Q.firstName.split(' ')[0]} (${kq.term})`, sentence: `${fullName(X)} gehört zur Herkunftsfamilie von ${fullName(Q)}.`, kind: 'origin' };
    }
    if (Q && swap) {
      const kq = kinship(Q.id, Y.id);
      if (kq && kq.kind !== 'none') return { term: `angeheiratet (über ${Q.firstName.split(' ')[0]})`, sentence: `${fullName(Y)} ist für ${fullName(Q)}: ${kq.term}. ${fullName(X)} gehört zur Herkunftsfamilie von ${fullName(Q)}.`, kind: 'origin' };
    }
  }
  if (B.kind === 'partner') {
    const P = S.byId.get(B.partnerOf); const rp = P && bloodRel(A.id, P.id);
    if (rp) {
      let t;
      if (rp.a === 0 && rp.b === 1) t = G(B.sex, 'Schwiegersohn', 'Schwiegertochter', 'Schwiegerkind');
      else if (rp.a === 1 && rp.b === 1) t = G(B.sex, 'Schwager', 'Schwägerin', 'Schwager/Schwägerin');
      else if (rp.a === 1 && rp.b === 0 && !B.divorced) t = G(B.sex, 'Stiefvater', 'Stiefmutter', 'Stiefelternteil');
      else if (rp.b === 1 && rp.a >= 2 && !B.divorced) t = termFor(rp.a, 1, B.sex) + ' (angeheiratet)';
      else t = `${B.divorced ? 'Ex-' : ''}${G(B.sex, 'Ehemann', 'Ehefrau', 'Partner/in')} von ${P.firstName.split(' ')[0]} (${termFor(rp.a, rp.b, P.sex)})`;
      return { term: t, sentence: `${nB} ist ${B.divorced ? 'geschieden von' : 'verheiratet mit'} ${fullName(P)} (${termFor(rp.a, rp.b, P.sex)} von ${fullName(A)}).`, kind: 'inlaw-b', rel: rp, via: P };
    }
  }
  if (A.kind === 'partner') {
    const Q = S.byId.get(A.partnerOf); const rq = Q && bloodRel(Q.id, B.id);
    if (rq) {
      let t;
      if (rq.a === 1 && rq.b === 0) t = G(B.sex, 'Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil');
      else if (rq.a === 1 && rq.b === 1) t = G(B.sex, 'Schwager', 'Schwägerin', 'Schwager/Schwägerin');
      else if (rq.a === 0 && rq.b === 1) t = G(B.sex, 'Stiefsohn', 'Stieftochter', 'Stiefkind');
      else t = `angeheiratet: ${termFor(rq.a, rq.b, B.sex)} von ${Q.firstName}`;
      return { term: t, sentence: `${nB} ist ${termFor(rq.a, rq.b, B.sex)} von ${fullName(Q)}, ${G(Q.sex, 'dem Ehemann', 'der Ehefrau', 'dem/der Partner/in')} von ${fullName(A)}.`, kind: 'inlaw-a', rel: rq, viaA: Q };
    }
    if (B.kind === 'partner') {
      const P = S.byId.get(B.partnerOf); const rr = Q && P && bloodRel(Q.id, P.id);
      if (rr) {
        const t = rr.a === 1 && rr.b === 1 ? G(B.sex, 'Schwippschwager', 'Schwippschwägerin', 'Schwippschwager/-schwägerin') : 'angeheiratet (beidseitig)';
        return { term: t, sentence: `${nB} ist mit ${fullName(P)} verheiratet, ${fullName(A)} mit ${fullName(Q)} – diese beiden sind ${termFor(rr.a, rr.b, P.sex)} zueinander.`, kind: 'inlaw-ab', rel: rr, via: P, viaA: Q };
      }
    }
  }
  return { term: 'Keine Verbindung gefunden', sentence: 'Im Stammbaum gibt es keinen Weg zwischen diesen beiden Personen.', kind: 'none' };
}
function sentenceFor(A, B, term) {
  return `${fullName(B)} ist ${G(B.sex, 'der', 'die', '')} ${term} von ${fullName(A)}.`.replace(/ {2}/g, ' ');
}
function shortRelToMe(id) {
  if (!S.me || id === S.me) return null;
  const k = kinship(S.me, id);
  return k && k.kind !== 'none' ? k.term : null;
}

// ================= Personenauswahl =================
function attachPicker(input, onPick, opts = {}) {
  const wrap = input.parentElement; wrap.classList.add('pick');
  const list = document.createElement('div');
  list.className = 'pick-list'; list.hidden = true; list.setAttribute('role', 'listbox');
  wrap.appendChild(list);
  let items = [], sel = -1;
  const pool = () => (opts.filter ? S.persons.filter(opts.filter) : S.persons);
  function show() {
    const q = norm(input.value).trim();
    const terms = q.split(/\s+/).filter(Boolean);
    const score = (p) => { const n = norm(fullName(p)); return n === q ? 0 : n.startsWith(q) ? 1 : norm(p.firstName).startsWith(terms[0] || '') ? 2 : 3; };
    items = pool().filter(p => terms.every(t => searchText(p).includes(t)))
      .sort((a, b) => (score(a) - score(b)) || fullName(a).localeCompare(fullName(b), 'de')).slice(0, 40);
    sel = items.length ? 0 : -1;
    list.innerHTML = items.length ? items.map((p, i) => `<div class="pick-item" role="option" data-i="${i}" aria-selected="${i === sel}">${avatar(p)}<div>${esc(fullName(p))}<small>${esc([lifespan(p), relLabel(p) || p.city || ''].filter(Boolean).join(' · '))}</small></div></div>`).join('')
      : '<div class="empty">Niemand gefunden</div>';
    list.hidden = false;
  }
  function choose(i) { const p = items[i]; if (!p) return; list.hidden = true; input.value = opts.keepText === false ? '' : fullName(p); onPick(p); }
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', show);
  input.addEventListener('focus', () => { if (opts.openOnFocus !== false) { input.select(); show(); } });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && e.key === 'ArrowDown') { show(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('.pick-item', list).forEach((el, i) => el.setAttribute('aria-selected', i === sel));
      $$('.pick-item', list)[sel]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', (e) => { const it = e.target.closest('.pick-item'); if (it) { e.preventDefault(); choose(+it.dataset.i); } });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
}

// ================= Gerüst & Navigation =================
const NAV = [
  ['#/', 'Übersicht'], ['#/baum', 'Stammbaum'], ['#/personen', 'Personen'],
  ['#/geburtstage', 'Geburtstage'], ['#/verwandt', 'Verwandtschaft'], ['#/interview', 'Interview'],
];
function shell() {
  const me = S.me && S.byId.get(S.me);
  $('#app').innerHTML = `
  <header class="top"><div class="top-in">
    <a class="brand" href="#/"><small>Familien-Stammbaum</small>${esc(S.title.replace(/^Stammbaum\s+/i, ''))}</a>
    <nav class="nav" aria-label="Hauptnavigation">
      ${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}
      ${isAdmin() ? `<a href="#/admin">Verwaltung${S.openSugg ? `<span class="badge">${S.openSugg}</span>` : ''}</a>` : ''}
    </nav>
    <button class="me-btn" id="meBtn" title="Wer bist du? / Abmelden">
      ${me ? avatar(me) : '<span class="mono" aria-hidden="true">?</span>'}
      <span>${me ? 'Du: ' + esc(me.firstName.split(' ')[0]) : 'Wer bist du?'}${isAdmin() ? ' <span class="role-tag">Admin</span>' : ''}</span>
    </button>
  </div></header>
  <main id="main"></main>${footerHtml()}`;
  $('#meBtn').onclick = openMeDialog;
}
function setActiveNav() {
  const h = location.hash || '#/';
  $$('.nav a').forEach(a => {
    const href = a.getAttribute('href');
    const on = href === '#/' ? (h === '#/' || h === '#' || h === '') : h.startsWith(href) || (href === '#/baum' && h.startsWith('#/stamm'));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function router() {
  if (!S.role) return;
  const h = decodeURIComponent(location.hash.slice(1) || '/');
  const parts = h.split('/').filter(Boolean);
  setActiveNav();
  const main = $('#main');
  if (!main) return;
  window.scrollTo(0, 0);
  const v = parts[0] || '';
  document.title = S.title;
  if (v === '') return viewHome(main);
  if (v === 'baum') return viewTree(main, parts[1]);
  if (v === 'stamm') return viewTree(main, parts[2], parts[1]);
  if (v === 'p') return viewPersonPage(main, parts[1]);
  if (v === 'personen') return viewList(main);
  if (v === 'geburtstage') return viewBirthdays(main);
  if (v === 'verwandt') return viewRelation(main, parts[1], parts[2]);
  if (v === 'interview') return viewInterview(main, parts[1]);
  if (v === 'admin' && isAdmin()) return viewAdmin(main, parts[1] || 'vorschlaege');
  main.innerHTML = '<div class="page"><div class="empty">Seite nicht gefunden. <a href="#/">Zur Übersicht</a></div></div>';
}

async function loadData() {
  const d = await api('GET', '/api/data');
  S.title = d.title || 'Stammbaum'; S.updatedAt = d.updatedAt;
  if (d.openSuggestions !== undefined) S.openSugg = d.openSuggestions;
  S.sources = d.sources || []; S.sourceKinds = d.sourceKinds || [];
  index(d.persons);
}
async function refresh() {
  await loadData();
  shell(); router();
}

// Versionsanzeige (unten auf jeder Seite)
function footerHtml() {
  const v = S.version; if (!v || !v.version) return '';
  const commit = v.commit ? (v.repo ? ` · <a href="${esc(v.repo)}/commit/${esc(v.commit)}" target="_blank" rel="noopener">${esc(v.commit)}</a>` : ` · ${esc(v.commit)}`) : '';
  const name = v.repo ? `<a href="${esc(v.repo)}" target="_blank" rel="noopener">Stammbaum</a>` : 'Stammbaum';
  return `<footer class="site-foot">${name} v${esc(v.version)}${commit}</footer>`;
}

// ================= Anmeldung =================
function renderLogin(msg = '') {
  $('#app').innerHTML = `
  <div class="login"><div class="login-box">
    <div class="eyebrow">Nur für die Familie</div>
    <h1>${esc(S.title || 'Familien-Stammbaum')}</h1>
    <p>Bitte mit dem Familien-Passwort anmelden.</p>
    <form class="card" id="loginForm">
      <label class="fld"><span>Passwort</span><input class="input" type="password" name="pw" autocomplete="current-password" required autofocus></label>
      <div class="err" id="loginErr" style="margin-top:8px">${esc(msg)}</div>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:12px">Anmelden</button>
    </form>
    <p class="hint" style="margin-top:14px">Passwort vergessen? Bitte bei der Person nachfragen, die den Stammbaum pflegt.</p>
  </div></div>${footerHtml()}`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/login', { password: e.target.pw.value });
      S.role = r.role; await start();
    } catch (err) { $('#loginErr').textContent = err.message; btn.disabled = false; }
  };
}

// ================= „Wer bist du?“ =================
function openMeDialog() {
  const me = S.me && S.byId.get(S.me);
  const dlg = dialog(`
    <div class="dlg-head"><h2>Wer bist du?</h2><p>Dann zeigt der Stammbaum dir überall, wie du mit jemandem verwandt bist. Wird nur auf diesem Gerät gespeichert.</p></div>
    <div class="dlg-body">
      <label class="fld"><span>Deinen Namen suchen</span><input class="input" id="meIn" placeholder="z. B. Vorname Nachname" value="${esc(me ? fullName(me) : '')}"></label>
      <div class="hint">Nicht dabei? Über „Personen“ → passende Person → „Kind/Partner ergänzen“ kannst du dich eintragen lassen.</div>
    </div>
    <div class="dlg-foot">
      <button class="btn danger left" data-act="logout">Abmelden</button>
      ${me ? '<button class="btn" data-act="clear">Auswahl entfernen</button>' : ''}
      <button class="btn" data-act="close">Schließen</button>
    </div>`);
  attachPicker($('#meIn', dlg), (p) => { S.me = p.id; LS.set('stb.me', p.id); dlg.close(); shell(); router(); toast(`Hallo ${p.firstName.split(' ')[0]}!`); });
  dlg.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'close') dlg.close();
    if (a === 'clear') { S.me = null; LS.set('stb.me', null); dlg.close(); shell(); router(); }
    if (a === 'logout') { await api('POST', '/api/logout', {}); S.role = null; dlg.close(); renderLogin(); }
  });
}

function dialog(html) {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

// ================= Übersicht =================
function upcomingBirthdays(days = 366) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const p of S.persons) {
    if (!isLiving(p) || p.kind === 'origin') continue;
    const f = parseFull(p.birth); if (!f) continue;
    let next = new Date(today.getFullYear(), f.m - 1, f.d);
    if (f.m === 2 && f.d === 29 && next.getMonth() !== 1) next = new Date(today.getFullYear(), 1, 28);
    if (next < today) next = new Date(today.getFullYear() + 1, f.m - 1, f.d);
    const inDays = Math.round((next - today) / 864e5);
    if (inDays <= days) out.push({ p, next, inDays, turns: next.getFullYear() - f.y });
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}
function whenText(n) { return n === 0 ? 'heute' : n === 1 ? 'morgen' : n < 7 ? `in ${n} Tagen` : n < 14 ? 'nächste Woche' : `in ${n} Tagen`; }
function bdayRow(b, showRel = true) {
  const rel = showRel ? shortRelToMe(b.p.id) : null;
  return `<a class="bday-row${b.inDays === 0 ? ' today' : ''}" href="#/p/${esc(b.p.id)}">
    <div class="bday-date"><b>${b.next.getDate()}</b><span>${MON3[b.next.getMonth()]}</span></div>
    ${avatar(b.p)}
    <div class="who">${esc(fullName(b.p))}<small>wird ${b.turns}${rel ? ' · ' + esc(rel) : ''}</small></div>
    <span class="when${b.inDays < 7 ? ' soon' : ''}">${whenText(b.inDays)}</span></a>`;
}

function viewHome(main) {
  if (!S.persons.length) {
    main.innerHTML = `<div class="page"><section class="hero"><div class="eyebrow">Neuer Stammbaum</div><h1>${esc(S.title)}</h1>
      <div class="lede">Noch ist niemand eingetragen.</div></section>
      ${isAdmin() ? `<div class="card"><h2>So geht es los</h2><p style="margin-top:0;color:var(--ink-2)">Die älteste bekannte Person der Familie anlegen – alle weiteren kommen über „+ Kind“ und „+ Partner/in“ dazu. Alternativ unter Verwaltung → „Sichern &amp; Einlesen“ eine vorhandene Datei einlesen.</p>
        <div class="btn-row"><button class="btn primary" id="addRoot">Erste Person anlegen</button><a class="btn" href="#/admin/daten">Datei einlesen</a></div></div>`
      : '<div class="card empty">Die Verwaltung richtet den Stammbaum gerade ein.</div>'}</div>`;
    $('#addRoot')?.addEventListener('click', () => openPersonForm({ mode: 'root' }));
    return;
  }
  const blood = S.persons.filter(p => p.kind === 'blood');
  const gens = Math.max(...S.persons.map(p => S.gen.get(p.id) || 0)) + 1;
  const living = S.persons.filter(isLiving).length;
  const firstYear = Math.min(...S.persons.filter(p => p.kind !== 'origin').map(p => yearOf(p.birth) || 9999));
  const roots = S.roots.map(r => [r, ...(S.partners.get(r.id) || [])]).flat();
  const bdays = upcomingBirthdays(30).slice(0, 7);
  const minUpd = S.persons.reduce((m, p) => (p.updatedAt && p.updatedAt < m ? p.updatedAt : m), '9999');
  const recent = S.persons.filter(p => p.updatedAt && p.updatedAt > minUpd).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const me = S.me && S.byId.get(S.me);
  main.innerHTML = `<div class="page">
    <section class="hero">
      <div class="eyebrow">Seit ${firstYear}</div>
      <h1>${esc(S.title)}</h1>
      <div class="lede">${roots.length ? 'Ausgehend von ' + roots.map(r => esc(fullName(r))).join(' und ') : ''}</div>
      <div class="stats">
        <div class="stat"><b>${S.persons.length}</b><span>Personen</span></div>
        <div class="stat"><b>${blood.length}</b><span>Nachkommen &amp; Stammeltern</span></div>
        <div class="stat"><b>${gens}</b><span>Generationen</span></div>
        <div class="stat"><b>${living}</b><span>leben (soweit bekannt)</span></div>
      </div>
    </section>
    <div class="grid home-grid">
      <div class="grid">
        ${!me ? `<div class="card" style="border-color:var(--brick)"><h2>Wer bist du?</h2><p style="margin:0 0 12px;color:var(--ink-2)">Wähle dich einmal aus – dann siehst du bei jeder Person, wie ihr verwandt seid.</p><button class="btn primary" id="pickMe">Mich auswählen</button></div>` :
        `<div class="card"><h2>Hallo ${esc(me.firstName.split(' ')[0])}</h2><div class="btn-row"><a class="btn primary" href="#/baum/${esc(me.id)}">Mich im Stammbaum zeigen</a><a class="btn" href="#/p/${esc(me.id)}">Meine Seite</a><a class="btn" href="#/verwandt/${esc(me.id)}">Verwandtschaft berechnen</a></div></div>`}
        <div class="card"><h2>Geburtstage in den nächsten 30 Tagen</h2>
          ${bdays.length ? bdays.map(b => bdayRow(b)).join('') : '<div class="empty">Keine in den nächsten 30 Tagen.</div>'}
          <div style="margin-top:10px"><a href="#/geburtstage">Alle Geburtstage &amp; Kalender-Abo →</a></div>
        </div>
      </div>
      <div class="grid">
        <div class="card"><h2>Stöbern</h2>
          <div class="btn-row"><a class="btn" href="#/baum">Ganzer Stammbaum</a><a class="btn" href="#/personen">Alle Personen</a></div>
          <p class="hint" style="margin-top:12px">Fehlt jemand oder stimmt etwas nicht? Auf der Seite der Person „Änderung vorschlagen“ wählen – die Verwaltung prüft und übernimmt es.</p>
        </div>
        ${recent.length ? `<div class="card"><h2>Zuletzt ergänzt</h2><div class="chips">${recent.map(p => chip(p)).join('')}</div></div>` : ''}
      </div>
    </div></div>`;
  $('#pickMe')?.addEventListener('click', openMeDialog);
}

// ================= Stammbaum =================
const GEN_NAMES = ['Stammeltern', 'Kinder', 'Enkel', 'Urenkel', 'Ururenkel', '3× Urenkel', '4× Urenkel', '5× Urenkel'];
let treeZoom = LS.get('stb.zoom', matchMedia('(max-width: 720px)').matches ? 0.8 : 1);

// Baumdarstellung über „Einheiten“: Person + Partner + Kinder-Einheiten
function unitOf(p) { return { main: p, partners: S.partners.get(p.id) || [], kids: (S.kids.get(p.id) || []).map(unitOf) }; }
const leafUnit = (p) => ({ main: p, partners: [], kids: [] });

// Stämme = Herkunftsfamilien angeheirateter Partner
function stemList() {
  return S.persons.filter(p => p.kind === 'partner' && (S.origins.get(p.id) || []).some(o => o.role !== 'child'));
}
function stemName(P) {
  const par = originParents(P.id);
  const name = (par.find(x => x.sex === 'm') || par[0] || {}).lastName || P.birthName || P.lastName || P.firstName;
  return `Familie ${name}`;
}
function stemUnit(partnerId) {
  const P = S.byId.get(partnerId); if (!P) return null;
  const spouse = S.byId.get(P.partnerOf);
  const parents = originParents(P.id);
  const sibs = (S.origins.get(P.id) || []).filter(o => o.role === 'sibling');
  const joint = spouse ? (S.kids.get(spouse.id) || []).filter(k => k.otherParentId === P.id).map(unitOf) : [];
  const pUnit = { main: P, partners: spouse ? [spouse] : [], kids: [...joint, ...originKids(P.id).map(leafUnit)] };
  const kids = [pUnit, ...sibs.map(leafUnit)].sort((x, y) => sortKey(x.main.birth) - sortKey(y.main.birth));
  if (!parents.length) return { placeholder: `Eltern von ${P.firstName.split(' ')[0]}`, id: 'ph-' + P.id, partners: [], kids };
  const extra = (S.origins.get(P.id) || []).filter(o => o.role === 'partnerOfParent');
  return { main: parents[0], partners: [...parents.slice(1), ...extra], kids };
}
function unitDepth(u) { return 1 + Math.max(0, ...(u.kids || []).map(unitDepth)); }

function treeNodeHtml(u, ctx, depth = 0) {
  const key = u.main ? u.main.id : u.id;
  const kids = u.kids || [];
  const isC = ctx.collapsed.has(key) && kids.length;
  const pBtn = (x) => `<button class="t-p${x.death ? ' gone' : ''}${x.id === S.me ? ' is-me' : ''}" data-id="${esc(x.id)}"><b>${esc(x.firstName || '?')} <span class="ln">${esc(x.lastName || '')}</span></b><small>${esc([lifespan(x), x.birthName ? 'geb. ' + x.birthName : '', x.kind === 'origin' && x.role === 'child' ? 'aus anderer Beziehung' : '', x.kind === 'origin' && x.role === 'sibling' && isHalfOrigin(x) ? 'Kind von ' + originSibParents(x).map(y => y.firstName.split(' ')[0]).join(' & ') : '', x.kind === 'origin' && x.role === 'partnerOfParent' ? 'Partner/in von ' + (S.byId.get(x.partnerOfId)?.firstName || '').split(' ')[0] : ''].filter(Boolean).join(' · ') || ' ')}</small></button>`;
  const stemBtn = (x) => x.kind === 'partner' && x.id !== ctx.stemId && (S.origins.get(x.id) || []).some(o => o.role !== 'child')
    ? `<button class="t-stem" data-stem="${esc(x.id)}" title="Herkunftsfamilie von ${esc(x.firstName)} als Stamm anzeigen">${esc(stemName(x))} ›</button>` : '';
  const divorced = (x) => x.divorced || (u.main && u.main.divorced && u.main.partnerOf === x.id);
  const head = u.main ? pBtn(u.main) + stemBtn(u.main) : `<div class="t-p placeholder"><b>${esc(u.placeholder)}</b><small>nicht erfasst</small></div>`;
  return `<div class="t-node${kids.length ? ' has-kids' : ''}${isC ? ' collapsed' : ''}" data-node="${esc(key)}" data-depth="${depth}">
    <div class="t-unit">${head}${(u.partners || []).map(x => `<div class="t-ptn${divorced(x) ? ' div' : ''}"><span class="sym" title="${divorced(x) ? 'geschieden' : 'verheiratet'}">${divorced(x) ? '⚮' : '⚭'}</span><div class="t-ptn-in">${pBtn(x)}${stemBtn(x)}</div></div>`).join('')}
    ${kids.length ? `<button class="t-tog" data-tog="${esc(key)}" aria-expanded="${!isC}" title="${isC ? 'Kinder zeigen' : 'Kinder ausblenden'}">${kids.length}</button>` : ''}</div>
    ${kids.length ? `<div class="t-kids">${kids.map(k => treeNodeHtml(k, ctx, depth + 1)).join('')}</div>` : ''}
  </div>`;
}

let currentStem = null;
function viewTree(main, focusId, stemId) {
  if (!S.persons.length) { main.innerHTML = '<div class="page"><div class="card empty">Noch keine Personen. <a href="#/">Zur Übersicht</a></div></div>'; return; }
  // Person aus einer Herkunftsfamilie → deren Stamm zeigen
  const fp = focusId && S.byId.get(focusId);
  if (!stemId && fp && fp.kind === 'origin') stemId = fp.originOf;
  const stemP = stemId && S.byId.get(stemId);
  if (stemId && (!stemP || stemP.kind !== 'partner')) stemId = null;
  currentStem = stemId || null;
  const roots = currentStem ? [stemUnit(currentStem)] : S.roots.map(unitOf);
  const ctx = { collapsed: new Set(LS.get('stb.collapsed', [])), stemId: currentStem };
  const depth = Math.max(...roots.map(unitDepth));
  const stems = stemList();
  const mainName = S.title.replace(/^Stammbaum\s+/i, '') || 'Hauptstamm';
  const genName = (g) => currentStem ? (g === 0 ? 'Eltern' : g === 1 ? 'Kinder' : GEN_NAMES[g] || '') : GEN_NAMES[g] || '';
  main.innerHTML = `<div class="tree-page">
    <div class="tree-bar">
      ${stems.length ? `<select class="input stem-sel" id="stemSel" aria-label="Stamm wählen"><option value="">${esc(mainName)}</option>${stems.map(P => `<option value="${esc(P.id)}"${P.id === currentStem ? ' selected' : ''}>${esc(stemName(P))} – Herkunft von ${esc(fullName(P))}</option>`).join('')}</select>` : ''}
      <div class="search"><input class="input" id="tSearch" placeholder="Person suchen …" aria-label="Person im Stammbaum suchen"></div>
      <div class="zoom" role="group" aria-label="Zoom"><button data-z="-1" aria-label="Verkleinern">−</button><span id="zv"></span><button data-z="1" aria-label="Vergrößern">+</button></div>
      <button class="btn sm" data-act="open">Alle aufklappen</button>
      <button class="btn sm" data-act="close">Bis Enkel</button>
      ${S.me ? '<button class="btn sm" data-act="me">Zu mir</button>' : ''}
      <button class="btn sm ghost" data-act="print">Drucken</button>
    </div>
    ${currentStem ? `<div class="stem-note">Stamm <b>${esc(stemName(stemP))}</b> – Herkunftsfamilie von ${esc(fullName(stemP))}, weiter mit den gemeinsamen Nachkommen. <a href="#/baum/${esc(currentStem)}">Zurück zu ${esc(mainName)}</a></div>` : ''}
    <div class="tree-body">
      <div class="tree-wrap" id="tw"><div class="tree-canvas" id="tc">
        <div class="gens">${Array.from({ length: depth }, (_, g) => `<div><b>${g + 1}.</b>${genName(g)}</div>`).join('')}</div>
        <div id="tree">${roots.map(r => treeNodeHtml(r, ctx)).join('')}</div>
      </div></div>
      <aside class="drawer" id="drawer" hidden></aside>
    </div></div>`;
  const tw = $('#tw'), tc = $('#tc');
  const applyZoom = () => { tc.style.zoom = treeZoom; $('#zv').textContent = Math.round(treeZoom * 100) + ' %'; LS.set('stb.zoom', treeZoom); };
  applyZoom();
  const saveCollapsed = () => {
    const shown = new Set($$('.t-node', tc).map(n => n.dataset.node));
    const keep = LS.get('stb.collapsed', []).filter(id => !shown.has(id));
    LS.set('stb.collapsed', [...keep, ...$$('.t-node.collapsed', tc).map(n => n.dataset.node)]);
  };
  $('#stemSel')?.addEventListener('change', (e) => { location.hash = e.target.value ? '#/stamm/' + e.target.value : '#/baum'; });

  tc.addEventListener('click', (e) => {
    const tog = e.target.closest('[data-tog]');
    if (tog) {
      const n = tog.closest('.t-node'); n.classList.toggle('collapsed');
      const c = n.classList.contains('collapsed');
      tog.setAttribute('aria-expanded', !c); tog.title = c ? 'Kinder zeigen' : 'Kinder ausblenden';
      saveCollapsed(); return;
    }
    const st = e.target.closest('[data-stem]');
    if (st && !tw.dataset.moved) { location.hash = '#/stamm/' + st.dataset.stem; return; }
    const pb = e.target.closest('.t-p[data-id]');
    if (pb && !tw.dataset.moved) openDrawer(pb.dataset.id);
  });
  $('.tree-bar').addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]');
    if (z) { treeZoom = Math.max(0.4, Math.min(1.6, +(treeZoom + 0.1 * +z.dataset.z).toFixed(2))); applyZoom(); }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'open') { $$('.t-node.collapsed', tc).forEach(n => n.classList.remove('collapsed')); saveCollapsed(); }
    if (a === 'close') { $$('.t-node.has-kids', tc).forEach(n => n.classList.toggle('collapsed', +n.dataset.depth >= 2)); saveCollapsed(); }
    if (a === 'me') focusInTree(S.me);
    if (a === 'print') { $$('.t-node.collapsed', tc).forEach(n => n.classList.remove('collapsed')); setTimeout(() => window.print(), 50); }
  });
  attachPicker($('#tSearch'), (p) => {
    if (!$(`.t-p[data-id="${CSS.escape(p.id)}"]`, tc)) { location.hash = p.kind === 'origin' ? `#/stamm/${p.originOf}/${p.id}` : `#/baum/${p.id}`; return; }
    focusInTree(p.id); openDrawer(p.id);
  }, { keepText: true });

  // Ziehen zum Verschieben (Maus)
  let drag = null;
  tw.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.t-tog')) return;
    drag = { x: e.clientX, y: e.clientY, l: tw.scrollLeft, t: tw.scrollTop }; delete tw.dataset.moved;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) { tw.dataset.moved = '1'; tw.classList.add('dragging'); }
    if (tw.dataset.moved) { tw.scrollLeft = drag.l - dx; tw.scrollTop = drag.t - dy; }
  });
  window.addEventListener('pointerup', () => { if (drag) { drag = null; tw.classList.remove('dragging'); setTimeout(() => delete tw.dataset.moved, 0); } });
  tw.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    treeZoom = Math.max(0.4, Math.min(1.6, +(treeZoom - Math.sign(e.deltaY) * 0.1).toFixed(2))); applyZoom();
  }, { passive: false });

  if (focusId && S.byId.has(focusId)) { focusInTree(focusId); openDrawer(focusId); }
  else if (currentStem) setTimeout(() => focusInTree(currentStem), 50);
}

function focusInTree(id) {
  const btn = $(`.t-p[data-id="${CSS.escape(id)}"]`);
  if (!btn) return;
  // alle übergeordneten Zweige aufklappen
  for (let n = btn.closest('.t-node'); n; n = n.parentElement?.closest('.t-node')) n.classList.remove('collapsed');
  for (let n = btn.closest('.t-node')?.parentElement?.closest('.t-node'); n; n = n.parentElement?.closest('.t-node')) n.querySelector(':scope > .t-unit .t-tog')?.setAttribute('aria-expanded', 'true');
  btn.scrollIntoView({ block: 'center', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
}

function openDrawer(id) {
  if (matchMedia('(max-width: 900px)').matches) { location.hash = '#/p/' + id; return; }
  const d = $('#drawer'); if (!d) return;
  d.hidden = false;
  d.innerHTML = `<button class="btn sm ghost x" aria-label="Schließen" data-close>✕</button>${personHtml(S.byId.get(id), true)}`;
  bindPersonActions(d, S.byId.get(id));
  d.querySelector('[data-close]').onclick = () => { d.hidden = true; };
  history.replaceState(null, '', currentStem ? `#/stamm/${currentStem}/${id}` : '#/baum/' + id);
}

// ================= Person =================
function viewPersonPage(main, id) {
  const p = S.byId.get(id);
  if (!p) { main.innerHTML = '<div class="page"><div class="empty">Diese Person gibt es nicht (mehr). <a href="#/personen">Zur Liste</a></div></div>'; return; }
  document.title = fullName(p) + ' – ' + S.title;
  main.innerHTML = `<div class="page person-page">${personHtml(p, false)}</div>`;
  bindPersonActions(main, p);
}

function personHtml(p, compact) {
  const parents = parentsOf(p), partners = partnersOf(p), kids = childrenOf(p), sibs = siblingsOf(p);
  const rel = S.me && S.me !== p.id ? kinship(S.me, p.id) : null;
  const age = ageNow(p);
  const f = (label, v) => v ? `<dt>${label}</dt><dd>${esc(v)}</dd>` : '';
  const born = [p.birth && '* ' + p.birth, p.birthPlace && 'in ' + p.birthPlace].filter(Boolean).join(' ');
  const died = [p.death && '† ' + p.death, p.deathPlace && 'in ' + p.deathPlace].filter(Boolean).join(' ');
  const ageTxt = !p.death && age !== null && isLiving(p) ? ` · ${age} Jahre` : (p.death && parseFull(p.death) && parseFull(p.birth) ? ` · ${parseFull(p.death).y - parseFull(p.birth).y - ((parseFull(p.death).m * 100 + parseFull(p.death).d) < (parseFull(p.birth).m * 100 + parseFull(p.birth).d) ? 1 : 0)} Jahre alt geworden` : '');
  const address = [p.street, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const marriages = p.kind === 'partner' ? [[S.byId.get(p.partnerOf), p]] : partners.map(s => [s, s]);
  const gen = S.gen.get(p.id);
  const parentNote = p.kind === 'partner' ? `<div class="hint">Eingeheiratet – Eltern und Geschwister von ${esc(p.firstName.split(' ')[0] || 'ihr/ihm')} sind noch nicht erfasst.</div>` : '';
  const kindLabel = p.kind === 'partner' ? 'Partner/in' : p.kind === 'origin' ? 'Herkunftsfamilie von ' + esc(fullName(S.byId.get(p.originOf))) : 'Familie';
  const srcs = S.sources.filter(s => (s.personIds || []).includes(p.id));
  return `<article class="person">
    <header class="ph">
      ${avatar(p, 'portrait')}
      <div style="min-width:0">
        <div class="eyebrow">${gen !== undefined ? `${gen + 1}. Generation · ` : ''}${kindLabel}${isAdmin() && p.code ? ' · ' + esc(p.code) : ''}</div>
        <h1>${esc(fullName(p))}</h1>
        ${p.birthName ? `<div class="sub">geb. ${esc(p.birthName)}</div>` : ''}
        <div class="life">${esc([born, died].filter(Boolean).join('   ')) || '<span class="muted">Keine Lebensdaten erfasst</span>'}${esc(ageTxt)}</div>
        ${rel && rel.kind !== 'none' ? `<div class="relbox"><span>Für dich:</span><b>${esc(rel.term)}</b><a href="#/verwandt/${esc(S.me)}/${esc(p.id)}">Weg zeigen</a></div>` : ''}
      </div>
    </header>
    <div class="btn-row p-actions">
      <a class="btn" href="${p.kind === 'origin' ? `#/stamm/${esc(p.originOf)}/${esc(p.id)}` : `#/baum/${esc(p.id)}`}">Im Stammbaum</a>
      ${p.kind === 'partner' && (S.origins.get(p.id) || []).some(o => o.role !== 'child') ? `<a class="btn" href="#/stamm/${esc(p.id)}">${esc(stemName(p))} als Stamm</a>` : ''}
      ${compact ? `<a class="btn" href="#/p/${esc(p.id)}">Ganze Seite</a>` : ''}
      <a class="btn" href="#/verwandt/${esc(S.me && S.me !== p.id ? S.me : '-')}/${esc(p.id)}">Verwandtschaft</a>
      <button class="btn primary" data-pa="edit">${isAdmin() ? 'Bearbeiten' : 'Änderung vorschlagen'}</button>
      ${p.kind !== 'origin' ? '<button class="btn" data-pa="child">+ Kind</button>' : ''}
      ${p.kind === 'origin' && p.role === 'parent' ? '<button class="btn" data-pa="origin-kid">+ Kind</button><button class="btn" data-pa="origin-pop">+ Partner/in</button>' : ''}
      ${p.kind === 'blood' ? '<button class="btn" data-pa="partner">+ Partner/in</button>' : ''}
      <button class="btn" data-pa="source">+ Quelle</button>
      <a class="btn ghost" href="#/interview/${esc(p.id)}">Lücken füllen</a>
      ${!isAdmin() ? '<button class="btn ghost" data-pa="remark">Hinweis senden</button>' : ''}
    </div>
    <section class="sec"><h3>Angaben</h3><dl class="facts">
      ${f('Geboren', born)}${f('Geburtsname', p.birthName)}
      ${marriages.map(([who, rec]) => who ? `<dt>${rec.divorced ? 'Ehe (geschieden)' : 'Verheiratet'}</dt><dd>mit <a href="#/p/${esc(who.id)}">${esc(fullName(who))}</a>${rec.marriage ? ' seit ' + esc(rec.marriage) : ''}</dd>` : '').join('')}
      ${f('Gestorben', died)}
      ${f(p.death ? 'Zuletzt wohnhaft' : 'Wohnort', address)}
      ${(p.custom || []).map(c => f(esc(c.label || 'Info'), c.value)).join('')}
      ${f('Notizen', p.notes)}
      ${!born && !died && !address && !p.notes && !(p.custom || []).length && !marriages.length ? '<dd class="muted" style="grid-column:1/-1">Noch keine Angaben. Weißt du mehr? → „Änderung vorschlagen“</dd>' : ''}
    </dl></section>
    <section class="sec"><h3>Familie</h3>
      ${parents.length ? `<div class="kin-group"><div>Eltern</div><div class="chips">${parents.map(x => chip(x)).join('')}</div></div>` : parentNote}
      ${partners.length ? `<div class="kin-group"><div>${p.kind === 'partner' ? 'Partner/in' : 'Partner'}</div><div class="chips">${partners.map(x => chip(x, x.divorced ? 'geschieden' : '')).join('')}</div></div>` : ''}
      ${sibs.length ? `<div class="kin-group"><div>Geschwister (${sibs.length})</div><div class="chips">${sibs.map(x => chip(x)).join('')}</div></div>` : ''}
      ${kids.length ? `<div class="kin-group"><div>Kinder (${kids.length})</div><div class="chips">${kids.map(x => chip(x, x.kind === 'origin' ? 'aus anderer Beziehung' : p.kind === 'blood' && x.otherParentId && partners.length > 1 ? 'mit ' + (S.byId.get(x.otherParentId)?.firstName || '') : p.kind === 'blood' && !x.otherParentId && partners.length ? 'anderer Elternteil' : '')).join('')}</div></div>` : ''}
      ${p.kind === 'partner' ? `<div class="btn-row" style="margin-top:12px"><button class="btn sm" data-pa="origin-parent">+ Elternteil von ${esc(p.firstName.split(' ')[0] || '')}</button><button class="btn sm" data-pa="origin-sibling">+ Geschwister</button><button class="btn sm" data-pa="origin-child">+ Kind aus anderer Beziehung</button></div>` : ''}
      ${p.kind === 'origin' ? `<div class="hint" style="margin-top:10px">Gehört zur Herkunftsfamilie von <a href="#/p/${esc(p.originOf)}">${esc(fullName(S.byId.get(p.originOf)))}</a> – im Stammbaum über die Stamm-Auswahl „${esc(stemName(S.byId.get(p.originOf) || {}))}“ zu sehen.</div>` : ''}
    </section>
    <section class="sec"><h3>Quellen &amp; Dokumente${srcs.length ? ` (${srcs.length})` : ''}</h3>
      ${srcs.length ? `<div class="src-grid">${srcs.map(sourceTile).join('')}</div>` : `<p class="muted" style="margin:0">Noch keine Quellen. Traueranzeigen, Stammbuchauszüge, Urkunden oder alte Fotos helfen, die Angaben zu belegen.</p>`}
    </section>
    <section class="sec"><h3>Zeitleiste</h3><div class="tl-host" data-tl="${esc(p.id)}">${timelineHtml(p, LS.get('stb.tltab', 'familie'))}</div></section>
  </article>`;
}

function bindPersonActions(root, p) {
  root.querySelectorAll('[data-pa]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.pa;
    if (a === 'edit') openPersonForm({ mode: 'edit', person: p });
    if (a === 'child') openPersonForm({ mode: 'child', anchor: p });
    if (a === 'partner') openPersonForm({ mode: 'partner', anchor: p });
    if (a === 'remark') openRemarkForm(p);
    if (a === 'origin-parent') openPersonForm({ mode: 'origin', anchor: p, role: 'parent' });
    if (a === 'origin-sibling') openPersonForm({ mode: 'origin', anchor: p, role: 'sibling' });
    if (a === 'origin-child') openPersonForm({ mode: 'origin', anchor: p, role: 'child' });
    if (a === 'origin-kid') openPersonForm({ mode: 'origin', anchor: p, role: 'sibling' });
    if (a === 'origin-pop') openPersonForm({ mode: 'origin', anchor: p, role: 'partnerOfParent' });
    if (a === 'source') openSourceForm({ person: p });
  }));
  root.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => openSourceViewer(b.dataset.src)));
  const host = root.querySelector('.tl-host');
  if (host) host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tltab]'); if (!t) return;
    LS.set('stb.tltab', t.dataset.tltab);
    host.innerHTML = timelineHtml(p, t.dataset.tltab);
  });
}

// ================= Formulare =================
function normDate(v) {
  v = String(v || '').trim().replace(/[,/-]/g, '.').replace(/\s+/g, '');
  if (/^\d{8}$/.test(v)) v = `${v.slice(0, 2)}.${v.slice(2, 4)}.${v.slice(4)}`;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
  return v;
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 800, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

function openPersonForm({ mode, person, anchor, role }) {
  const admin = isAdmin();
  const p = mode === 'edit' ? person : {
    firstName: '', lastName: mode === 'child' && anchor ? (anchor.kind === 'partner' ? S.byId.get(anchor.partnerOf)?.lastName : anchor.lastName) || '' : '',
    birthName: '', sex: '', birth: '', birthPlace: '', death: '', deathPlace: '', marriage: '', divorced: false,
    street: '', zip: '', city: '', notes: '', custom: [], kind: mode === 'partner' ? 'partner' : mode === 'origin' ? 'origin' : 'blood',
    role: role || 'parent',
  };
  if (mode === 'origin' && role === 'parent') p.lastName = anchor.birthName || anchor.lastName || '';
  if (mode === 'origin' && role === 'sibling') p.birthName = anchor.kind === 'origin' ? '' : anchor.birthName || '';
  if (mode === 'origin' && role === 'sibling' && anchor.kind === 'origin') p.lastName = anchor.lastName || '';
  if (mode === 'origin' && role === 'child') p.lastName = anchor.lastName || '';
  const isPartner = p.kind === 'partner';
  const bloodAnchor = mode === 'child' && anchor ? (anchor.kind === 'partner' ? S.byId.get(anchor.partnerOf) : anchor) : null;
  const coParents = mode === 'child' && anchor && anchor.kind === 'blood' ? (S.partners.get(anchor.id) || []) : [];
  const title = mode === 'edit' ? (admin ? `${fullName(p)} bearbeiten` : `Änderung zu ${fullName(p)} vorschlagen`)
    : mode === 'child' ? `Kind von ${fullName(anchor)} ${admin ? 'hinzufügen' : 'vorschlagen'}`
    : mode === 'root' ? 'Stammvater/-mutter anlegen'
    : mode === 'origin' && anchor.kind === 'origin' ? `${role === 'partnerOfParent' ? 'Partner/in' : 'Kind'} von ${fullName(anchor)} ${admin ? 'hinzufügen' : 'vorschlagen'}`
    : mode === 'origin' ? `${role === 'child' ? 'Kind' : ROLE_TXT[role] || 'Elternteil'} von ${fullName(anchor)}${role === 'child' ? ' aus anderer Beziehung' : ''} ${admin ? 'hinzufügen' : 'vorschlagen'}`
    : `Partner/in von ${fullName(anchor)} ${admin ? 'hinzufügen' : 'vorschlagen'}`;
  const inp = (k, label, extra = '') => `<label class="fld${extra.includes('full') ? ' full' : ''}"><span>${label}</span><input class="input" name="${k}" value="${esc(p[k] || '')}" ${extra.replace('full', '')}></label>`;
  const dateInp = (k, label) => inp(k, label, `placeholder="TT.MM.JJJJ" inputmode="decimal" data-date`);
  const dlg = dialog(`<form method="dialog" id="pf">
    <div class="dlg-head"><h2>${esc(title)}</h2><p>${admin ? 'Änderungen werden sofort gespeichert und protokolliert.' : 'Dein Vorschlag geht an die Verwaltung und erscheint nach Prüfung im Stammbaum.'}</p></div>
    <div class="dlg-body"><div class="form-grid">
      ${inp('firstName', 'Vorname(n)', 'autofocus')}${inp('lastName', 'Nachname')}
      ${inp('birthName', 'Geburtsname')}
      <label class="fld"><span>Geschlecht</span><select class="input" name="sex">
        ${[['', 'unbekannt'], ['w', 'weiblich'], ['m', 'männlich'], ['d', 'divers']].map(([v, t]) => `<option value="${v}"${p.sex === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${dateInp('birth', 'Geboren am')}${inp('birthPlace', 'Geburtsort')}
      ${dateInp('death', 'Gestorben am')}${inp('deathPlace', 'Sterbeort')}
      ${isPartner ? `${dateInp('marriage', 'Heirat am')}<label class="fld check" style="align-self:end"><input type="checkbox" name="divorced"${p.divorced ? ' checked' : ''}> geschieden</label>` : ''}
      ${p.kind === 'origin' && (p.role === 'sibling') && (mode === 'edit' || anchor) ? originParentSelect(mode === 'edit' ? p.originOf : (anchor.kind === 'origin' ? anchor.originOf : anchor.id), mode === 'edit' ? p.parentIds : null, mode !== 'edit' && anchor.kind === 'origin' ? anchor.id : null) : ''}
      ${p.kind === 'origin' && (mode === 'origin' && anchor.kind === 'origin') ? `<input type="hidden" name="role" value="${esc(role)}">` : ''}
      ${p.kind === 'origin' && p.role !== 'partnerOfParent' && !(mode === 'origin' && anchor.kind === 'origin') ? `<label class="fld full"><span>Beziehung zu ${esc(fullName(mode === 'edit' ? S.byId.get(p.originOf) : anchor))}</span><select class="input" name="role">${[['parent', 'Elternteil (Vater/Mutter)'], ['sibling', 'Geschwister (Bruder/Schwester)'], ['child', 'Kind aus anderer Beziehung']].map(([v, t]) => `<option value="${v}"${(p.role || 'parent') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
      ${coParents.length ? `<label class="fld full"><span>Zweites Elternteil</span><select class="input" name="otherParentId">${coParents.map(c => `<option value="${esc(c.id)}"${c === coParents.find(y => !y.divorced) ? ' selected' : ''}>gemeinsames Kind mit ${esc(fullName(c))}</option>`).join('')}<option value="none">– anderer oder unbekannter Elternteil –</option></select></label>` : ''}
      ${mode === 'edit' && p.kind === 'blood' ? parentFieldsHtml(p) : ''}
      <div class="form-sep">Wohnort</div>
      ${inp('street', 'Straße', 'class="full"')}${inp('zip', 'PLZ', 'inputmode="numeric"')}${inp('city', 'Ort')}
      <div class="form-sep">Weitere Angaben</div>
      <div class="full" id="customRows">${(p.custom || []).map(customRow).join('')}</div>
      <div class="full"><button type="button" class="btn sm" id="addCustom">+ Eigenes Feld (z. B. Beruf, E-Mail, Spitzname)</button></div>
      <label class="fld full"><span>Notizen</span><textarea class="input" name="notes">${esc(p.notes || '')}</textarea></label>
      <div class="form-sep">Foto</div>
      <div class="full photo-edit">${mode === 'edit' ? avatar(p) : '<span class="mono">+</span>'}<div><input type="file" accept="image/*" id="photoIn"><div class="hint">Wird automatisch verkleinert.</div>
        ${admin && mode === 'edit' && p.hasPhoto ? '<button type="button" class="btn sm danger" id="delPhoto" style="margin-top:6px">Foto entfernen</button>' : ''}</div></div>
      ${admin && mode === 'edit' ? adminStructureFields(p) : ''}
      ${!admin ? `<div class="form-sep">Von dir</div>
        <label class="fld"><span>Dein Name *</span><input class="input" name="author" required value="${esc(LS.get('stb.author', '') || (S.me ? fullName(S.byId.get(S.me)) : ''))}"></label>
        <label class="fld full"><span>Nachricht an die Verwaltung (optional)</span><textarea class="input" name="message" placeholder="z. B. Quelle oder Erklärung"></textarea></label>` : ''}
    </div><div class="err" id="pfErr" style="margin-top:10px"></div></div>
    <div class="dlg-foot">
      ${admin && mode === 'edit' ? '<button type="button" class="btn danger left" id="delPerson">Person löschen</button>' : ''}
      <button type="button" class="btn" value="cancel" data-cancel>Abbrechen</button>
      <button class="btn primary" id="pfSave">${admin ? 'Speichern' : 'Vorschlag senden'}</button>
    </div></form>`);
  const form = $('#pf', dlg);
  let photo = null;
  const roleSel = $('select[name=role]', form);
  if (roleSel && $('#opSel', form)) { const sync = () => { $('#opSel', form).closest('label').hidden = roleSel.value !== 'sibling'; }; roleSel.addEventListener('change', sync); sync(); }
  const opIds = () => { const el = $('#opSel', form); if (!el || el.closest('label').hidden) return undefined; return el.value ? el.value.split(',') : []; };
  $$('[data-date]', form).forEach(i => i.addEventListener('blur', () => { i.value = normDate(i.value); }));
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  $('#addCustom', dlg).onclick = () => { $('#customRows', dlg).insertAdjacentHTML('beforeend', customRow({ label: '', value: '' })); };
  $('#customRows', dlg).addEventListener('click', (e) => { if (e.target.closest('[data-rmc]')) e.target.closest('.custom-row').remove(); });
  $('#photoIn', dlg).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { photo = await resizePhoto(file); $('.photo-edit .mono', dlg).innerHTML = `<img src="${photo}" alt="">`; }
    catch (err) { toast(err.message, true); }
  };
  if (mode === 'edit' && p.kind !== 'origin') bindAdminStructure(dlg, p);
  if (admin && mode === 'edit') {
    $('#delPhoto', dlg)?.addEventListener('click', async () => {
      try { await api('DELETE', `/api/personen/${p.id}/foto`); toast('Foto entfernt'); dlg.close(); await refresh(); } catch (err) { toast(err.message, true); }
    });
    $('#delPerson', dlg).onclick = async () => {
      if (!confirm(`${fullName(p)} wirklich löschen? Das lässt sich nur über eine Sicherung rückgängig machen.`)) return;
      try { await api('DELETE', `/api/personen/${p.id}`); toast('Gelöscht'); dlg.close(); location.hash = '#/personen'; await refresh(); }
      catch (err) { $('#pfErr', dlg).textContent = err.message; }
    };
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const fields = {};
    for (const k of ['firstName', 'lastName', 'birthName', 'sex', 'birth', 'birthPlace', 'death', 'deathPlace', 'street', 'zip', 'city', 'notes']) fields[k] = (fd.get(k) || '').toString();
    for (const k of ['birth', 'death']) fields[k] = normDate(fields[k]);
    if (isPartner) { fields.marriage = normDate(fd.get('marriage')); fields.divorced = !!fd.get('divorced'); }
    else if (mode === 'edit') { fields.marriage = p.marriage || ''; fields.divorced = !!p.divorced; }
    fields.custom = $$('.custom-row', dlg).map(r => ({ label: r.querySelector('[name=cl]').value, value: r.querySelector('[name=cv]').value })).filter(c => c.label || c.value);
    if (!fields.firstName && !fields.lastName) { $('#pfErr', dlg).textContent = 'Bitte mindestens einen Namen eingeben.'; return; }
    const btn = $('#pfSave', dlg); btn.disabled = true;
    try {
      if (admin) {
        let id = p.id;
        if (mode === 'edit') {
          const extra = readAdminStructure(dlg, p);
          if (p.kind === 'origin' && opIds() !== undefined) extra.parentIds = opIds();
          await api('PUT', `/api/personen/${p.id}`, Object.assign({ fields }, extra));
        } else {
          const r = await api('POST', '/api/personen', { kind: mode === 'child' ? 'child' : mode, role: fd.get('role') || undefined, anchorId: anchor ? anchor.id : undefined, fields, otherParentId: fd.get('otherParentId') || undefined, parentIds: opIds() });
          id = r.person.id;
        }
        if (photo) await api('PUT', `/api/personen/${id}/foto`, { photo });
        dlg.close(); toast('Gespeichert');
        await refresh();
        if (mode !== 'edit') location.hash = '#/p/' + id;
      } else {
        const author = (fd.get('author') || '').toString().trim();
        LS.set('stb.author', author);
        let structure;
        if (mode === 'edit' && p.kind === 'blood') {
          if (!$('#asParent', dlg).value.trim()) $('[name=parentId]', dlg).value = '';
          const op = $('[name=otherParentId]', dlg).value;
          structure = { parentId: $('[name=parentId]', dlg).value || null, otherParentId: op && op !== 'none' ? op : null };
        }
        if (mode === 'edit' && p.kind === 'origin' && opIds() !== undefined) structure = { parentIds: opIds() };
        await api('POST', '/api/vorschlaege', {
          type: mode, role: fd.get('role') || undefined, targetId: mode === 'edit' ? p.id : anchor.id, fields, author, structure, parentIds: mode === 'origin' ? opIds() : undefined,
          message: fd.get('message') || '', photo: photo || undefined, otherParentId: fd.get('otherParentId') || undefined,
        });
        dlg.close(); toast('Danke! Dein Vorschlag wurde an die Verwaltung geschickt.');
      }
    } catch (err) { $('#pfErr', dlg).textContent = err.message; btn.disabled = false; }
  };
  void bloodAnchor;
}
function customRow(c) {
  return `<div class="custom-row"><input class="input" name="cl" placeholder="Bezeichnung" value="${esc(c.label)}"><input class="input" name="cv" placeholder="Inhalt" value="${esc(c.value)}"><button type="button" class="btn sm ghost" data-rmc aria-label="Feld entfernen">✕</button></div>`;
}
// Auswahl der Eltern eines Geschwisters in der Herkunftsfamilie (Wert: IDs, leer = beide Eltern)
function originParentSelect(partnerId, current, mustInclude) {
  const par = originParents(partnerId);
  const pops = (S.origins.get(partnerId) || []).filter(o => o.role === 'partnerOfParent');
  const opts = [];
  if (par.length >= 2) opts.push(['', `beide: ${par.map(x => x.firstName.split(' ')[0]).join(' & ')} (volle Geschwister)`]);
  else if (!par.length) opts.push(['', 'Eltern nicht erfasst']);
  for (const x of par) {
    for (const y of pops.filter(o => o.partnerOfId === x.id)) opts.push([`${x.id},${y.id}`, `${x.firstName.split(' ')[0]} & ${fullName(y)}`]);
    opts.push([par.length === 1 ? '' : x.id, `nur ${fullName(x)} (anderes Elternteil unbekannt)`]);
  }
  const uniq = opts.filter((o, i) => opts.findIndex(z => z[0] === o[0]) === i)
    .filter(([v]) => !mustInclude || (v === '' ? par.some(x => x.id === mustInclude) : v.split(',').includes(mustInclude)));
  const cur = current && current.length ? current.join(',') : '';
  return `<label class="fld full"><span>Eltern</span><select class="input" id="opSel">${uniq.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
function otherParentOptions(parentId, selected) {
  const cps = parentId ? (S.partners.get(parentId) || []) : [];
  return cps.map(c => `<option value="${esc(c.id)}"${selected === c.id ? ' selected' : ''}>${esc(fullName(c))}${c.divorced ? ' (geschieden)' : ''}</option>`).join('')
    + `<option value="none"${!selected ? ' selected' : ''}>– anderer oder unbekannter Elternteil –</option>`;
}
function parentFieldsHtml(p) {
  const par = S.byId.get(p.parentId);
  return `<div class="form-sep">Eltern</div>
    <label class="fld"><span>Elternteil aus der Familie</span><input class="input" id="asParent" value="${esc(par ? fullName(par) : '')}" placeholder="– keins (Stammvater/-mutter) –"><input type="hidden" name="parentId" value="${esc(p.parentId || '')}"></label>
    <label class="fld"><span>Zweites Elternteil</span><select class="input" name="otherParentId" id="asOther">${otherParentOptions(p.parentId, p.otherParentId)}</select></label>
    <div class="hint full" style="margin-top:-4px">Ist das Kind aus einer anderen Beziehung, „anderer oder unbekannter Elternteil“ wählen. Ein früherer Partner lässt sich vorher unter „+ Partner/in“ eintragen.</div>`;
}
function adminStructureFields(p) {
  if (p.kind === 'origin') return '';
  if (p.kind === 'blood') return `<div class="form-sep">Verwaltung</div>
      <label class="fld"><span>Reihenfolge unter Geschwistern</span><input class="input" type="number" name="order" value="${esc(p.order || 0)}"></label>`;
  const t = S.byId.get(p.partnerOf);
  return `<div class="form-sep">Einordnung (Verwaltung)</div>
    <label class="fld full"><span>Partner/in von</span><input class="input" id="asPartner" value="${esc(t ? fullName(t) : '')}"><input type="hidden" name="partnerOf" value="${esc(p.partnerOf || '')}"></label>
    <label class="fld"><span>Reihenfolge</span><input class="input" type="number" name="order" value="${esc(p.order || 0)}"></label>`;
}
function bindAdminStructure(dlg, p) {
  const ap = $('#asParent', dlg);
  if (ap) {
    attachPicker(ap, (x) => {
      $('[name=parentId]', dlg).value = x.id;
      $('#asOther', dlg).innerHTML = otherParentOptions(x.id, ((S.partners.get(x.id) || []).find(y => !y.divorced) || {}).id);
    }, { filter: (x) => x.kind === 'blood' && x.id !== p.id });
  }
  const pp = $('#asPartner', dlg);
  if (pp) attachPicker(pp, (x) => { $('[name=partnerOf]', dlg).value = x.id; }, { filter: (x) => x.kind === 'blood' });
}
function readAdminStructure(dlg, p) {
  const out = { order: Number($('[name=order]', dlg)?.value || p.order || 0) };
  if (p.kind === 'blood') {
    if (!$('#asParent', dlg).value.trim()) $('[name=parentId]', dlg).value = '';
    out.parentId = $('[name=parentId]', dlg).value || null;
    const op = $('[name=otherParentId]', dlg).value;
    out.otherParentId = op && op !== 'none' ? op : null;
  } else if (p.kind === 'partner') out.partnerOf = $('[name=partnerOf]', dlg).value;
  else out.role = $('[name=role]', dlg)?.value;
  return out;
}

function openRemarkForm(p) {
  const dlg = dialog(`<form id="rf">
    <div class="dlg-head"><h2>Hinweis zu ${esc(fullName(p))}</h2><p>Für alles, was nicht in die Felder passt – z. B. „gehört eigentlich zu …“ oder eine Geschichte.</p></div>
    <div class="dlg-body"><div class="form-grid">
      <label class="fld full"><span>Dein Hinweis *</span><textarea class="input" name="message" required></textarea></label>
      <label class="fld"><span>Dein Name *</span><input class="input" name="author" required value="${esc(LS.get('stb.author', '') || (S.me ? fullName(S.byId.get(S.me)) : ''))}"></label>
    </div><div class="err" id="rfErr"></div></div>
    <div class="dlg-foot"><button type="button" class="btn" data-cancel>Abbrechen</button><button class="btn primary">Senden</button></div></form>`);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  $('#rf', dlg).onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      LS.set('stb.author', fd.get('author'));
      await api('POST', '/api/vorschlaege', { type: 'remark', targetId: p.id, author: fd.get('author'), message: fd.get('message') });
      dlg.close(); toast('Danke für den Hinweis!');
    } catch (err) { $('#rfErr', dlg).textContent = err.message; }
  };
}

// ================= Personenliste =================
let listState = LS.get('stb.list', { q: '', filter: 'alle', sort: 'name', dir: 1 });
function viewList(main) {
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Verzeichnis</div><h1>Alle Personen</h1></div>
      ${isAdmin() ? '<a class="btn" href="/api/export.csv">Als Tabelle (CSV) laden</a>' : ''}</div>
    <div class="filters">
      <input class="input" id="lq" placeholder="Name, Ort oder Jahr …" value="${esc(listState.q)}" style="min-width:240px;flex:1;max-width:360px" aria-label="Filtern">
      <div class="seg" role="group" aria-label="Filter">${[['alle', 'Alle'], ['lebend', 'Lebend'], ['verstorben', 'Verstorben'], ['familie', 'Nur Blutslinie'], ['partner', 'Angeheiratete']].map(([k, t]) => `<button data-f="${k}" aria-pressed="${listState.filter === k}">${t}</button>`).join('')}</div>
      <span class="count" id="lc"></span>
    </div>
    <div id="lt"></div></div>`;
  const cols = [['name', 'Name'], ['birth', 'Geboren'], ['death', 'Gestorben', 'hide-s'], ['city', 'Wohnort', 'hide-s'], ['gen', 'Gen.', 'hide-s']];
  if (S.me) cols.push(['rel', 'Für dich', 'hide-s']);
  const draw = () => {
    LS.set('stb.list', listState);
    const terms = norm(listState.q).split(/\s+/).filter(Boolean);
    const rels = new Map();
    if (S.me) for (const p of S.persons) rels.set(p.id, p.id === S.me ? 'du' : (shortRelToMe(p.id) || ''));
    let rows = S.persons.filter(p => terms.every(t => searchText(p).includes(t)));
    const f = listState.filter;
    if (f === 'lebend') rows = rows.filter(p => !p.death);
    if (f === 'verstorben') rows = rows.filter(p => p.death);
    if (f === 'familie') rows = rows.filter(p => p.kind === 'blood');
    if (f === 'partner') rows = rows.filter(p => p.kind !== 'blood');
    const key = {
      name: (p) => norm((p.lastName || '') + ' ' + (p.firstName || '')), birth: (p) => sortKey(p.birth), death: (p) => p.death ? sortKey(p.death) : 99999999,
      city: (p) => norm(p.city || 'zzz'), gen: (p) => S.gen.get(p.id) ?? 99, rel: (p) => rels.get(p.id) || 'zzz',
    }[listState.sort];
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * listState.dir; });
    $('#lc').textContent = `${rows.length} von ${S.persons.length}`;
    $('#lt').innerHTML = rows.length ? `<table class="tbl"><thead><tr>${cols.map(([k, t, c]) => `<th class="${c || ''}" data-s="${k}" aria-sort="${listState.sort === k ? (listState.dir > 0 ? 'ascending' : 'descending') : 'none'}">${t}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(p => `<tr><td><div class="nm">${avatar(p)}<div><a href="#/p/${esc(p.id)}">${esc(fullName(p))}</a><small>${esc([p.birthName ? 'geb. ' + p.birthName : '', p.kind === 'partner' ? '⚭ ' + fullName(S.byId.get(p.partnerOf)) : p.kind === 'origin' ? relLabel(p) : ''].filter(Boolean).join(' · '))}</small></div></div></td>
        <td>${esc(p.birth)}</td><td class="hide-s">${p.death ? '† ' + esc(p.death) : ''}</td><td class="hide-s">${esc(p.city)}</td><td class="hide-s">${(S.gen.get(p.id) ?? '') === '' ? '' : S.gen.get(p.id) + 1}</td>
        ${S.me ? `<td class="hide-s">${esc(rels.get(p.id))}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<div class="card empty">Niemand passt zu diesem Filter.</div>';
  };
  $('#lq').addEventListener('input', (e) => { listState.q = e.target.value; draw(); });
  main.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    listState.filter = b.dataset.f; $$('.seg button', main).forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  });
  $('#lt').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-s]'); if (!th) return;
    if (listState.sort === th.dataset.s) listState.dir *= -1; else { listState.sort = th.dataset.s; listState.dir = 1; }
    draw();
  });
  draw();
}

// ================= Geburtstage =================
function viewBirthdays(main) {
  const all = upcomingBirthdays(366);
  const showDeath = LS.get('stb.deathdays', false);
  const byMonth = new Map();
  for (const b of all) { const k = b.next.getFullYear() * 12 + b.next.getMonth(); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(b); }
  const icsUrl = S.icsPath ? location.origin + S.icsPath : '';
  const webcal = icsUrl.replace(/^https?:/, 'webcal:');
  let memorial = [];
  if (showDeath) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    memorial = S.persons.filter(p => parseFull(p.death)).map(p => {
      const f = parseFull(p.death); let n = new Date(t.getFullYear(), f.m - 1, f.d); if (n < t) n = new Date(t.getFullYear() + 1, f.m - 1, f.d);
      return { p, next: n, inDays: Math.round((n - t) / 864e5), years: n.getFullYear() - f.y };
    }).filter(x => x.inDays <= 60).sort((a, b) => a.inDays - b.inDays);
  }
  const noDate = S.persons.filter(p => isLiving(p) && !parseFull(p.birth)).length;
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Die nächsten zwölf Monate</div><h1>Geburtstage</h1></div>
      <label class="check"><input type="checkbox" id="dd"${showDeath ? ' checked' : ''}> Gedenktage anzeigen</label></div>
    <div class="grid cal-grid">
      <div>
        ${showDeath ? `<div class="card" style="margin-bottom:20px"><h2>Gedenktage (nächste 60 Tage)</h2>${memorial.length ? memorial.map(m => `<a class="bday-row" href="#/p/${esc(m.p.id)}"><div class="bday-date"><b>${m.next.getDate()}</b><span>${MON3[m.next.getMonth()]}</span></div>${avatar(m.p)}<div class="who">${esc(fullName(m.p))}<small>${m.years}. Todestag</small></div><span class="when">${whenText(m.inDays)}</span></a>`).join('') : '<div class="empty">Keine.</div>'}</div>` : ''}
        ${[...byMonth.entries()].map(([k, list]) => `<section class="month card"><h2>${MONTHS[k % 12]} <span>${Math.floor(k / 12)}</span></h2>${list.map(b => bdayRow(b)).join('')}</section>`).join('')}
        ${noDate ? `<p class="hint">${noDate} Personen ohne vollständiges Geburtsdatum werden nicht angezeigt.</p>` : ''}
      </div>
      <aside class="card" style="position:sticky;top:80px">
        <h2>Im eigenen Kalender</h2>
        <p style="margin:0;color:var(--ink-2);font-size:14px">Alle Geburtstage automatisch im Handy- oder Computer-Kalender – aktualisiert sich selbst.</p>
        <div class="copy-row"><input class="input" readonly value="${esc(icsUrl)}" id="icsUrl" aria-label="Kalender-Adresse"><button class="btn sm" id="copyIcs">Kopieren</button></div>
        <a class="btn primary" href="${esc(webcal)}">Kalender abonnieren</a>
        <ol class="steps">
          <li><b>iPhone/Mac:</b> Knopf oben antippen → „Abonnieren“.</li>
          <li><b>Android/Google:</b> calendar.google.com → „Weitere Kalender +“ → „Per URL“ → Adresse einfügen.</li>
          <li><b>Outlook:</b> „Kalender hinzufügen“ → „Aus dem Internet“.</li>
        </ol>
        <p class="hint">Die Adresse bitte nur innerhalb der Familie teilen.</p>
      </aside>
    </div></div>`;
  $('#dd').onchange = (e) => { LS.set('stb.deathdays', e.target.checked); viewBirthdays(main); };
  $('#copyIcs').onclick = async () => {
    try { await navigator.clipboard.writeText(icsUrl); toast('Adresse kopiert'); } catch { $('#icsUrl').select(); toast('Bitte manuell kopieren'); }
  };
}

// ================= Verwandtschaft =================
function viewRelation(main, aId, bId) {
  if (!aId || aId === '-' || !S.byId.has(aId)) aId = S.me || '';
  if (!S.byId.has(bId)) bId = '';
  const A = S.byId.get(aId), B = S.byId.get(bId);
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Wie hängen wir zusammen?</div><h1>Verwandtschaft</h1></div></div>
    <div class="card"><div class="rel-pickers">
      <label class="fld"><span>Person 1</span><input class="input" id="ra" value="${esc(A ? fullName(A) : '')}" placeholder="Name suchen …"></label>
      <button class="btn swap" id="rswap" title="Tauschen" aria-label="Personen tauschen">⇄</button>
      <label class="fld"><span>Person 2</span><input class="input" id="rb" value="${esc(B ? fullName(B) : '')}" placeholder="Name suchen …"></label>
    </div></div>
    <div id="rres" class="rel-result"></div></div>`;
  const go = (a, b) => { location.hash = `#/verwandt/${a || '-'}/${b || ''}`; };
  attachPicker($('#ra'), (p) => go(p.id, bId));
  attachPicker($('#rb'), (p) => go(aId, p.id));
  $('#rswap').onclick = () => go(bId, aId);
  if (!A || !B) {
    $('#rres').innerHTML = `<div class="empty">${!A ? 'Wähle zwei Personen aus.' : 'Jetzt noch Person 2 auswählen.'}</div>`;
    if (A && !B) $('#rb').focus();
    return;
  }
  const k = kinship(A.id, B.id);
  $('#rres').innerHTML = `<div class="card">
    <div class="eyebrow">${esc(fullName(B))} ist für ${A.id === S.me ? 'dich' : esc(fullName(A))}</div>
    <div class="rel-term">${esc(k.term)}</div>
    <div class="rel-sentence">${esc(k.sentence)}</div>
    ${pathHtml(A, B, k)}</div>`;
}
function pathHtml(A, B, k) {
  if (!k.rel) return '';
  const r = k.rel;
  // Kette vom gemeinsamen Vorfahren (exklusiv) hinunter bis „from“
  const chainDown = (map, from) => { const out = []; let cur = r.anc; while (cur && cur !== from) { cur = map.get(cur).via; if (cur) out.push(cur); } return out; };
  const startA = k.viaA ? k.viaA.id : A.id, endB = k.via ? k.via.id : B.id;
  const downA = chainDown(r.A, startA), downB = chainDown(r.B, endB);
  const anc = S.byId.get(r.anc);
  const lab = (id) => { if (id === A.id) return A.id === S.me ? 'Du' : 'Person 1'; if (id === B.id) return 'Person 2'; const kk = kinship(A.id, id); return kk ? kk.term : ''; };
  const step = (id) => `<div class="step${id === A.id || id === B.id ? ' end' : ''}"><div class="lbl">${esc(lab(id))}</div>${chip(S.byId.get(id))}</div>`;
  const colA = [...downA, ...(k.viaA ? [A.id] : [])];
  const colB = [...downB, ...(k.via ? [B.id] : [])];
  if (r.a === 0 || r.b === 0) {
    // Direkte Linie: Vorfahr oben, Nachkomme unten
    const line = r.a === 0 ? [...(k.viaA ? [A.id] : []), r.anc, ...colB] : [...(k.via ? [B.id] : []), r.anc, ...colA];
    return `<div class="path" style="grid-template-columns:1fr"><div class="side">${line.map(step).join('')}</div></div>`;
  }
  const ancPartner = (S.partners.get(anc.id) || []).find(s => !s.divorced);
  return `<div class="path">
    <div class="apex"><span class="tag">Gemeinsame Vorfahren</span><div class="chips" style="justify-content:center">${chip(anc)}${ancPartner ? chip(ancPartner) : ''}</div></div>
    <div><div class="colhead">↓ ${A.id === S.me ? 'Deine Linie' : 'Linie von ' + esc(fullName(A))}</div><div class="side">${colA.map(step).join('')}</div></div>
    <div><div class="colhead">↓ Linie von ${esc(fullName(B))}</div><div class="side">${colB.map(step).join('')}</div></div>
  </div>`;
}

// ================= Quellen & Dokumente =================
function sourceTile(s) {
  const thumb = s.hasThumb ? `<img src="/api/quellen/${esc(s.id)}/vorschau" alt="" loading="lazy">` : `<span class="src-doc">${s.mime === 'application/pdf' ? 'PDF' : 'Bild'}</span>`;
  return `<button class="src-tile" data-src="${esc(s.id)}" title="${esc(s.title)}">${thumb}<span class="src-cap"><b>${esc(s.title)}</b><small>${esc([s.kind !== s.title ? s.kind : '', s.date].filter(Boolean).join(' · '))}</small></span></button>`;
}
function resizeImage(file, max, q) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden (bitte JPG, PNG oder HEIC als JPG)')); };
    img.src = url;
  });
}
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden')); r.readAsDataURL(file); });
}
function personTagsHtml(ids) {
  return ids.map(id => S.byId.get(id)).filter(Boolean).map(p => `<span class="tag-chip" data-pid="${esc(p.id)}">${esc(fullName(p))}<button type="button" aria-label="Entfernen" data-rm="${esc(p.id)}">✕</button></span>`).join('');
}

function openSourceForm({ person, source }) {
  const admin = isAdmin();
  const edit = !!source;
  const s = source || { title: '', kind: 'Traueranzeige', date: '', note: '', personIds: [person.id] };
  let ids = [...(s.personIds || [])];
  let file = null, thumb = null;
  const dlg = dialog(`<form id="sfm">
    <div class="dlg-head"><h2>${edit ? 'Quelle bearbeiten' : `Quelle zu ${esc(fullName(person))} ${admin ? 'hinzufügen' : 'einreichen'}`}</h2>
      <p>Foto oder Scan einer Traueranzeige, eines Stammbuchauszugs, einer Urkunde, eines alten Fotos … ${admin ? '' : 'Die Verwaltung prüft die Quelle, bevor sie sichtbar wird.'}</p></div>
    <div class="dlg-body"><div class="form-grid">
      ${edit ? '' : `<div class="full"><label class="drop" id="drop"><input type="file" accept="image/*,application/pdf" id="srcFile" capture="environment"><span id="dropTxt"><b>Foto aufnehmen oder Datei wählen</b><br><small>JPG, PNG oder PDF · Bilder werden automatisch passend verkleinert</small></span></label></div>`}
      <label class="fld"><span>Art</span><select class="input" name="kind">${S.sourceKinds.map(k => `<option${k === s.kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      <label class="fld"><span>Datum des Dokuments</span><input class="input" name="date" value="${esc(s.date)}" placeholder="TT.MM.JJJJ oder JJJJ" data-date></label>
      <label class="fld full"><span>Titel</span><input class="input" name="title" value="${esc(s.title)}" placeholder="z. B. Traueranzeige Weser-Kurier"></label>
      <label class="fld full"><span>Beschreibung / Fundort</span><textarea class="input" name="note" placeholder="Was steht drin? Woher stammt es?">${esc(s.note)}</textarea></label>
      ${admin ? `<div class="full"><span class="fld-label">Betrifft diese Personen</span><div class="tag-list" id="tagList">${personTagsHtml(ids)}</div>
        <div><input class="input" id="tagAdd" placeholder="Weitere Person zuordnen (z. B. alle Personen im Stammbuch) …"></div></div>` : ''}
      ${!admin ? `<label class="fld full"><span>Dein Name *</span><input class="input" name="author" required value="${esc(LS.get('stb.author', '') || (S.me ? fullName(S.byId.get(S.me)) : ''))}"></label>` : ''}
    </div><div class="err" id="sfmErr" style="margin-top:8px"></div></div>
    <div class="dlg-foot">${edit ? '<button type="button" class="btn danger left" id="srcDel">Quelle löschen</button>' : ''}
      <button type="button" class="btn" data-cancel>Abbrechen</button><button class="btn primary" id="sfmSave">${admin ? 'Speichern' : 'Einreichen'}</button></div></form>`);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  $$('[data-date]', dlg).forEach(i => i.addEventListener('blur', () => { i.value = normDate(i.value); }));
  const drawTags = () => { const tl = $('#tagList', dlg); if (tl) tl.innerHTML = personTagsHtml(ids); };
  if (admin) {
    attachPicker($('#tagAdd', dlg), (x) => { if (!ids.includes(x.id)) ids.push(x.id); drawTags(); }, { keepText: false });
    $('#tagList', dlg).addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) { ids = ids.filter(i => i !== r.dataset.rm); drawTags(); } });
  }
  $('#srcFile', dlg)?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = $('#dropTxt', dlg);
    try {
      if (f.type === 'application/pdf') {
        if (f.size > 14 * 1024 * 1024) throw new Error('PDF ist zu groß (max. 14 MB)');
        file = await readAsDataUrl(f); thumb = null;
        txt.innerHTML = `<b>📄 ${esc(f.name)}</b><br><small>${(f.size / 1024 / 1024).toFixed(1)} MB</small>`;
      } else {
        txt.innerHTML = '<small>Wird vorbereitet …</small>';
        file = await resizeImage(f, 2600, 0.86); thumb = await resizeImage(f, 420, 0.8);
        txt.innerHTML = `<img src="${thumb}" alt="" class="drop-prev"><br><small>${esc(f.name)}</small>`;
      }
      const t = $('[name=title]', dlg); if (!t.value) t.placeholder = $('[name=kind]', dlg).value + ' ' + fullName(person);
    } catch (err) { file = null; txt.innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  });
  $('#srcDel', dlg)?.addEventListener('click', async () => {
    if (!confirm('Diese Quelle samt Datei löschen?')) return;
    try { await api('DELETE', `/api/quellen/${s.id}`); dlg.close(); toast('Quelle gelöscht'); await refresh(); } catch (err) { $('#sfmErr', dlg).textContent = err.message; }
  });
  $('#sfm', dlg).onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const meta = { kind: fd.get('kind'), date: normDate(fd.get('date')), title: (fd.get('title') || '').trim() || `${fd.get('kind')} ${fullName(person || S.byId.get(ids[0]))}`, note: fd.get('note') };
    if (!edit && !file) { $('#sfmErr', dlg).textContent = 'Bitte zuerst ein Foto oder eine Datei auswählen.'; return; }
    const btn = $('#sfmSave', dlg); btn.disabled = true; btn.textContent = 'Lädt hoch …';
    try {
      if (admin && edit) await api('PUT', `/api/quellen/${s.id}`, { source: meta, personIds: ids });
      else if (admin) await api('POST', '/api/quellen', { source: meta, personIds: ids, file, thumb: thumb || undefined });
      else {
        LS.set('stb.author', fd.get('author'));
        await api('POST', '/api/vorschlaege', { type: 'source', targetId: person.id, author: fd.get('author'), source: meta, file, thumb: thumb || undefined, message: meta.note });
      }
      dlg.close(); toast(admin ? 'Quelle gespeichert' : 'Danke! Die Quelle wurde zur Prüfung eingereicht.');
      if (admin) await refresh();
    } catch (err) { $('#sfmErr', dlg).textContent = err.message; btn.disabled = false; btn.textContent = admin ? 'Speichern' : 'Einreichen'; }
  };
}

function openSourceViewer(id) {
  const s = S.sources.find(x => x.id === id); if (!s) return;
  const url = `/api/quellen/${encodeURIComponent(s.id)}/datei`;
  const isPdf = s.mime === 'application/pdf';
  const people = (s.personIds || []).map(i => S.byId.get(i)).filter(Boolean);
  const dlg = dialog(`<div class="viewer">
    <div class="viewer-img">${isPdf ? `<div class="empty"><p>PDF-Dokument</p><a class="btn primary" href="${url}" target="_blank" rel="noopener">PDF öffnen</a></div>` : `<img src="${url}" alt="${esc(s.title)}" id="vImg">`}</div>
    <div class="viewer-side">
      <div class="eyebrow">${esc(s.kind)}${s.date ? ' · ' + esc(s.date) : ''}</div>
      <h2>${esc(s.title)}</h2>
      ${s.note ? `<p class="viewer-note">${esc(s.note)}</p>` : ''}
      <div class="fld-label" style="margin-top:14px">Betrifft</div>
      <div class="chips">${people.map(p => chip(p)).join('')}</div>
      <p class="hint" style="margin-top:14px">${s.addedBy ? 'Eingereicht von ' + esc(s.addedBy) + ' · ' : ''}${s.createdAt ? new Date(s.createdAt).toLocaleDateString('de-DE') : ''}</p>
      <div class="btn-row" style="margin-top:10px">
        <a class="btn" href="${url}" target="_blank" rel="noopener">${isPdf ? 'Öffnen' : 'Originalgröße'}</a>
        ${isAdmin() ? '<button class="btn" data-ve>Bearbeiten</button>' : ''}
        <button class="btn" data-vc>Schließen</button>
      </div>
    </div></div>`);
  dlg.classList.add('wide');
  $('[data-vc]', dlg).onclick = () => dlg.close();
  $('#vImg', dlg)?.addEventListener('click', (e) => e.target.classList.toggle('zoomed'));
  dlg.addEventListener('click', (e) => { if (e.target.closest('.chip')) dlg.close(); });
  $('[data-ve]', dlg)?.addEventListener('click', () => { dlg.close(); openSourceForm({ person: people[0], source: s }); });
}

// ================= Zeitleiste =================
function lifeRange(p) {
  const fb = parseFull(p.birth), yb = yearOf(p.birth);
  if (!yb) return null;
  const start = fb ? fb.y + (fb.m - 1) / 12 : yb + 0.5;
  const fd = parseFull(p.death), yd = yearOf(p.death);
  const now = new Date(); const nowY = now.getFullYear() + now.getMonth() / 12;
  if (fd) return { start, end: fd.y + (fd.m - 1) / 12, state: 'dead' };
  if (yd) return { start, end: yd + 0.5, state: 'dead' };
  if (p.death || !isLiving(p)) return { start, end: null, state: 'unknown' };
  return { start, end: nowY, state: 'living' };
}
function timelineHtml(p, tab) {
  const tabs = [['familie', 'Partner & Kinder'], ['herkunft', 'Eltern & Geschwister'], ['vorfahren', 'Vorfahren']];
  let rows;
  if (tab === 'herkunft') rows = [...parentsOf(p), ...[p, ...siblingsOf(p)].sort((a, b) => sortKey(a.birth) - sortKey(b.birth))];
  else if (tab === 'vorfahren') {
    rows = []; let cur = p; const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id); rows.unshift(cur);
      const ps = parentsOf(cur);
      ps.filter(x => x.id !== ps[0]?.id).forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); rows.unshift(x); } });
      cur = ps[0] || (cur.kind === 'partner' ? null : null);
    }
  } else rows = [p, ...partnersOf(p), ...childrenOf(p)];
  rows = rows.filter((x, i, a) => x && a.findIndex(y => y.id === x.id) === i);
  const data = rows.map(x => ({ p: x, r: lifeRange(x) }));
  const known = data.filter(d => d.r);
  const missing = data.filter(d => !d.r);
  const head = `<div class="tl-tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" data-tltab="${k}" aria-selected="${k === tab}">${t}</button>`).join('')}</div>`;
  if (!known.length) return head + '<div class="empty">Für diese Auswahl sind keine Geburtsjahre erfasst.</div>';
  const nowY = new Date().getFullYear();
  let min = Math.floor((Math.min(...known.map(d => d.r.start)) - 4) / 20) * 20;
  let max = Math.ceil((Math.max(nowY, ...known.map(d => d.r.end || d.r.start + 2)) + 1) / 20) * 20;
  const span = max - min, pct = (y) => ((y - min) / span * 100).toFixed(3);
  const ticks = []; for (let y = min; y <= max; y += 10) ticks.push(y);
  const axis = `<div class="tl-axis">${ticks.map(y => `<span class="tl-tick${y % 20 ? ' minor' : ''}" style="left:${pct(y)}%">${y % 20 ? '' : y}</span>`).join('')}</div>`;
  const now = `<div class="tl-now" style="left:${pct(nowY + new Date().getMonth() / 12)}%" title="heute"></div>`;
  const rowHtml = ({ p: x, r }) => {
    const end = r.end || r.start + 1.2;
    const yrs = `${yearOf(x.birth)}–${r.state === 'living' ? '' : r.state === 'unknown' ? 'verstorben' : yearOf(x.death)}`;
    return `<div class="tl-row"><a class="tl-item${x.id === p.id ? ' sel' : ''} ${r.state}" href="#/p/${esc(x.id)}" style="--l:${pct(r.start)}%;--w:${(Math.max(end - r.start, 0.6) / span * 100).toFixed(3)}%">
      <span class="tl-av">${avatar(x)}</span><span class="tl-bar"></span>
      <span class="tl-lbl"><b>${esc(fullName(x))}</b> <span>${esc(yrs)}</span></span></a></div>`;
  };
  return head + `<div class="tl-scroll"><div class="tl">${axis}<div class="tl-rows">${now}${known.map(rowHtml).join('')}</div></div></div>
    ${missing.length ? `<p class="hint">Ohne Geburtsjahr nicht dargestellt: ${missing.map(d => `<a href="#/p/${esc(d.p.id)}">${esc(fullName(d.p))}</a>`).join(', ')}</p>` : ''}`;
}

// ================= Interview =================
function familyDistances(fromId) {
  const dist = new Map([[fromId, 0]]); const q = [fromId];
  const neigh = (p) => [...parentsOf(p), ...childrenOf(p), ...partnersOf(p), ...siblingsOf(p), ...(p.kind === 'partner' ? [] : []), ...(S.origins.get(p.id) || [])];
  while (q.length) {
    const id = q.shift(); const p = S.byId.get(id); if (!p) continue;
    for (const n of neigh(p)) if (n && !dist.has(n.id)) { dist.set(n.id, dist.get(id) + 1); q.push(n.id); }
  }
  return dist;
}
function buildQuestions(scope, focusId) {
  const done = new Set(LS.get('stb.iv.done', []));
  let people, dist = null;
  if (scope === 'person' && focusId) people = [S.byId.get(focusId)].filter(Boolean);
  else if (scope === 'nah' && S.me) {
    const d = familyDistances(S.me); dist = d;
    people = S.persons.filter(p => d.has(p.id) && d.get(p.id) <= 4);
  } else {
    people = S.persons.slice().sort((a, b) => (S.gen.get(a.id) ?? 9) - (S.gen.get(b.id) ?? 9));
  }
  const qs = [];
  const add = (p, type, prio) => { const key = type + ':' + p.id; if (!done.has(key)) qs.push({ key, type, p, prio }); };
  for (const p of people) {
    const age = ageNow(p);
    if (!p.death && age !== null && age > 100) add(p, 'alive', 1);
    if (!p.lastName) add(p, 'lastName', 2);
    if (!parseFull(p.birth) && !/^\d{1,2}\.\d{4}$/.test(p.birth || '') || !p.birth) add(p, 'birth', 2);
    if (p.death && !parseFull(p.death)) add(p, 'deathDate', 3);
    if (!p.sex) add(p, 'sex', 3);
    if (p.kind === 'partner' && !p.marriage && !p.divorced) add(p, 'marriage', 4);
    if (p.kind === 'partner' && !originParents(p.id).length) add(p, 'partnerParents', 5);
    if (p.kind === 'blood' && age !== null && age >= 25 && isLiving(p) && !(S.partners.get(p.id) || []).length) add(p, 'partner', 6);
    if (p.kind === 'blood' && age !== null && age >= 30 && !(S.kids.get(p.id) || []).length && (S.partners.get(p.id) || []).length) add(p, 'kids', 6);
    if (p.birth && !p.birthPlace && p.kind !== 'origin') add(p, 'birthPlace', 7);
    if (isLiving(p) && !p.death && !p.city && p.kind !== 'origin') add(p, 'city', 8);
    if (p.death && !S.sources.some(s => (s.personIds || []).includes(p.id))) add(p, 'source', 9);
  }
  // Nahe Familie: zuerst die nächsten Personen, je Person die wichtigsten Fragen
  if (dist) return qs.sort((a, b) => (dist.get(a.p.id) - dist.get(b.p.id)) || (a.prio - b.prio));
  if (scope !== 'person') qs.sort((a, b) => (a.prio - b.prio) || ((S.gen.get(a.p.id) ?? 9) - (S.gen.get(b.p.id) ?? 9)));
  return qs;
}

const IV = { queue: [], i: 0, sent: 0, scope: 'nah', focus: null };
function viewInterview(main, focusId) {
  if (focusId && S.byId.has(focusId)) { IV.scope = 'person'; IV.focus = focusId; }
  const counts = { nah: S.me ? buildQuestions('nah').length : 0, alle: buildQuestions('alle').length };
  main.innerHTML = `<div class="page iv-page">
    <div class="page-head"><div><div class="eyebrow">Gemeinsam vervollständigen</div><h1>Interview</h1></div></div>
    <div id="ivBody"></div></div>`;
  const body = $('#ivBody');
  if (IV.queue.length && IV.i < IV.queue.length && !focusId) return ivQuestion(body);
  body.innerHTML = `<div class="card iv-start">
    <p class="iv-lede">Der Stammbaum stellt dir Fragen zu Lücken: fehlende Geburtsdaten, Partner, Eltern von Angeheirateten, Belege … Beantworte, was du weißt – alles andere einfach überspringen.</p>
    <div class="iv-choices">
      <button class="iv-choice" data-scope="nah" ${S.me ? '' : 'disabled'}><b>Meine nahe Familie</b><span>${S.me ? `${counts.nah} offene Fragen rund um dich` : 'Erst oben rechts „Wer bist du?“ wählen'}</span></button>
      <button class="iv-choice" data-scope="alle"><b>Den ganzen Stammbaum</b><span>${counts.alle} offene Fragen, älteste Generationen zuerst</span></button>
      <div class="iv-choice as-div"><b>Zu einer bestimmten Person</b><input class="input" id="ivPick" placeholder="Name suchen …" style="margin-top:8px"></div>
    </div>
    ${!isAdmin() ? `<label class="fld" style="margin-top:18px;max-width:340px"><span>Dein Name (damit die Verwaltung nachfragen kann)</span><input class="input" id="ivAuthor" value="${esc(LS.get('stb.author', '') || (S.me ? fullName(S.byId.get(S.me)) : ''))}"></label>` : '<p class="hint" style="margin-top:14px">Als Admin werden deine Antworten sofort übernommen.</p>'}
    ${LS.get('stb.iv.done', []).length ? `<p class="hint">${LS.get('stb.iv.done', []).length} Fragen hast du auf diesem Gerät schon beantwortet oder übersprungen. <button class="btn sm ghost" id="ivReset">Wieder alle zeigen</button></p>` : ''}
  </div>`;
  const begin = (scope, focus) => {
    if (!isAdmin()) { const a = $('#ivAuthor').value.trim(); if (!a) { $('#ivAuthor').focus(); toast('Bitte deinen Namen eintragen', true); return; } LS.set('stb.author', a); }
    IV.scope = scope; IV.focus = focus || null; IV.queue = buildQuestions(scope, focus); IV.i = 0; IV.sent = 0;
    ivQuestion(body);
  };
  body.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => begin(b.dataset.scope));
  attachPicker($('#ivPick'), (p) => begin('person', p.id));
  $('#ivReset')?.addEventListener('click', () => { LS.set('stb.iv.done', []); viewInterview(main); });
  if (focusId && S.byId.has(focusId)) begin('person', focusId);
}

function ivMarkDone(key) { const d = LS.get('stb.iv.done', []); if (!d.includes(key)) { d.push(key); LS.set('stb.iv.done', d.slice(-3000)); } }

function ivQuestion(body) {
  if (IV.i >= IV.queue.length) {
    body.innerHTML = `<div class="card iv-done"><div class="iv-big">Danke!</div>
      <p>${IV.sent ? `Du hast ${IV.sent} ${IV.sent === 1 ? 'Antwort' : 'Antworten'} ${isAdmin() ? 'eingetragen' : 'an die Verwaltung geschickt'}.` : 'Für diese Auswahl gibt es gerade keine offenen Fragen.'}</p>
      <div class="btn-row" style="justify-content:center"><button class="btn primary" id="ivAgain">Weitere Fragen</button><a class="btn" href="#/">Zur Übersicht</a></div></div>`;
    $('#ivAgain').onclick = () => { IV.queue = []; viewInterview($('#main')); };
    if (isAdmin()) refresh();
    return;
  }
  const q = IV.queue[IV.i], p = q.p, first = esc(p.firstName.split(' ')[0] || fullName(p));
  const rel = S.me && S.me !== p.id ? kinship(S.me, p.id) : null;
  const relTxt = rel && rel.kind !== 'none' ? rel.term : relLabel(p);
  const name = esc(fullName(p));
  let ask = '', input = '';
  const dateIn = (n, ph = 'TT.MM.JJJJ (oder nur Jahr)') => `<input class="input iv-in" name="${n}" placeholder="${ph}" inputmode="decimal" data-date autofocus>`;
  const pair = (prefix, label) => `<div class="iv-grid"><input class="input" name="${prefix}First" placeholder="${label} – Vorname"><input class="input" name="${prefix}Last" placeholder="Nachname / Geburtsname"><input class="input" name="${prefix}Birth" placeholder="geboren (TT.MM.JJJJ / Jahr)" data-date><input class="input" name="${prefix}Death" placeholder="gestorben (falls zutreffend)" data-date></div>`;
  switch (q.type) {
    case 'alive': ask = `Lebt ${name} (* ${esc(p.birth)}) noch?`; input = `<div class="iv-opts"><label><input type="radio" name="alive" value="nein"> Nein, ist verstorben</label><label><input type="radio" name="alive" value="ja"> Ja</label></div>${dateIn('death', 'Sterbedatum, falls bekannt')}`; break;
    case 'lastName': ask = `Wie lautet der Nachname von ${name}?`; input = `<input class="input iv-in" name="lastName" autofocus>`; break;
    case 'birth': ask = `Wann wurde ${name} geboren?`; input = dateIn('birth', p.birth ? `bisher: ${esc(p.birth)} – genauer?` : undefined); break;
    case 'deathDate': ask = `An welchem Tag ist ${name} gestorben?`; input = dateIn('death', `bisher: ${esc(p.death)}`); break;
    case 'sex': ask = `Ist ${name} …`; input = `<div class="iv-opts">${[['w', 'weiblich'], ['m', 'männlich'], ['d', 'divers']].map(([v, t]) => `<label><input type="radio" name="sex" value="${v}"> ${t}</label>`).join('')}</div>`; break;
    case 'marriage': ask = `Wann haben ${name} und ${esc(fullName(S.byId.get(p.partnerOf)))} geheiratet?`; input = `${dateIn('marriage')}<label class="check" style="margin-top:8px"><input type="checkbox" name="unmarried"> nicht verheiratet (Lebensgefährt/in)</label>`; break;
    case 'partnerParents': ask = `Wer sind die Eltern von ${name}?`; input = `<p class="hint" style="margin-top:0">Was du weißt – ein Name reicht schon.</p>${pair('m', 'Mutter')}${pair('v', 'Vater')}`; break;
    case 'partner': ask = `Ist oder war ${name} verheiratet bzw. in einer festen Partnerschaft?`; input = `<p class="hint" style="margin-top:0">Wenn ja: Name eintragen. Wenn nein: „Nein“ wählen.</p>${pair('pa', 'Partner/in')}<input class="input" name="paMarriage" placeholder="Heirat am (optional)" data-date style="margin-top:8px">`; break;
    case 'kids': ask = `Hat ${name} Kinder, die hier noch fehlen?`; input = `<p class="hint" style="margin-top:0">Ein Kind pro Zeile, gern mit Geburtsdatum: „Lena 12.03.2015“</p><textarea class="input" name="kids" placeholder="Vorname Geburtsdatum"></textarea>`; break;
    case 'birthPlace': ask = `Wo wurde ${name} geboren?`; input = `<input class="input iv-in" name="birthPlace" placeholder="Ort" autofocus>`; break;
    case 'city': ask = `Wo wohnt ${name} heute?`; input = `<input class="input iv-in" name="city" placeholder="Ort" autofocus>`; break;
    case 'source': ask = `Hast du eine Traueranzeige, Urkunde oder ein Foto von ${name}?`; input = `<button type="button" class="btn primary" id="ivSrc">Quelle hochladen</button>`; break;
  }
  const noLabel = { partner: 'Nein', kids: 'Nein, vollständig', alive: null, source: 'Habe ich nicht' }[q.type];
  body.innerHTML = `<form class="card iv-card" id="ivForm">
    <div class="iv-progress"><span style="width:${(IV.i / IV.queue.length * 100).toFixed(1)}%"></span></div>
    <div class="iv-meta">Frage ${IV.i + 1} von ${IV.queue.length}</div>
    <a class="iv-who" href="#/p/${esc(p.id)}" target="_blank" rel="noopener">${avatar(p)}<span>${name}<small>${esc([lifespan(p), relTxt].filter(Boolean).join(' · '))}</small></span></a>
    <h2 class="iv-q">${ask}</h2>
    <div class="iv-input">${input}</div>
    <div class="err" id="ivErr"></div>
    <div class="iv-actions">
      <button type="button" class="btn ghost" data-iv="back" ${IV.i ? '' : 'disabled'}>← Zurück</button>
      <span style="flex:1"></span>
      <button type="button" class="btn" data-iv="unknown">Weiß ich nicht</button>
      ${noLabel ? `<button type="button" class="btn" data-iv="no">${noLabel}</button>` : ''}
      ${q.type !== 'source' ? '<button class="btn primary">Speichern &amp; weiter</button>' : '<button type="button" class="btn" data-iv="skip">Weiter</button>'}
    </div>
    <div class="iv-foot"><button type="button" class="btn sm ghost" data-iv="stop">Interview beenden</button></div>
  </form>`;
  const form = $('#ivForm');
  $$('[data-date]', form).forEach(i => i.addEventListener('blur', () => { i.value = normDate(i.value); }));
  form.querySelector('[autofocus]')?.focus();
  const next = (markKey = true) => { if (markKey) ivMarkDone(q.key); IV.i++; ivQuestion(body); };
  $('#ivSrc')?.addEventListener('click', () => { openSourceForm({ person: p }); next(); });
  form.addEventListener('click', (e) => {
    const a = e.target.closest('[data-iv]')?.dataset.iv; if (!a) return;
    if (a === 'back') { IV.i = Math.max(0, IV.i - 1); ivQuestion(body); }
    if (a === 'unknown' || a === 'skip') next();
    if (a === 'stop') { IV.queue = []; viewInterview($('#main')); }
    if (a === 'no') {
      if (q.type === 'partner' || q.type === 'kids' || q.type === 'source') next();
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form); const v = (k) => (fd.get(k) || '').toString().trim();
    const actions = [];
    const fieldsFrom = (prefix, extra = {}) => Object.assign({ firstName: v(prefix + 'First'), lastName: v(prefix + 'Last'), birth: normDate(v(prefix + 'Birth')), death: normDate(v(prefix + 'Death')) }, extra);
    switch (q.type) {
      case 'alive': if (v('alive') === 'nein') actions.push({ patch: { death: normDate(v('death')) || 'verstorben' } }); else if (v('alive') !== 'ja') return ivErr('Bitte „Ja“ oder „Nein“ wählen – oder „Weiß ich nicht“.'); break;
      case 'lastName': case 'birthPlace': case 'city': if (!v(q.type)) return ivErr('Bitte etwas eintragen – oder „Weiß ich nicht“.'); actions.push({ patch: { [q.type]: v(q.type) } }); break;
      case 'birth': case 'deathDate': { const k = q.type === 'birth' ? 'birth' : 'death'; const d = normDate(v(k)); if (!d) return ivErr('Bitte ein Datum oder Jahr eintragen.'); actions.push({ patch: { [k]: d } }); break; }
      case 'sex': if (!v('sex')) return ivErr('Bitte auswählen.'); actions.push({ patch: { sex: v('sex') } }); break;
      case 'marriage': if (fd.get('unmarried')) actions.push({ patch: { notes: [p.notes, 'Nicht verheiratet (Lebensgemeinschaft).'].filter(Boolean).join('\n') } }); else if (v('marriage')) actions.push({ patch: { marriage: normDate(v('marriage')) } }); else return ivErr('Bitte ein Datum eintragen – oder „Weiß ich nicht“.'); break;
      case 'partnerParents':
        for (const [pre, sex] of [['m', 'w'], ['v', 'm']]) if (v(pre + 'First') || v(pre + 'Last')) actions.push({ create: 'origin', role: 'parent', fields: fieldsFrom(pre, { sex }) });
        if (!actions.length) return ivErr('Bitte mindestens einen Namen eintragen.');
        break;
      case 'partner':
        if (!v('paFirst') && !v('paLast')) return ivErr('Bitte einen Namen eintragen – oder „Nein“.');
        actions.push({ create: 'partner', fields: fieldsFrom('pa', { marriage: normDate(v('paMarriage')) }) });
        break;
      case 'kids': {
        const lines = v('kids').split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return ivErr('Bitte mindestens ein Kind eintragen – oder „Nein, vollständig“.');
        for (const l of lines) {
          const m = /(\d{1,2}[.,]\d{1,2}[.,]\d{4}|\d{4})\s*$/.exec(l);
          const nm = (m ? l.slice(0, m.index) : l).trim(); const parts = nm.split(/\s+/);
          const last = parts.length > 1 && /^[A-ZÄÖÜ]/.test(parts[parts.length - 1]) && parts.length > 2 ? parts.pop() : p.lastName;
          actions.push({ create: 'child', fields: { firstName: parts.join(' '), lastName: last || '', birth: m ? normDate(m[1]) : '' } });
        }
        break;
      }
    }
    const btn = form.querySelector('.btn.primary'); btn.disabled = true;
    try {
      for (const a of actions) await ivSend(p, a);
      IV.sent += actions.length; next();
    } catch (err) { ivErr(err.message); btn.disabled = false; }
  };
  function ivErr(m) { $('#ivErr').textContent = m; }
}

async function ivSend(p, a) {
  const author = LS.get('stb.author', '') || 'Interview';
  const blank = { firstName: '', lastName: '', birthName: '', sex: '', birth: '', birthPlace: '', death: '', deathPlace: '', marriage: '', street: '', zip: '', city: '', notes: '', custom: [] };
  if (a.patch) {
    if (isAdmin()) return api('PATCH', `/api/personen/${p.id}`, { fields: a.patch, who: 'Admin (Interview)' });
    return api('POST', '/api/vorschlaege', { type: 'edit', targetId: p.id, fields: a.patch, author, message: 'Aus dem Interview' });
  }
  const fields = Object.assign({}, blank, a.fields);
  if (isAdmin()) return api('POST', '/api/personen', { kind: a.create, role: a.role, anchorId: p.id, fields });
  return api('POST', '/api/vorschlaege', { type: a.create, role: a.role, targetId: p.id, fields, author, message: 'Aus dem Interview' });
}

// ================= Verwaltung =================
const FIELD_LABELS = { firstName: 'Vorname', lastName: 'Nachname', birthName: 'Geburtsname', sex: 'Geschlecht', birth: 'Geboren', birthPlace: 'Geburtsort',
  death: 'Gestorben', deathPlace: 'Sterbeort', marriage: 'Heirat', divorced: 'Geschieden', street: 'Straße', zip: 'PLZ', city: 'Ort', notes: 'Notizen',
  custom: 'Eigene Felder', code: 'Kennung', parentIds: 'Eltern', role: 'Beziehung', parentId: 'Elternteil', otherParentId: 'Zweites Elternteil', partnerOf: 'Partner von' };
function fmtVal(k, v) {
  if (k === 'custom') return (v || []).map(c => `${c.label}: ${c.value}`).join('; ');
  if (k === 'divorced') return v ? 'ja' : 'nein';
  if (k === 'parentIds') return v && v.length ? v.map(id => fullName(S.byId.get(id))).join(' & ') : 'beide Eltern';
  if (k === 'role') return ROLE_TXT[v] || v;
  if (k === 'sex') return ({ m: 'männlich', w: 'weiblich', d: 'divers' })[v] || '–';
  if (['parentId', 'otherParentId', 'partnerOf'].includes(k)) return v ? fullName(S.byId.get(v)) : (k === 'otherParentId' ? 'anderer/unbekannter Elternteil' : '–');
  return v;
}
function fmtTime(iso) { const d = new Date(iso); return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }

async function viewAdmin(main, tab) {
  const tabs = [['vorschlaege', `Vorschläge${S.openSugg ? ` <span class="badge">${S.openSugg}</span>` : ''}`], ['protokoll', 'Änderungsprotokoll'], ['pruefung', 'Datenprüfung'], ['daten', 'Sichern & Einlesen']];
  main.innerHTML = `<div class="page"><div class="page-head"><div><div class="eyebrow">Nur für Admins</div><h1>Verwaltung</h1></div></div>
    <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/admin/${k}"${k === tab ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav><div id="at"><div class="empty">Lädt …</div></div></div>`;
  const at = $('#at');
  try {
    if (tab === 'vorschlaege') await adminSuggestions(at);
    else if (tab === 'protokoll') await adminLog(at);
    else if (tab === 'pruefung') adminChecks(at);
    else adminData(at);
  } catch (e) { at.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

async function adminSuggestions(at) {
  const list = await api('GET', '/api/vorschlaege');
  const open = list.filter(s => s.status === 'offen'), done = list.filter(s => s.status !== 'offen');
  S.openSugg = open.length;
  const typeTxt = { edit: 'Änderung', child: 'Neues Kind', partner: 'Neue/r Partner/in', remark: 'Hinweis', source: 'Neue Quelle', origin: 'Herkunftsfamilie' };
  const card = (s) => {
    const t = S.byId.get(s.targetId);
    let body = '';
    if (s.type === 'edit' && t) {
      const rows = Object.entries(s.fields || {}).filter(([k, v]) => JSON.stringify(t[k] ?? '') !== JSON.stringify(v ?? ''));
      if (s.structure && t.kind === 'origin' && Array.isArray(s.structure.parentIds) && s.structure.parentIds.join() !== (t.parentIds || []).join()) rows.push(['parentIds', s.structure.parentIds]);
      else if (s.structure && t.kind !== 'origin') for (const k of ['parentId', 'otherParentId']) if ((s.structure[k] || null) !== (t[k] || null)) rows.push([k, s.structure[k]]);
      body = rows.length ? `<table class="diff">${rows.map(([k, v]) => `<tr><td>${esc(FIELD_LABELS[k] || k)}</td><td>${t[k] !== '' && t[k] !== undefined && JSON.stringify(t[k]) !== '[]' ? `<del>${esc(fmtVal(k, t[k]))}</del> ` : ''}<ins>${esc(fmtVal(k, v)) || '(leer)'}</ins></td></tr>`).join('')}</table>` : '<p class="muted">Inhalt entspricht bereits dem aktuellen Stand.</p>';
    } else if (s.type === 'source' && s.source) {
      const src = `/api/vorschlaege/${esc(s.id)}/quelle`;
      body = `<div class="sugg-src">${s.source.mime === 'application/pdf' ? `<a class="btn" href="${src}" target="_blank" rel="noopener">PDF ansehen</a>` : `<a href="${src}" target="_blank" rel="noopener"><img src="${src}?vorschau" alt=""></a>`}
        <table class="diff"><tr><td>Art</td><td>${esc(s.source.kind)}</td></tr><tr><td>Titel</td><td>${esc(s.source.title)}</td></tr>${s.source.date ? `<tr><td>Datum</td><td>${esc(s.source.date)}</td></tr>` : ''}</table></div>`;
    } else if (s.fields) {
      if (s.type === 'origin') body = `<p style="margin:6px 0 0"><span class="pill info">${ROLE_TXT[s.role] || 'Elternteil'} von ${esc(s.targetName)}</span></p>`;
      const rows = Object.entries(s.fields).filter(([, v]) => v && !(Array.isArray(v) && !v.length));
      body += `<table class="diff">${rows.map(([k, v]) => `<tr><td>${esc(FIELD_LABELS[k] || k)}</td><td><ins>${esc(fmtVal(k, v))}</ins></td></tr>`).join('')}</table>`;
    }
    return `<div class="card sugg" data-sid="${esc(s.id)}">
      <div class="sugg-head"><h3>${typeTxt[s.type]}: ${t ? `<a href="#/p/${esc(t.id)}">${esc(fullName(t))}</a>` : esc(s.targetName)}</h3>
        <span class="muted" style="font-size:13px">von <b>${esc(s.author)}</b> · ${fmtTime(s.createdAt)} ${s.status !== 'offen' ? `<span class="pill ${s.status === 'übernommen' ? 'ok' : 'warn'}">${esc(s.status)}</span>` : ''}</span></div>
      ${s.message ? `<div class="msg">${esc(s.message)}</div>` : ''}
      ${body}
      ${s.hasPhoto && s.status === 'offen' ? `<p>Neues Foto: <img src="/api/vorschlaege/${esc(s.id)}/foto.jpg" alt="" style="height:80px;border-radius:8px;vertical-align:middle"></p>` : ''}
      ${s.status === 'offen' ? `<div class="btn-row">
        ${s.type !== 'remark' ? '<button class="btn primary" data-sa="annehmen">Übernehmen</button>' : '<button class="btn primary" data-sa="annehmen">Erledigt</button>'}
        ${!['remark', 'source'].includes(s.type) ? '<button class="btn" data-sa="edit">Anpassen & übernehmen</button>' : ''}
        <button class="btn danger" data-sa="ablehnen">Ablehnen</button></div>` : ''}
    </div>`;
  };
  at.innerHTML = `${open.length ? open.map(card).join('') : '<div class="card empty">Keine offenen Vorschläge. 🎉</div>'}
    ${done.length ? `<details style="margin-top:24px"><summary class="muted" style="cursor:pointer">Erledigte Vorschläge (${done.length})</summary><div style="margin-top:12px">${done.slice(0, 100).map(card).join('')}</div></details>` : ''}`;
  at.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sa]'); if (!b) return;
    const sid = b.closest('[data-sid]').dataset.sid; const s = list.find(x => x.id === sid);
    if (b.dataset.sa === 'edit') return openSuggestionEditor(s);
    b.disabled = true;
    try {
      await api('POST', `/api/vorschlaege/${sid}/${b.dataset.sa}`, {});
      toast(b.dataset.sa === 'annehmen' ? 'Übernommen' : 'Abgelehnt');
      await loadData(); shell(); router();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  });
}
function openSuggestionEditor(s) {
  const t = S.byId.get(s.targetId);
  const base = s.type === 'edit' ? Object.assign({}, t, s.fields) : Object.assign({ kind: s.type === 'partner' ? 'partner' : s.type === 'origin' ? 'origin' : 'blood' }, s.fields);
  const keys = ['firstName', 'lastName', 'birthName', 'birth', 'birthPlace', 'death', 'deathPlace', 'street', 'zip', 'city'];
  if (base.kind === 'partner') keys.splice(7, 0, 'marriage');
  const dlg = dialog(`<form id="sf"><div class="dlg-head"><h2>Vorschlag anpassen</h2><p>Von ${esc(s.author)} – Werte vor dem Übernehmen korrigieren.</p></div>
    <div class="dlg-body"><div class="form-grid">${keys.map(k => `<label class="fld"><span>${FIELD_LABELS[k]}</span><input class="input" name="${k}" value="${esc(base[k] || '')}"></label>`).join('')}
    <label class="fld"><span>Geschlecht</span><select class="input" name="sex">${[['', 'unbekannt'], ['w', 'weiblich'], ['m', 'männlich'], ['d', 'divers']].map(([v, x]) => `<option value="${v}"${base.sex === v ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    <label class="fld full"><span>Notizen</span><textarea class="input" name="notes">${esc(base.notes || '')}</textarea></label>
    <label class="fld full"><span>Antwort/Notiz (optional, nur intern)</span><input class="input" name="reply"></label></div><div class="err" id="sfErr"></div></div>
    <div class="dlg-foot"><button type="button" class="btn" data-cancel>Abbrechen</button><button class="btn primary">Übernehmen</button></div></form>`);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  $('#sf', dlg).onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const fields = Object.assign({}, base);
    for (const k of [...keys, 'sex', 'notes']) fields[k] = (fd.get(k) || '').toString();
    for (const k of ['birth', 'death', 'marriage']) if (fields[k]) fields[k] = normDate(fields[k]);
    delete fields.kind;
    const clean = {};
    for (const k of Object.keys(FIELD_LABELS)) if (k in fields && !['code', 'parentId', 'otherParentId', 'partnerOf'].includes(k)) clean[k] = fields[k];
    try {
      await api('POST', `/api/vorschlaege/${s.id}/annehmen`, { fields: clean, reply: fd.get('reply') });
      dlg.close(); toast('Übernommen'); await loadData(); shell(); router();
    } catch (err) { $('#sfErr', dlg).textContent = err.message; }
  };
}

async function adminLog(at) {
  const log = await api('GET', '/api/protokoll');
  at.innerHTML = log.length ? `<div class="card">${log.map(l => `<div class="log-row"><time>${fmtTime(l.at)}</time><div>
    <b>${esc(l.action)}</b> · ${l.personId && S.byId.has(l.personId) ? `<a href="#/p/${esc(l.personId)}">${esc(l.name)}</a>` : esc(l.name || '')} <span class="muted">· ${esc(l.who)}</span>
    ${l.changes ? `<table class="diff">${Object.entries(l.changes).map(([k, [a, b]]) => `<tr><td>${esc(FIELD_LABELS[k] || k)}</td><td>${a !== '' && a !== null ? `<del>${esc(fmtVal(k, a))}</del> ` : ''}<ins>${esc(fmtVal(k, b)) || '(leer)'}</ins></td></tr>`).join('')}</table>` : ''}
  </div></div>`).join('')}</div>` : '<div class="card empty">Noch keine Änderungen protokolliert.</div>';
}

function adminChecks(at) {
  const groups = [];
  const add = (title, items, hint) => groups.push({ title, items, hint });
  const link = (p, extra = '') => `<a href="#/p/${esc(p.id)}">${esc(fullName(p))}</a>${extra ? ' – ' + esc(extra) : ''}`;
  const codes = new Map(); S.persons.forEach(p => { if (p.code) { if (!codes.has(p.code)) codes.set(p.code, []); codes.get(p.code).push(p); } });
  add('Doppelte Kennungen', [...codes.entries()].filter(([, l]) => l.length > 1).map(([c, l]) => `${esc(c)}: ${l.map(p => link(p)).join(', ')}`), 'Die alte Excel-Kennung ist doppelt vergeben – für die App unkritisch, aber zur Ordnung anpassen.');
  add('Ungewöhnliches Datumsformat', S.persons.flatMap(p => ['birth', 'death', 'marriage'].filter(k => p[k] && !/^(\d{2}\.\d{2}\.\d{4}|\d{1,2}\.\d{4}|\d{4})$/.test(p[k])).map(k => link(p, `${FIELD_LABELS[k]}: „${p[k]}“`))));
  add('Über 100 Jahre ohne Sterbedatum', S.persons.filter(p => !p.death && ageNow(p) > 100).map(p => link(p, `* ${p.birth}`)), 'Werden nicht bei den Geburtstagen gezeigt. Sterbedatum (oder Jahr) ergänzen.');
  add('Nachname wiederholt sich im Vornamen', S.persons.filter(p => p.lastName && p.firstName.split(' ').slice(1).includes(p.lastName)).map(p => link(p)), 'Vermutlich wurde der Nachname doppelt eingetragen (z. B. „Christopher Dean Dean“).');
  add('Ohne Nachnamen', S.persons.filter(p => !p.lastName).map(p => link(p)));
  add('Familie (lebend) ohne Geburtsdatum', S.persons.filter(p => p.kind === 'blood' && !p.death && !p.birth).map(p => link(p)));
  add('Kind deutlich vor/nach den Eltern', S.persons.filter(p => {
    const par = S.byId.get(p.parentId); const yc = yearOf(p.birth), yp = par && yearOf(par.birth);
    if (!yc || !yp) return false; const dp = yearOf(par.death);
    return yc - yp < 14 || yc - yp > 60 || (dp && yc > dp + 1);
  }).map(p => link(p, `* ${yearOf(p.birth)}, Elternteil * ${yearOf(S.byId.get(p.parentId).birth)}`)));
  add('Angeheiratete ohne erfasste Eltern', S.persons.filter(p => p.kind === 'partner' && !originParents(p.id).length).map(p => link(p, 'Partner/in von ' + fullName(S.byId.get(p.partnerOf)))), 'Lässt sich auf der Personenseite oder im Interview ergänzen.');
  add('Verstorben ohne Quelle', S.persons.filter(p => p.death && p.kind !== 'origin' && !S.sources.some(s => (s.personIds || []).includes(p.id))).map(p => link(p, '† ' + p.death)), 'Traueranzeige, Sterbeurkunde oder Stammbuchauszug als Beleg hinterlegen.');
  add('Geschlecht unbekannt', S.persons.filter(p => !p.sex).map(p => link(p)), 'Wird für Begriffe wie „Tante“ statt „Onkel/Tante“ gebraucht. Beim Einlesen wurde es aus dem Vornamen geschätzt – bitte stichprobenartig prüfen.');
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  at.innerHTML = `<p class="muted">${total} Auffälligkeiten – nichts davon ist ein Fehler im Programm, nur Hinweise zur Datenpflege.</p>
    ${groups.filter(g => g.items.length).map(g => `<div class="card check-group"><h3>${esc(g.title)} <span class="pill">${g.items.length}</span></h3>${g.hint ? `<p class="hint" style="margin:0 0 8px">${esc(g.hint)}</p>` : ''}<ul class="check-list">${g.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`).join('')}`;
}

function adminData(at) {
  at.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><h2>Weitere Stammlinie</h2><p class="hint" style="margin-top:0">Eine zusätzliche oberste Person anlegen, z. B. für eine zweite Familienlinie, die (noch) nicht verbunden ist.</p>
      <button class="btn" id="addRoot2">Stammperson anlegen</button></div>
    <div class="card"><h2>Herunterladen</h2><p class="hint" style="margin-top:0">Komplette Sicherung zum Aufbewahren oder Weitergeben.</p>
      <div class="btn-row"><a class="btn primary" href="/api/export.json">Sicherung (JSON)</a><a class="btn" href="/api/export.csv">Tabelle für Excel (CSV)</a></div>
      <p class="hint">Zusätzlich legt der Server automatisch täglich eine Sicherung im Datenordner an (Ordner <code>backups</code>).</p></div>
    <div class="card"><h2>Einlesen</h2><p class="hint" style="margin-top:0">Ersetzt den kompletten Stammbaum durch eine Sicherung – vorher wird automatisch der aktuelle Stand gesichert. Funktioniert auch mit Dateien aus dem alten HTML-Stammbaum.</p>
      <input type="file" accept=".json,application/json" id="impFile"><div class="err" id="impErr" style="margin-top:8px"></div></div>
  </div>`;
  $('#addRoot2').onclick = () => openPersonForm({ mode: 'root' });
  $('#impFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm('Den gesamten Stammbaum durch den Inhalt dieser Datei ersetzen?')) return;
      const r = await api('POST', '/api/import', { data });
      toast(`${r.count} Personen eingelesen`); await refresh();
    } catch (err) { $('#impErr').textContent = err.message; }
  };
}

// ================= Start =================
async function start() {
  try {
    const me = await api('GET', '/api/me');
    S.title = me.title || 'Stammbaum'; S.role = me.role; S.icsPath = me.icsPath;
    S.version = { version: me.version, commit: me.commit, repo: me.repo };
    if (!S.role) return renderLogin();
    await loadData();
    shell(); router();
  } catch (e) {
    if (S.role !== null) $('#app').innerHTML = `<div class="page"><div class="err">${esc(e.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', router);
start();
