/**
 * v4.5.0 SINGLE-SOURCE-OF-TRUTH TESTS — worker = bot's only trading-data source.
 *
 * T1 — /history reads the WORKER (/api/history) and renders worker rows 1:1
 * T2 — /stats reads the WORKER (/api/stats) winRate/sampleSize/bySession/byTF/byRegime
 * T3 — manual override posts the WORKER signal id to /api/report (idempotent)
 * T4 — no bot-side ledger writes remain (h:, pt:, cnt:, locks, reminders, …)
 * T5 — /best /heatmap /risk aggregate worker endpoints, never bot KV
 * T6 — cron summaries are worker-backed; cron has NO trading tasks
 *
 * Run: node single-source-test.mjs
 */
import { readFileSync } from 'fs';

const src = readFileSync('./src/index.js', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── extract a top-level function by name (brace-balanced) ────────────────────
function extractFn(code, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(code);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(m.index, i + 1); }
  }
  return null;
}

// ── sandbox deps (mirror src implementations — same as existing test style) ──
const SEP     = '━━━━━━━━━━━━━━━━━';
const esc     = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const disp    = p => (p ? ((!p.includes('/') && p.length === 6) ? p.slice(0,3) + '/' + p.slice(3) : p) : '?');
const isCr    = p => ['BTC','ETH','BNB','XRP','SOL','ADA','DOGE','AVAX','DOT','LINK'].some(b => String(p||'').startsWith(b));
const fmtPrice = (price, pair) => { const v = parseFloat(price); if (isNaN(v)) return '?'; return isCr(pair) ? v.toFixed(2) : v.toFixed(5); };
const msToHuman = ms => { if (ms <= 0) return 'expired'; const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000); return m > 0 ? `${m}m ${s}s` : `${s}s`; };
const shortId = id => String(id ?? '?').slice(-6);
const loadFn = (name, deps) => {
  const body = extractFn(src, name);
  if (!body) return null;
  return new Function(...Object.keys(deps), 'return (' + body + ')')(...Object.values(deps));
};

console.log('\n═══ T1 — HISTORY FROM WORKER ═══\n');

ok('fetchWorker helper exists (single worker client)', /async function fetchWorker/.test(src));
ok('fetchSig wraps fetchWorker', /async function fetchSig[\s\S]{0,300}fetchWorker/.test(src));
ok('doHist fetches worker /api/history', /async function doHist[\s\S]{0,400}\/api\/history\?pair=/.test(src));
ok('doHist has NO getHist (bot ledger read gone)', !/async function doHist[\s\S]{0,400}getHist/.test(src));
ok('history rows render short worker id (last 6)', src.includes('shortId(h.id)'));
ok('history rows render result / fill / entryHit / entry / expiry',
  src.includes('h.result') && src.includes('h.fillStatus') && src.includes('h.entryHit') &&
  src.includes('h.entryPrice') && src.includes('h.expiryTime'));

const fmtHistWorker = loadFn('fmtHistWorker', { SEP, esc, disp, fmtPrice, msToHuman, shortId });
ok('fmtHistWorker extractable for functional test', !!fmtHistWorker);

if (fmtHistWorker) {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `sig_1750000000_ab0${i}`, pair: 'EUR/USD',
    direction: i % 2 ? 'BUY' : 'SELL', confidence: '75%', grade: 'A+',
    entryPrice: 1.08 + i / 10000,
    result: i % 3 === 0 ? 'WIN' : null,
    fillStatus: 'INSTANT', entryHit: true,
    timestamp: '2026-08-10T10:00:00Z', expiryTime: '2026-08-10T10:05:00Z',
  }));
  const out = fmtHistWorker(rows, 0, { total: 10 });
  ok('renders header with worker total', out.includes('of 10'));
  // R2: a single worker signal appears EXACTLY ONCE in the rendered page
  let dups = 0;
  for (const r of rows) {
    const tag = '#' + r.id.slice(-6);
    const n = out.split(tag).length - 1;
    if (n !== 1) dups++;
  }
  ok('no duplicate ids in rendered history page (each worker id exactly once)', dups === 0, `dups=${dups}`);
  ok('renders direction + confidence + calibrated grade', out.includes('🟢') && out.includes('75%') && out.includes('[A+]'));
  ok('renders entry price', out.includes('💰'));
  ok('renders fill badge + entry hit', out.includes('⚡') && out.includes('✓'));
  ok('renders result icon for resolved rows', out.includes('✅'));
  ok('renders live countdown for pending rows', out.includes('left'));
  ok('empty state mentions the pair stream', fmtHistWorker([], 0, {}).includes('No signals yet for this pair'));
}

console.log('\n═══ T2 — STATS FROM WORKER ═══\n');

