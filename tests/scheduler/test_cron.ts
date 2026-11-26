import { parseSchedule, nextRunAfter, toWallClock, fromWallClock, isValidTimeZone } from '../../src/server/scheduler/cron.js';

const TZ = 'Africa/Lagos';
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

console.log('=== parse ===');
const cases: [string, string][] = [
  ['every 2 minutes', 'interval'],
  ['every 30 seconds', 'interval'],
  ['every 6 hours', 'interval'],
  ['every day at 08:00', 'cron'],
  ['daily at 8am', 'cron'],
  ['every monday at 09:30', 'cron'],
  ['weekly on friday at 17:00', 'cron'],
  ['every month on the 1st at 07:00', 'cron'],
  ['0 8 * * *', 'cron'],
  ['*/15 * * * *', 'cron'],
  ['2026-12-25T09:00:00Z', 'once'],
];
for (const [expr, kind] of cases) {
  const p = parseSchedule(expr);
  check(`parse "${expr}"`, p.ok && p.kind === kind, p.ok ? `-> ${p.kind}` : `-> ${(p as any).error}`);
}
for (const bad of ['', 'every 5 seconds', 'nonsense', '99 99 * * *', '0 8 * *']) {
  const p = parseSchedule(bad);
  check(`reject "${bad}"`, !p.ok);
}

console.log('=== next run: every 2 minutes ===');
const iv = parseSchedule('every 2 minutes');
if (iv.ok) {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  const n1 = nextRunAfter(iv, now, TZ)!;
  check('interval +120s', n1 - now === 120000, `(${(n1-now)/1000}s)`);
}

console.log('=== next run: daily 08:00 Lagos (UTC+1) ===');
const daily = parseSchedule('every day at 08:00');
if (daily.ok) {
  // 2026-11-26 06:00 UTC = 07:00 Lagos -> next 08:00 Lagos = 07:00 UTC
  const now = Date.UTC(2026, 10, 26, 6, 0, 0);
  const n = nextRunAfter(daily, now, TZ)!;
  const wc = toWallClock(n, TZ);
  check('lands at 08:00 local', wc.hour === 8 && wc.minute === 0, `-> ${wc.hour}:${String(wc.minute).padStart(2,'0')} local`);
  check('is 07:00 UTC', new Date(n).getUTCHours() === 7, `-> ${new Date(n).toISOString()}`);
}

console.log('=== DST: America/New_York daily 08:00 across spring-forward ===');
const ny = parseSchedule('every day at 08:00');
if (ny.ok) {
  // 2027-03-13 12:00 UTC (before DST starts 2027-03-14)
  const before = Date.UTC(2027, 2, 13, 12, 0, 0);
  const n1 = nextRunAfter(ny, before, 'America/New_York')!;
  const w1 = toWallClock(n1, 'America/New_York');
  check('day before DST: 08:00 local', w1.hour === 8, `-> ${w1.hour}:${w1.minute} on ${w1.month}/${w1.day}`);
  const n2 = nextRunAfter(ny, n1, 'America/New_York')!;
  const w2 = toWallClock(n2, 'America/New_York');
  check('day after DST: still 08:00 local', w2.hour === 8, `-> ${w2.hour}:${w2.minute} on ${w2.month}/${w2.day}`);
  check('UTC hour shifted by 1 (DST proof)', new Date(n1).getUTCHours() !== new Date(n2).getUTCHours(),
    `-> ${new Date(n1).getUTCHours()}Z vs ${new Date(n2).getUTCHours()}Z`);
}

console.log('=== weekly monday ===');
const mon = parseSchedule('every monday at 09:30');
if (mon.ok) {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0); // Thu 26 Nov 2026
  const n = nextRunAfter(mon, now, TZ)!;
  const wc = toWallClock(n, TZ);
  check('lands on Monday', wc.weekday === 1, `-> weekday ${wc.weekday}`);
  check('at 09:30', wc.hour === 9 && wc.minute === 30, `-> ${wc.hour}:${wc.minute}`);
}

console.log('=== monthly 1st ===');
const m1 = parseSchedule('every month on the 1st at 07:00');
if (m1.ok) {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  const n = nextRunAfter(m1, now, TZ)!;
  const wc = toWallClock(n, TZ);
  check('lands on the 1st', wc.day === 1, `-> day ${wc.day} month ${wc.month}`);
  check('at 07:00', wc.hour === 7, `-> ${wc.hour}:${wc.minute}`);
}

console.log('=== cron */15 ===');
const c15 = parseSchedule('*/15 * * * *');
if (c15.ok) {
  const now = Date.UTC(2026, 10, 26, 12, 7, 0);
  const n = nextRunAfter(c15, now, TZ)!;
  const wc = toWallClock(n, TZ);
  check('next quarter hour', wc.minute === 15, `-> ${wc.hour}:${wc.minute}`);
}

console.log('=== timezone validity ===');
check('valid tz', isValidTimeZone('Africa/Lagos'));
check('invalid tz rejected', !isValidTimeZone('Not/AZone'));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
