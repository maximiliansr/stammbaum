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
    `X-WR-CALNAME:${esc('Geburtstage – ' + (title || 'Familie'))}`, 'X-WR-TIMEZONE:Europe/Berlin',
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
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { birthdayCalendar };