ok('doStats fetches worker /api/stats', /async function doStats[\s\S]{0,400}\/api\/stats\?pair=/.test(src));
ok('doStats has NO getHist / regime accumulators', !/async function doStats[\s\S]{0,800}getHist/.test(src) && !src.includes('getRegimeStats'));

const fmtStatsWorker = loadFn('fmtStatsWorker', { SEP, esc, disp, calcDrawdown: loadFn('calcDrawdown', {}) });
ok('fmtStatsWorker extractable for functional test', !!fmtStatsWorker);

if (fmtStatsWorker) {
  const stats = {
    totalSignals: 20, wins: 12, losses: 8, winRate: 0.667, sampleSize: 15,
    bySession: { LONDON: { wins: 5, losses: 3, winRate: 0.625 } },
    byTF: { '5min': { wins: 9, losses: 6, winRate: 0.6 } },
    byRegime: { TRENDING: { wins: 7, losses: 3, winRate: 0.7 } },
  };
  const hist = [
    { direction: 'BUY', result: 'WIN', grade: 'A+', timestamp: '2026-08-10T08:00:00Z' },
    { direction: 'BUY', result: 'WIN', grade: 'A+', timestamp: '2026-08-09T08:00:00Z' },
    { direction: 'SELL', result: 'LOSS', grade: 'B', timestamp: '2026-08-08T08:00:00Z' },
    { direction: 'SELL', result: null, grade: 'A', timestamp: '2026-08-10T09:00:00Z' },
  ];
  const out = fmtStatsWorker(stats, hist, 'EURUSD');
  ok('renders pair + worker wins/losses', out.includes('EUR/USD') && out.includes('✅ Wins: 12  ❌ Losses: 8'));
  ok('renders windowed winRate + sampleSize from worker', out.includes('Win Rate: 67% (last 15)'));
  ok('renders byRegime from worker', out.includes('TRENDING: 7W/3L (70%)'));
  ok('renders bySession from worker', out.includes('LONDON: 5W/3L (63%)'));
  ok('renders byTF from worker', out.includes('5min: 9W/6L (60%)'));
  ok('renders pending from worker history', out.includes('⏳ Pending: 1'));
  ok('renders grade breakdown from worker history', out.includes('[A+]') || out.includes('A+: 2W/0L'));
  ok('empty state when worker has no stats', fmtStatsWorker(null, [], 'EURUSD').includes('No resolved trades yet'));
}

console.log('\n═══ T3 — MANUAL OVERRIDE → WORKER /api/report ═══\n');

ok('doManualResult posts to /api/report with worker sig id',
  /api\/report\?id=\$\{encodeURIComponent\(sigId\)\}&result=\$\{result\}/.test(src));
ok('report call uses POST', src.includes("{ method: 'POST' }"));
ok('signalKb embeds worker sig id in button payloads',
  src.includes('res:win:${sigId}') && src.includes('res:loss:${sigId}'));
ok('res: callbacks slice the full worker sig id',
  src.includes("data.slice('res:win:'.length)") && src.includes("data.slice('res:loss:'.length)"));
ok('short tag is resolved via worker history (single lookup, no bot ledger)',
  src.includes("String(s.id).slice(-6) === raw"));
ok('idempotency note surfaced to user (alreadyRecorded)', src.includes('alreadyRecorded'));

const doManualResult = loadFn('doManualResult', { fetchWorker: null, getUser: null, reply: null, esc, SEP, disp, shortId, afterKb: () => ({}), mainKb: () => ({}) });
ok('doManualResult extractable for functional test', !!doManualResult);

