'use strict';
// Geburtstagskalender (iCalendar) für lebende Familienmitglieder
const FULL = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function fold(line) {
  const out = []; let s = line;
  while (Buffer.byteLength(s) > 74) { let i = 74; while (Buffer.byteLength(s.slice(0, i)) > 74) i--; out.push(s.slice(0, i)); s = ' ' + s.slice(i); }
  out.push(s); return out.join('\r\n');
}
const pad = (n) => String(n).padStart(2, '0');

function birthdayCalendar(persons, title) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Familien-Stammbaum//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc('Familie – ' + (title || 'Stammbaum').replace(/^Stammbaum\s+/i, ''))}`, 'X-WR-TIMEZONE:Europe/Berlin',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D'];
  for (const p of persons) {
    if (p.death || p.kind === 'origin') continue;
    const m = FULL.exec(p.birth || '');
    if (!m) continue;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    const leap = d === 29 && mo === 2;
    lines.push('BEGIN:VEVENT', `UID:geb-${p.id}@stammbaum`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${y}${pad(mo)}${pad(d)}`,
      leap ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'RRULE:FREQ=YEARLY',
      fold(`SUMMARY:${esc('🎂 ' + name + ' (*' + y + ')')}`),
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  // Hochzeitstage (nicht geschieden, beide leben)
  const byId = new Map(persons.map(p => [p.id, p]));
  for (const s of persons) {
    if (s.kind !== 'partner' || s.divorced || s.death) continue;
    const b = byId.get(s.partnerOf); if (!b || b.death) continue;
    const m = FULL.exec(s.marriage || ''); if (!m) continue;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const names = b.lastName && b.lastName === s.lastName ? `${b.firstName} & ${s.firstName} ${b.lastName}` : `${[b.firstName, b.lastName].join(' ')} & ${[s.firstName, s.lastName].join(' ')}`;
    lines.push('BEGIN:VEVENT', `UID:hochzeit-${s.id}@stammbaum`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${y}${pad(mo)}${pad(d)}`,
      d === 29 && mo === 2 ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'RRULE:FREQ=YEARLY',
      fold(`SUMMARY:${esc('💍 Hochzeitstag ' + names + ' (' + y + ')')}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { birthdayCalendar };