if (doManualResult) {
  // full-id flow
  const calls = [];
  const fn = new Function('fetchWorker','getUser','reply','esc','SEP','disp','shortId','afterKb','mainKb',
    'return (' + extractFn(src, 'doManualResult') + ')');
  const doMR = fn(
    async (path, env, opts) => { calls.push({ path, opts }); return { success: true, pair: 'EUR/USD', signalId: 'sig_1750000000000_a1b2c', result: 'WIN', alreadyRecorded: false }; },
    async () => ({ pair: 'EURUSD' }),
    async (cid, mid, text) => ({ text }),
    esc, SEP, disp, shortId, () => ({}), () => ({})
  );
  await doMR(123, null, 'sig_1750000000000_a1b2c', 'WIN', {});
  ok('full id is posted to /api/report unchanged',
    calls.length === 1 && calls[0].path === '/api/report?id=sig_1750000000000_a1b2c&result=WIN', JSON.stringify(calls));
  ok('report is a POST', calls.length === 1 && calls[0].opts && calls[0].opts.method === 'POST');

  // short-id flow: lookup in worker history first, then report with FULL id
  // (worker ids are sig_<ts>_<suffix>; shortId() = last 6 chars of the full id)
  const calls2 = [];
  const doMR2 = fn(
    async (path, env, opts) => {
      calls2.push({ path, opts });
      if (path.startsWith('/api/history'))
        return { signals: [{ id: 'sig_1750000000000_ab1b2c', pair: 'EUR/USD', direction: 'BUY' }] };
      return { success: true, pair: 'EUR/USD', signalId: 'sig_1750000000000_ab1b2c', result: 'LOSS', alreadyRecorded: true };
    },
    async () => ({ pair: 'EURUSD' }),
    async (cid, mid, text) => ({ text }),
    esc, SEP, disp, shortId, () => ({}), () => ({})
  );
  await doMR2(123, null, 'ab1b2c', 'LOSS', {});
  ok('short tag triggers worker-history lookup then reports the FULL id',
    calls2.length === 2 && calls2[0].path.includes('/api/history?pair=EURUSD') &&
    calls2[1].path === '/api/report?id=sig_1750000000000_ab1b2c&result=LOSS', JSON.stringify(calls2));

  // ambiguous short tag → no report call, user is told to use the full id
  const calls3 = [];
  let ambiguityText = '';
  const doMR3 = fn(
    async (path) => {
      calls3.push(path);
      return { signals: [{ id: 'sig_1000000000000_ab1b2c' }, { id: 'sig_2000000000000_ab1b2c' }] };
    },
    async () => ({ pair: 'EURUSD' }),
    async (cid, mid, text) => { ambiguityText = text; return { text }; },
    esc, SEP, disp, shortId, () => ({}), () => ({})
  );
  await doMR3(123, null, 'ab1b2c', 'WIN', {});
  ok('ambiguous short tag never posts /api/report', calls3.length === 1, JSON.stringify(calls3));
  ok('ambiguous reply asks for the full id', ambiguityText.includes('Use the full id'));
}

console.log('\n═══ T4 — NO BOT-SIDE LEDGER WRITES ═══\n');

ok('no h: ledger writes', !/kput\(`h:/.test(src) && !src.includes('async function getHist') && !src.includes('async function addHist'));
ok('no cnt: counter', !/kput\(`cnt:/.test(src) && !src.includes('getCounter'));
ok('no pt: pending writes / addPending', !/kput\(`pt:/.test(src) && !src.includes('async function addPending') && !src.includes("'pending_ids'"));
ok('no logAndSchedule / setResult', !src.includes('async function logAndSchedule') && !src.includes('async function setResult'));
ok('no locks (setLock/getLock/clearLock/lock:)',
  !src.includes('setLock') && !src.includes('getLock') && !src.includes('clearLock') && !src.includes('lock:${cid}'));
ok('no reminders (rem:/remind_ids/addReminder/delReminder)',
  !src.includes("'remind_ids'") && !src.includes('`rem:${') &&
  !src.includes('async function addReminder') && !src.includes('async function delReminder') && !src.includes('getPendingReminders'));
ok('no bot stats accumulators (rs:/ss:/risk:/ms:/errcnt:)',
  !src.includes('`rs:${cid}`') && !src.includes('`ss:${cid}`') && !src.includes('`risk:${cid}`') &&
  !src.includes('`ms:${cid}`') && !src.includes('`errcnt:${cid}`'));
ok('no autoScan / resultCheck / expiryReminder / checkMilestone',
  !src.includes('async function autoScan') && !src.includes('async function resultCheck') &&
  !src.includes('async function expiryReminder') && !src.includes('async function checkMilestone'));
ok('no sc:/lc: candle dedup keys', !src.includes('sc:${cid}') && !src.includes('lc:${cid}'));
ok('no cancel-all (worker owns the ledger, no cancel endpoint)', !src.includes("'cmd:cancelall'") && !src.includes('async function doCancelAll'));
ok('no bot trade-id generator (uid used only for trade records is gone)', !src.includes('const tid = uid()'));

// KV write audit: every kput key must be settings/UX state, never a trade record
const kputKeys = [...src.matchAll(/kput\((`[^`]*`|'[^']*'),/g)].map(m => m[1]);
const banned = ['h:', 'cnt:', 'pt:', 'lock:', 'sc:', 'lc:', 'rs:', 'ss:', 'risk:', 'ms:', 'rem:', 'errcnt:', "'pending_ids'", "'remind_ids'"];
const violations = kputKeys.filter(k => banned.some(b => k.startsWith(b)));
ok('KV write audit: all kput keys are settings/UX state only', violations.length === 0, `violations: ${violations.join(', ')}`);

console.log('\n═══ T5 — BEST / HEATMAP / RISK FROM WORKER ═══\n');

ok('doBest aggregates worker /api/stats (all pairs) + /api/signals/latest',
  /async function doBest[\s\S]{0,500}'\/api\/stats'/.test(src) && src.includes("'/api/signals/latest'"));
ok('doHeatmap aggregates worker /api/history per pair', /async function doHeatmap[\s\S]{0,400}\/api\/history\?pair=/.test(src));
ok('doRisk reads worker pending history streams', /async function doRisk[\s\S]{0,400}\/api\/history\?pair=/.test(src));
ok('no bot-ledger reads in best/heatmap/risk',
  !/async function doBest[\s\S]{0,600}getHist/.test(src) && !/async function doHeatmap[\s\S]{0,600}getHist/.test(src) && !/async function doRisk[\s\S]{0,600}getHist/.test(src));

const fmtBestWorker = loadFn('fmtBestWorker', { SEP, esc, disp });
ok('fmtBestWorker extractable for functional test', !!fmtBestWorker);
if (fmtBestWorker) {
  const statsAll = {
    pairs: [
      { pair: 'EUR/USD', winRate: 0.8, wins: 8, losses: 2 },
      { pair: 'GBP/USD', winRate: 0.4, wins: 4, losses: 6 },
      { pair: 'SOL/USD', winRate: 0.9, wins: 1, losses: 1 }, // filtered: <3 trades
    ],
  };
  const latest = { signals: { 'EUR/USD': { signal: { finalSignal: 'BUY' } }, 'GBP/USD': { signal: { finalSignal: 'SELL' } } } };
  const out = fmtBestWorker(statsAll, latest);
  ok('ranks worker pairs by windowed winRate', out.indexOf('EUR/USD') < out.indexOf('GBP/USD'));
  ok('renders worker winRate + W/L', out.includes('80%') && out.includes('8W/2L'));
  ok('filters pairs with <3 decided trades', !out.includes('SOL/USD'));
  ok('renders latest direction from /api/signals/latest', out.includes('🟢') && out.includes('🔴'));
}

const fmtHeatmapWorker = loadFn('fmtHeatmapWorker', { SEP });
ok('fmtHeatmapWorker extractable for functional test', !!fmtHeatmapWorker);
if (fmtHeatmapWorker) {
  const hist = [
    { result: 'WIN',  direction: 'BUY',  timestamp: '2026-08-10T08:15:00Z', pair: 'EUR/USD' },
    { result: 'LOSS', direction: 'SELL', timestamp: '2026-08-10T08:45:00Z', pair: 'EUR/USD' },
    { result: 'WIN',  direction: 'BUY',  timestamp: '2026-08-10T14:00:00Z', pair: 'GBP/USD' },
    { result: null,   direction: 'BUY',  timestamp: '2026-08-10T14:10:00Z', pair: 'GBP/USD' }, // pending excluded
  ];
  const out = fmtHeatmapWorker(hist);
  ok('groups worker history by UTC hour', out.includes('08:00') && out.includes('14:00'));
  ok('computes hourly win rates from worker rows', out.includes('50%') && out.includes('(1W/1L)'));
  ok('excludes pending rows', !out.includes('(1W/2L)'));
}

console.log('\n═══ T6 — CRON SUMMARIES WORKER-BACKED, NO TRADING TASKS ═══\n');

ok('cronLite has no scan/result/reminder tasks', !src.includes('await autoScan(') && !src.includes('await resultCheck(') && !src.includes('await expiryReminder('));
ok('dailySummary fetches worker history', /async function dailySummary[\s\S]{0,900}fetchWorker\(`\/api\/history\?pair=\$\{u\.pair\}&limit=100`/.test(src));
ok('weeklyReport fetches worker history', /async function weeklyReport[\s\S]{0,900}fetchWorker\(`\/api\/history\?pair=\$\{u\.pair\}&limit=500`/.test(src));
ok('fmtMainMenu reads worker history (menu card is worker-backed)', /async function fmtMainMenu[\s\S]{0,400}fetchWorker/.test(src));
ok('fmtMainMenu degrades gracefully on worker failure', /async function fmtMainMenu[\s\S]{0,900}catch/.test(src));
ok('doStatus reads worker totals', /async function doStatus[\s\S]{0,400}\/api\/history\?pair=/.test(src));
ok('doToday/doSummary/doJournal/doWeekly read worker history',
  /async function doToday[\s\S]{0,300}\/api\/history\?pair=/.test(src) &&
  /async function doSummary[\s\S]{0,300}\/api\/history\?pair=/.test(src) &&
  /async function doJournal[\s\S]{0,300}\/api\/history\?pair=/.test(src) &&
  /async function doWeekly[\s\S]{0,300}\/api\/history\?pair=/.test(src));
ok('export endpoint dumps worker history (no bot ledger)', /\/export[\s\S]{0,1200}fetchWorker\(`\/api\/history\?pair=/.test(src));

console.log(`\n═══ Result: ${pass} passed, ${fail} failed ═══\n`);
if (fail > 0) process.exit(1);
console.log('🎉 ALL SINGLE-SOURCE-OF-TRUTH TESTS PASSED\n');
