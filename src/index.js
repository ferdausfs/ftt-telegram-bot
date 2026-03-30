/**
 * FTT Signal Telegram Bot — v3.3
 * KV Binding     : BOT_KV
 * Service Binding: SIGNAL_WORKER → my-worker-601
 * Secrets        : BOT_TOKEN, SETUP_SECRET
 *
 * Changes in v3.3:
 *  1. Candle-close scan  — autoScan fires only on new candle open (clock-aligned)
 *                          wrangler.toml cron MUST be "* * * * *"
 *  2. Manual WIN/LOSS    — /win <no> / /loss <no> + ✅/❌ buttons on every signal card
 *  3. Next candle timer  — shown in /status and auto ON confirmation
 *  4. Same-candle dedup  — same pair skipped if already sent a signal this candle
 *  5. /cancelall         — cancels all pending trades at once
 *  6. Error auto-pause   — 3 consecutive full-scan worker errors → auto OFF + notify
 *
 * Inherited fixes from v3.2:
 *  - signalKb() Quotex URL button
 *  - MarkdownV2 escaping via esc()
 *  - entryPrice null-check in resultCheck
 *  - pt: KV keys deleted after resolve
 */

const PAIR_PAGES = [
  ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'],
  ['USD/CAD','GBP/JPY','EUR/GBP','NZD/USD'],
  ['USD/CHF','EUR/JPY','EUR/AUD','AUD/JPY'],
  ['BTC/USD','ETH/USD','SOL/USD','BNB/USD'],
  ['XRP/USD','ADA/USD','DOGE/USD','AVAX/USD'],
];
const MAX_WL     = 6;
const MAX_HIST   = 100;
const MILESTONE  = 50;
const MAX_ERRORS = 3;   // consecutive full-scan failures before auto-pause
const CRYPTO     = ['BTC','ETH','BNB','XRP','SOL','ADA','DOGE','AVAX','DOT','LINK'];
const QUOTEX_URL = 'https://quotex.com/trade';

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url    = new URL(req.url);
    const secret = () => url.searchParams.get('secret') === env.SETUP_SECRET;

    if (req.method === 'POST' && url.pathname === '/webhook') {
      const upd = await req.json().catch(() => null);
      if (upd) ctx.waitUntil(dispatch(upd, env));
      return new Response('OK');
    }

    if (url.pathname === '/setup' && secret()) {
      const hook = `https://${url.hostname}/webhook`;
      const r = await fetch(`${TG(env)}/setWebhook`,
        post({ url: hook, allowed_updates: ['message','callback_query'], drop_pending_updates: true }));
      return new Response(JSON.stringify(await r.json(), null, 2), json());
    }

    if (url.pathname === '/runcron' && secret()) {
      const logs = [], force = url.searchParams.get('force') === 'true';
      await cron(env, logs, force);
      return new Response(logs.join('\n'), { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname === '/debugkv' && secret()) {
      const au = await kget('auto_users', env) || [];
      const users = {};
      for (const id of au) users[id] = await kget(`u:${id}`, env);
      return new Response(JSON.stringify({ auto_users: au, users }, null, 2), json());
    }

    if (url.pathname === '/addauto' && secret()) {
      const id = url.searchParams.get('chat');
      if (!id) return new Response('?chat= required', { status: 400 });
      await addAutoUser(id, env);
      const u = await getUser(id, env);
      u.autoEnabled = true;
      await saveUser(id, u, env);
      return new Response('OK', json());
    }

    if (url.pathname === '/export' && secret()) {
      const id = url.searchParams.get('chat');
      if (!id) return new Response('?chat= required', { status: 400 });
      const h = await getHist(id, env);
      if (!h.length) return new Response('No data', { status: 404 });
      const hdr  = 'No,Pair,Dir,Grade,Conf,Entry,Exit,Pips,Result,Expiry,Time,ResolvedAt';
      const rows = h.map(x => [
        x.no||'', x.pair||'', x.direction||'', x.grade||'', x.confidence||'',
        x.entryPrice||'', x.exitPrice||'', x.pips||'', x.result||'PENDING',
        x.expiryMinutes||'', x.timestamp||'', x.resolvedAt||''
      ].join(','));
      const fname = `ftt-${id}-${new Date().toISOString().slice(0,10)}.csv`;
      return new Response([hdr, ...rows].join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${fname}"`,
        },
      });
    }

    return new Response('FTT Signal Bot v3.3');
  },

  async scheduled(e, env, ctx) {
    ctx.waitUntil(cron(env, [], true));
  },
};

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────

const TG   = env  => `https://api.telegram.org/bot${env.BOT_TOKEN}`;
const post = body => ({ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
const json = ()   => ({ headers: { 'Content-Type': 'application/json' } });

const esc = t => String(t || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

async function tg(method, body, env) {
  if (!env?.BOT_TOKEN) return null;
  try {
    const r = await fetch(`${TG(env)}/${method}`, post(body));
    if (!r.ok) {
      const t = await r.text();
      if (!t.includes('not modified') && !t.includes('too old') && !t.includes('message is not modified'))
        console.error(`tg/${method}:`, t.slice(0, 200));
    }
    return r;
  } catch (e) { console.error(`tg/${method}:`, e.message); return null; }
}

const sendMsg = (cid, text, env, extra = {}) =>
  tg('sendMessage', {
    chat_id: cid,
    text: esc(text),
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    ...extra,
  }, env);

const editMsg = (cid, mid, text, env, extra = {}) =>
  tg('editMessageText', {
    chat_id: cid,
    message_id: mid,
    text: esc(text),
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    ...extra,
  }, env);

const answerCb = (id, env, text = '') =>
  tg('answerCallbackQuery', { callback_query_id: id, text }, env);

const reply = (cid, mid, text, env, kboard) => {
  const extra = kboard ? { reply_markup: kboard } : {};
  return mid
    ? editMsg(cid, mid, text, env, extra)
    : sendMsg(cid, text, env, extra);
};

// ─── KV HELPERS ───────────────────────────────────────────────────────────────

const kget = async (k, env) => { try { return await env.BOT_KV.get(k, 'json'); } catch { return null; } };
const kput = async (k, v, env, opts = {}) => { try { await env.BOT_KV.put(k, JSON.stringify(v), opts); } catch (e) { console.error('kput', k, e.message); } };
const kdel = async (k, env) => { try { await env.BOT_KV.delete(k); } catch {} };

// ─── USER ─────────────────────────────────────────────────────────────────────

const DEF_USER = () => ({
  pair: 'EURUSD', watchlist: [], interval: 5, autoEnabled: false,
  noTradeStreak: 0, gradeFilter: 'ALL', minConfidence: 0,
  dailySummary: false, summaryHour: 20,
});

async function getUser(cid, env) {
  const d = await kget(`u:${cid}`, env);
  return d ? { ...DEF_USER(), ...d } : DEF_USER();
}
const saveUser = (cid, u, env) => kput(`u:${cid}`, u, env);

async function getAutoUsers(env)    { return (await kget('auto_users', env))    || []; }
async function addAutoUser(cid, env) {
  const list = await getAutoUsers(env);
  if (!list.includes(String(cid))) await kput('auto_users', [...list, String(cid)], env);
}
async function removeAutoUser(cid, env) {
  const list = await getAutoUsers(env);
  await kput('auto_users', list.filter(x => x !== String(cid)), env);
}
async function getSummaryUsers(env) { return (await kget('summary_users', env)) || []; }
async function addSummaryUser(cid, env) {
  const list = await getSummaryUsers(env);
  if (!list.includes(String(cid))) await kput('summary_users', [...list, String(cid)], env);
}
async function removeSummaryUser(cid, env) {
  const list = await getSummaryUsers(env);
  await kput('summary_users', list.filter(x => x !== String(cid)), env);
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────

const getHist    = async (cid, env) => (await kget(`h:${cid}`, env)) || [];
const getCounter = async (cid, env) => (await kget(`cnt:${cid}`, env)) || 0;

async function addHist(cid, entry, env) {
  const h   = await getHist(cid, env);
  const cnt = (await getCounter(cid, env)) + 1;
  await kput(`cnt:${cid}`, cnt, env);
  entry.no = cnt;
  h.unshift(entry);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  await kput(`h:${cid}`, h.slice(0, MAX_HIST).filter(x => new Date(x.timestamp).getTime() > cutoff), env);
  return cnt;
}

async function setResult(cid, tid, result, exitPrice, pips, env) {
  const h = await getHist(cid, env);
  const i = h.findIndex(x => x.id === tid);
  if (i !== -1) {
    h[i] = { ...h[i], result, exitPrice, pips, resolvedAt: new Date().toISOString() };
    await kput(`h:${cid}`, h, env);
  }
}

// ─── PENDING TRADES ───────────────────────────────────────────────────────────

const getPendingIds = async env => (await kget('pending_ids', env)) || [];
async function addPending(trade, env) {
  await kput(`pt:${trade.tradeId}`, trade, env, { expirationTtl: 7200 });
  const ids = await getPendingIds(env);
  if (!ids.includes(trade.tradeId))
    await kput('pending_ids', [...ids, trade.tradeId], env);
}
const savePendingIds = (ids, env) => kput('pending_ids', ids, env);

// ─── ACTIVE LOCK ──────────────────────────────────────────────────────────────

const getLock   = (cid, pair, env)                    => kget(`lock:${cid}:${pair}`, env);
const clearLock = (cid, pair, env)                    => kdel(`lock:${cid}:${pair}`, env);
async function setLock(cid, pair, dir, expiryAt, env) {
  const ttl = Math.max(60, Math.ceil((expiryAt - Date.now()) / 1000) + 120);
  await kput(`lock:${cid}:${pair}`, { direction: dir, expiryAt }, env, { expirationTtl: ttl });
}

// ─── LOG & SCHEDULE ───────────────────────────────────────────────────────────

async function logAndSchedule(cid, pair, sig, env) {
  const dir     = sig.finalSignal;
  const expMins = sig.bestTimeframe?.expiry?.totalMinutes || 5;
  const expAt   = Date.now() + expMins * 60 * 1000;
  const entry   = sig.recommendations?.['1min']?.entry?.price
               || sig.recommendations?.['5min']?.entry?.price || null;
  const grade   = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const tid     = uid();

  const no = await addHist(cid, {
    id: tid, pair, direction: dir, confidence: sig.confidence || '0%', grade,
    entryPrice: entry, expiryMinutes: expMins,
    expiryAt: expAt,
    timestamp: new Date().toISOString(), result: null,
  }, env);

  await addPending({
    chatId: String(cid), tradeId: tid, pair, direction: dir,
    entryPrice: entry, expiryAt: expAt, signalNo: no, grade,
  }, env);
  await setLock(cid, pair, dir, expAt, env);
  return no;
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────

const passGrade = (sig, f) => {
  if (!f || f === 'ALL') return true;
  const g = sig.grade?.grade || '';
  return f === 'A' ? g === 'A' : f === 'AB' ? 'AB'.includes(g) : true;
};
const passConf = (sig, min) => {
  if (!min) return true;
  return parseInt((sig.confidence || '0%').replace('%', ''), 10) >= min;
};

// ─── CANDLE HELPERS ───────────────────────────────────────────────────────────

// Clock-aligned floor timestamp of current candle
const candleFloor = (intervalMin) => {
  const ms = intervalMin * 60 * 1000;
  return Math.floor(Date.now() / ms) * ms;
};

// "4m 30s" until next candle close
function nextCandleIn(intervalMin) {
  const ms   = intervalMin * 60 * 1000;
  const next = (Math.floor(Date.now() / ms) + 1) * ms;
  const diff = next - Date.now();
  const m    = Math.floor(diff / 60000);
  const s    = Math.floor((diff % 60000) / 1000);
  return `${m}m ${s}s`;
}

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

const kb  = rows => ({ inline_keyboard: rows });
const btn = (text, cb) => ({ text, callback_data: cb });

// v3.3: signalKb(no) — includes ✅ WIN / ❌ LOSS override buttons when no is provided
const signalKb = (no = null) => {
  const rows = [
    [{ text: '📈 Trade on Quotex', url: QUOTEX_URL }],
  ];
  if (no) rows.push([btn(`✅ WIN #${no}`, `res:win:${no}`), btn(`❌ LOSS #${no}`, `res:loss:${no}`)]);
  rows.push([btn('🔁 New Signal', 'cmd:signal'), btn('📈 History', 'cmd:history:0'), btn('🔙 Menu', 'cmd:main')]);
  return kb(rows);
};

const afterKb = () => kb([
  [btn('🔁 New Signal', 'cmd:signal'), btn('📈 History', 'cmd:history:0'), btn('🔙 Menu', 'cmd:main')],
]);

const mainKb = u => kb([
  [
    btn('📊 Signal Now',  'cmd:signal'),
    btn(u.autoEnabled ? '🔕 Stop Auto' : '🔄 Start Auto', 'cmd:toggle_auto'),
  ],
  [ btn('🔍 Scan All', 'cmd:scanall'),   btn('📅 Today',    'cmd:today')    ],
  [ btn('👁 Watchlist', 'cmd:watchlist'), btn('📈 History', 'cmd:history:0') ],
  [ btn('🏆 Stats',    'cmd:stats'),     btn('📋 Summary',  'cmd:summary')  ],
  [ btn('⚙️ Settings', 'cmd:settings'),  btn('📋 Status',   'cmd:status')   ],
]);

const settingsKb = u => kb([
  [ btn(`💱 Pair: ${disp(u.pair)}`, 'pairpage:0'), btn(`⏱ Interval: ${u.interval}min`, 'cmd:intervals') ],
  [ btn(`🎯 Grade: ${u.gradeFilter || 'ALL'}`, 'cmd:gradefilter'), btn(`📊 Conf: ${u.minConfidence || 0}%+`, 'cmd:conffilter') ],
  [ btn(`📅 Summary: ${u.dailySummary ? 'ON' : 'OFF'}`, 'cmd:togglesummary'), btn(`🕐 Time: ${u.summaryHour ?? 20}:00 UTC`, 'cmd:summarytime') ],
  [ btn('🔙 Back', 'cmd:main') ],
]);

const pairsKb = (page, backTo = 'cmd:settings') => {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const rows = chunk(PAIR_PAGES[page], 2).map(row => row.map(p => btn(p, `pair:${p}`)));
  const nav  = [];
  if (page > 0)                     nav.push(btn('◀ Prev', `pairpage:${page - 1}`));
  if (page < PAIR_PAGES.length - 1) nav.push(btn('Next ▶', `pairpage:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('🔙 Back', backTo)]);
  return kb(rows);
};

const wlKb = wl => {
  const rows = wl.map(p => [btn(`📊 ${disp(p)}`, `qs:${p}`), btn('❌', `wl:rm:${p}`)]);
  rows.push([btn('➕ Add Pairs', 'wlpage:0')]);
  rows.push([btn('🔙 Back', 'cmd:main')]);
  return kb(rows);
};

const wlAddKb = (page, wl) => {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const rows = chunk(PAIR_PAGES[page], 2).map(row =>
    row.map(p => {
      const code = norm(p), inWL = wl.includes(code);
      return btn(inWL ? `✅ ${p}` : p, inWL ? `wl:rmpage:${code}:${page}` : `wl:addpage:${code}:${page}`);
    })
  );
  const nav = [];
  if (page > 0)                     nav.push(btn('◀ Prev', `wlpage:${page - 1}`));
  if (page < PAIR_PAGES.length - 1) nav.push(btn('Next ▶', `wlpage:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn(`✅ Done (${wl.length}/${MAX_WL})`, 'cmd:watchlist')]);
  return kb(rows);
};

const intervalKb  = () => kb([
  [ btn('⚡ 1min', 'interval:1'), btn('📊 5min', 'interval:5'), btn('🕐 15min', 'interval:15') ],
  [ btn('🔙 Back', 'cmd:settings') ],
]);
const gradeKb     = () => kb([
  [ btn('🌐 All', 'gf:ALL'), btn('⭐ A+B', 'gf:AB'), btn('🏆 A only', 'gf:A') ],
  [ btn('🔙 Back', 'cmd:settings') ],
]);
const confKb      = () => kb([
  [ btn('Any', 'cf:0'),    btn('60%+', 'cf:60'), btn('70%+', 'cf:70') ],
  [ btn('75%+', 'cf:75'),  btn('80%+', 'cf:80'), btn('85%+', 'cf:85') ],
  [ btn('🔙 Back', 'cmd:settings') ],
]);
const summTimeKb  = () => kb([
  [ btn('06:00', 'sumhour:6'), btn('12:00', 'sumhour:12'), btn('18:00', 'sumhour:18') ],
  [ btn('20:00', 'sumhour:20'), btn('22:00', 'sumhour:22'), btn('00:00', 'sumhour:0') ],
  [ btn('🔙 Back', 'cmd:settings') ],
]);
const histNavKb   = (page, total) => {
  const nav = [];
  if (page > 0)                       nav.push(btn('◀ Prev', `cmd:history:${page - 1}`));
  if (page < Math.ceil(total/10) - 1) nav.push(btn('Next ▶', `cmd:history:${page + 1}`));
  const rows = [];
  if (nav.length) rows.push(nav);
  rows.push([btn('🏆 Stats', 'cmd:stats'), btn('🔙 Back', 'cmd:main')]);
  return kb(rows);
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const disp  = p  => (!p.includes('/') && p.length === 6) ? p.slice(0,3) + '/' + p.slice(3) : p;
const norm  = p  => p.replace('/', '');
const uid   = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const isCr  = p  => CRYPTO.some(b => p.startsWith(b));
const chunk = (arr, n) => arr.reduce((r, x, i) => (i % n === 0 ? r.push([x]) : r[r.length-1].push(x), r), []);

const fmtPrice = (price, pair) =>
  isCr(pair) ? parseFloat(price).toFixed(2) : parseFloat(price).toFixed(5);

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

function fmtSignal(data, pair, interval, no) {
  if (data.marketStatus === 'CLOSED')
    return `📊 ${disp(pair)} | ${interval}min\n━━━━━━━━━━━━━━\n🔴 Forex Market CLOSED\n💡 Try BTC/USD (24/7)`;

  const sig = data.signal;
  if (!sig) return `📊 ${disp(pair)} | ${interval}min\n━━━━━━━━━━━━━━\nNo signal data`;

  const dir    = sig.finalSignal   || 'NO_TRADE';
  const conf   = sig.confidence    || '0%';
  const grade  = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const htf    = sig.higherTFTrend || 'NEUTRAL';
  const reason = sig.entryReason   || '';
  const best   = sig.bestTimeframe;

  const tf     = best?.timeframe || `${interval}min`;
  const expiry = best?.expiry?.humanReadable || null;
  const cd     = best?.expiry?.countdown?.label || null;
  const price  = sig.recommendations?.['1min']?.entry?.price
              || sig.recommendations?.['5min']?.entry?.price
              || sig.recommendations?.['15min']?.entry?.price || null;

  const dE = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
  const hE = htf === 'BUY' ? '📈' : htf === 'SELL' ? '📉' : '➡️';

  let msg = no ? `📌 Signal No. ${no}\n` : '';
  msg += `📊 ${disp(pair)} | ${tf}\n━━━━━━━━━━━━━━\n`;

  if (dir === 'BUY' || dir === 'SELL') {
    msg += `${dE} ${dir}  ${conf}  ${grade}\n`;
    if (price)  msg += `💰 Entry: ${fmtPrice(price, pair)}\n`;
    if (expiry) msg += `⏰ Expiry: ${expiry}\n`;
    if (cd)     msg += `🕐 Candle closes: ${cd}\n`;
    msg += `${hE} HTF 15min: ${htf}\n`;
    if (reason) msg += `\n📝 ${reason}\n`;
    msg += `\n⏳ Result will be tracked automatically`;
  } else {
    const filters = sig.filtersApplied || [];
    msg += `⚪ NO TRADE\n`;
    msg += filters.length
      ? `🔕 ${filters.join(' · ')}`
      : `🔕 ${sig.alignment === 'MIXED' ? 'Timeframes mixed' : 'Setup not clear'}`;
  }
  return msg;
}

function fmtHist(hist, page = 0) {
  const per = 10, slice = hist.slice(page * per, page * per + per);
  if (!slice.length) return 'No signals yet.';
  let msg = `📈 History (${page * per + 1}-${page * per + slice.length} of ${hist.length})\n━━━━━━━━━━━━━━\n`;
  for (const h of slice) {
    const dE = h.direction === 'BUY' ? '🟢' : '🔴';
    const rE = h.result === 'WIN' ? '✅' : h.result === 'LOSS' ? '❌' : h.result === 'SKIP' ? '⏭' : h.result === 'CANCEL' ? '🗑' : '⏳';
    const g  = h.grade  ? ` ${h.grade.split(' ')[0]}` : '';
    const p  = h.pips != null ? ` ${h.pips > 0 ? '+' : ''}${h.pips}` : '';
    const t  = new Date(h.timestamp).toUTCString().slice(5, 17);
    msg += `${rE} #${h.no || '?'} ${dE} ${disp(h.pair)}${g} ${h.confidence}${p}  ${t}\n`;
  }
  return msg;
}

function fmtStats(hist) {
  const trades   = hist.filter(h => h.direction === 'BUY' || h.direction === 'SELL');
  const resolved = trades.filter(h => h.result === 'WIN' || h.result === 'LOSS');
  const wins     = resolved.filter(h => h.result === 'WIN').length;
  const losses   = resolved.filter(h => h.result === 'LOSS').length;
  const wr       = resolved.length > 0 ? Math.round(wins / resolved.length * 100) : 0;
  const pending  = trades.filter(h => !h.result).length;
  let streak = 0, sT = '';
  for (const h of resolved) {
    if (!sT)           { sT = h.result; streak = 1; }
    else if (h.result === sT) streak++;
    else break;
  }
  const pm = {}, gm = {};
  for (const h of resolved) {
    if (!pm[h.pair]) pm[h.pair] = { w:0, l:0 };
    h.result === 'WIN' ? pm[h.pair].w++ : pm[h.pair].l++;
    const g = (h.grade || '?').split(' ')[0];
    if (!gm[g]) gm[g] = { w:0, l:0 };
    h.result === 'WIN' ? gm[g].w++ : gm[g].l++;
  }
  let msg = `🏆 Win/Loss Stats\n━━━━━━━━━━━━━━\n`;
  msg += `✅ Wins:     ${wins}\n❌ Losses:   ${losses}\n`;
  msg += `📊 Win Rate: ${wr}% (${resolved.length} trades)\n`;
  msg += `⏳ Pending:  ${pending}`;
  if (streak >= 2) msg += `\n🔥 Streak: ${streak} ${sT}s`;
  if (Object.keys(gm).length) {
    msg += `\n\nGrade:\n`;
    for (const [g, s] of Object.entries(gm)) {
      const t = s.w + s.l;
      msg += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w / t * 100)}%)\n`;
    }
  }
  if (Object.keys(pm).length) {
    msg += `\nTop Pairs:\n`;
    Object.entries(pm)
      .sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l))
      .slice(0, 5)
      .forEach(([p, s]) => {
        const t = s.w + s.l;
        msg += `  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w / t * 100)}%)\n`;
      });
  }
  return msg;
}

// ─── DISPATCH ─────────────────────────────────────────────────────────────────

async function dispatch(upd, env) {
  try {
    if (upd.message)             await onMessage(upd.message, env);
    else if (upd.callback_query) await onCb(upd.callback_query, env);
  } catch (e) { console.error('dispatch:', e.message); }
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────

async function onMessage(msg, env) {
  const cid  = msg.chat.id;
  const text = (msg.text || '').trim();
  const u    = await getUser(cid, env);
  const R    = (t, kboard) => sendMsg(cid, t, env, kboard ? { reply_markup: kboard } : {});

  if (text.startsWith('/start'))
    return R(`👋 FTT Signal Bot v3.3\n\nSignals + Auto W/L Tracking\n\nPair: ${disp(u.pair)}  ${u.interval}min  Auto ${u.autoEnabled ? 'ON' : 'OFF'}`, mainKb(u));
  if (text.startsWith('/signal'))    return doSignal(cid, null, env);
  if (text.startsWith('/scan'))      return doScanAll(cid, null, env);
  if (text.startsWith('/auto'))      return doToggle(cid, null, env);
  if (text.startsWith('/status'))    return doStatus(cid, null, env);
  if (text.startsWith('/history'))   return doHist(cid, null, 0, env);
  if (text.startsWith('/stats'))     return doStats(cid, null, env);
  if (text.startsWith('/watchlist')) return doWatchlist(cid, null, env);
  if (text.startsWith('/today'))     return doToday(cid, null, env);
  if (text.startsWith('/summary'))   return doSummary(cid, null, env);
  if (text.startsWith('/cancelall')) return doCancelAll(cid, null, env);

  // v3.3: Manual WIN/LOSS — /win 5  or  /loss 5
  if (text.startsWith('/win ') || text.startsWith('/loss ')) {
    const parts  = text.split(' ');
    const result = text.startsWith('/win') ? 'WIN' : 'LOSS';
    const no     = parseInt(parts[1], 10);
    if (isNaN(no)) return R(`❌ Usage: /win 5  or  /loss 5`, mainKb(u));
    return doManualResult(cid, null, no, result, env);
  }

  if (text.startsWith('/pair ')) {
    const raw = text.slice(6).trim().toUpperCase().replace(/[\s/]/g, '');
    u.pair = raw;
    await saveUser(cid, u, env);
    return R(`✅ Pair set to ${disp(raw)}`, mainKb(u));
  }
  if (text.startsWith('/interval ')) {
    const m = parseInt(text.slice(10).trim(), 10);
    if ([1, 5, 15].includes(m)) { u.interval = m; await saveUser(cid, u, env); return R(`✅ Interval: ${m}min`, mainKb(u)); }
    return R('❌ Use: 1, 5, or 15', mainKb(u));
  }
  if (text.startsWith('/help'))
    return R(`FTT Signal Bot v3.3\n\n/signal — get signal now\n/scan — scan all pairs\n/auto — toggle auto scan\n/watchlist /history /stats\n/today /summary /status\n/cancelall — cancel all pending\n/win <no> /loss <no> — manual override\n/pair EURUSD /interval 5`, mainKb(u));
  return R('Use the buttons below 👇', mainKb(u));
}

// ─── CALLBACK HANDLER ─────────────────────────────────────────────────────────

async function onCb(cb, env) {
  const cid  = cb.message.chat.id;
  const mid  = cb.message.message_id;
  const data = cb.data;

  await answerCb(cb.id, env, '');

  const u = await getUser(cid, env);
  const R = (text, kboard) => reply(cid, mid, text, env, kboard);

  if (data === 'cmd:main') {
    const h   = await getHist(cid, env);
    const res = h.filter(x => x.result === 'WIN' || x.result === 'LOSS');
    const wr  = res.length > 0 ? Math.round(res.filter(x => x.result === 'WIN').length / res.length * 100) : 0;
    const cnt = await getCounter(cid, env);
    return R(`FTT Signal Bot v3.3\n\n${disp(u.pair)}  ${u.interval}min  ${u.autoEnabled ? 'Auto ON' : 'Auto OFF'}\nWatchlist: ${u.watchlist.length} pairs  Grade: ${u.gradeFilter || 'ALL'}\n\nSignals: ${cnt}  Win Rate: ${wr}% (${res.length} resolved)`, mainKb(u));
  }

  if (data === 'cmd:signal')      return doSignal(cid, mid, env);
  if (data === 'cmd:toggle_auto') return doToggle(cid, mid, env);
  if (data === 'cmd:scanall')     return doScanAll(cid, mid, env);
  if (data === 'cmd:status')      return doStatus(cid, mid, env);
  if (data === 'cmd:stats')       return doStats(cid, mid, env);
  if (data === 'cmd:watchlist')   return doWatchlist(cid, mid, env);
  if (data === 'cmd:today')       return doToday(cid, mid, env);
  if (data === 'cmd:summary')     return doSummary(cid, mid, env);
  if (data === 'cmd:settings')    return doSettings(cid, mid, env);
  if (data.startsWith('cmd:history:')) return doHist(cid, mid, parseInt(data.split(':')[2]) || 0, env);

  if (data === 'cmd:intervals')   return R('⏱ Select Interval:', intervalKb());
  if (data === 'cmd:gradefilter') return R('🎯 Grade Filter:', gradeKb());
  if (data === 'cmd:conffilter')  return R('📊 Min Confidence:', confKb());
  if (data === 'cmd:summarytime') return R('🕐 Daily Summary Time (UTC):', summTimeKb());
  if (data === 'cmd:togglesummary') {
    u.dailySummary = !u.dailySummary;
    await saveUser(cid, u, env);
    if (u.dailySummary) await addSummaryUser(cid, env);
    else                await removeSummaryUser(cid, env);
    return doSettings(cid, mid, env);
  }
  if (data.startsWith('interval:')) {
    u.interval = parseInt(data.split(':')[1], 10);
    await saveUser(cid, u, env);
    return doSettings(cid, mid, env);
  }
  if (data.startsWith('sumhour:')) {
    u.summaryHour = parseInt(data.split(':')[1], 10);
    await saveUser(cid, u, env);
    return doSettings(cid, mid, env);
  }
  if (data.startsWith('gf:')) {
    u.gradeFilter = data.slice(3);
    await saveUser(cid, u, env);
    return doSettings(cid, mid, env);
  }
  if (data.startsWith('cf:')) {
    u.minConfidence = parseInt(data.split(':')[1], 10);
    await saveUser(cid, u, env);
    return doSettings(cid, mid, env);
  }

  if (data.startsWith('pairpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    return R('💱 Select default pair:', pairsKb(page));
  }
  if (data.startsWith('pair:')) {
    u.pair = norm(data.slice(5));
    await saveUser(cid, u, env);
    return doSettings(cid, mid, env);
  }

  if (data.startsWith('wlpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    return R(`👁 Add to Watchlist (${u.watchlist.length}/${MAX_WL}):`, wlAddKb(page, u.watchlist));
  }
  if (data.startsWith('wl:rm:')) {
    const pair = data.slice(6);
    u.watchlist = u.watchlist.filter(p => p !== pair);
    await saveUser(cid, u, env);
    return doWatchlist(cid, mid, env);
  }
  if (data.startsWith('wl:addpage:')) {
    const parts = data.split(':');
    const pair  = parts[2];
    const page  = parseInt(parts[3] || '0', 10);
    if (!u.watchlist.includes(pair) && u.watchlist.length < MAX_WL) {
      u.watchlist = [...u.watchlist, pair];
      await saveUser(cid, u, env);
    }
    return R(`👁 Add to Watchlist (${u.watchlist.length}/${MAX_WL}):`, wlAddKb(page, u.watchlist));
  }
  if (data.startsWith('wl:rmpage:')) {
    const parts = data.split(':');
    const pair  = parts[2];
    const page  = parseInt(parts[3] || '0', 10);
    u.watchlist = u.watchlist.filter(p => p !== pair);
    await saveUser(cid, u, env);
    return R(`👁 Add to Watchlist (${u.watchlist.length}/${MAX_WL}):`, wlAddKb(page, u.watchlist));
  }

  if (data.startsWith('qs:')) return doQuickSignal(cid, mid, data.slice(3), env);

  // v3.3: Manual result override buttons on signal card
  if (data.startsWith('res:win:'))
    return doManualResult(cid, mid, parseInt(data.split(':')[2], 10), 'WIN', env);
  if (data.startsWith('res:loss:'))
    return doManualResult(cid, mid, parseInt(data.split(':')[2], 10), 'LOSS', env);
}

// ─── ACTION FUNCTIONS ─────────────────────────────────────────────────────────

async function doSignal(cid, mid, env) {
  const u = await getUser(cid, env);
  if (mid) await editMsg(cid, mid, `⏳ Fetching ${disp(u.pair)}...`, env, {});
  else     await sendMsg(cid, `⏳ Fetching ${disp(u.pair)}...`, env, {});
  try {
    const data = await fetchSig(u.pair, env);
    const sig  = data.signal;
    const dir  = sig?.finalSignal;
    let no = null;
    if (dir === 'BUY' || dir === 'SELL') no = await logAndSchedule(cid, u.pair, sig, env);
    // v3.3: pass no to signalKb for WIN/LOSS buttons
    const useKb = (dir === 'BUY' || dir === 'SELL') ? signalKb(no) : afterKb();
    await sendMsg(cid, fmtSignal(data, u.pair, u.interval, no), env, { reply_markup: useKb });
  } catch (e) {
    await sendMsg(cid, `❌ Signal fetch failed\n${e.message.slice(0, 200)}`, env, { reply_markup: mainKb(u) });
  }
}

async function doQuickSignal(cid, mid, pair, env) {
  const u = await getUser(cid, env);
  if (mid) await editMsg(cid, mid, `⏳ Fetching ${disp(pair)}...`, env, {});
  else     await sendMsg(cid, `⏳ Fetching ${disp(pair)}...`, env, {});
  try {
    const data = await fetchSig(pair, env);
    const sig  = data.signal;
    const dir  = sig?.finalSignal;
    let no = null;
    if (dir === 'BUY' || dir === 'SELL') no = await logAndSchedule(cid, pair, sig, env);
    const useKb = (dir === 'BUY' || dir === 'SELL') ? signalKb(no) : afterKb();
    await sendMsg(cid, fmtSignal(data, pair, u.interval, no), env, { reply_markup: useKb });
  } catch (e) {
    await sendMsg(cid, `❌ Failed: ${e.message.slice(0, 150)}`, env, { reply_markup: mainKb(u) });
  }
}

async function doScanAll(cid, mid, env) {
  const u    = await getUser(cid, env);
  const list = [u.pair, ...u.watchlist].filter((p, i, a) => a.indexOf(p) === i);
  if (mid) await editMsg(cid, mid, `🔍 Scanning ${list.length} pairs...`, env, {});
  else     await sendMsg(cid, `🔍 Scanning ${list.length} pairs...`, env, {});
  let found = 0;
  for (const pair of list) {
    try {
      const data = await fetchSig(pair, env);
      const sig  = data.signal;
      const dir  = sig?.finalSignal;
      if ((dir === 'BUY' || dir === 'SELL') && passGrade(sig, u.gradeFilter) && passConf(sig, u.minConfidence)) {
        const no = await logAndSchedule(cid, pair, sig, env);
        await sendMsg(cid, fmtSignal(data, pair, u.interval, no), env, { reply_markup: signalKb(no) });
        found++;
      }
    } catch (e) { console.error(`scan ${pair}:`, e.message); }
  }
  await sendMsg(cid,
    found > 0
      ? `✅ ${found} signal(s) found across ${list.length} pairs`
      : `⚪ No signals across ${list.length} pairs`,
    env, { reply_markup: mainKb(u) });
}

async function doToggle(cid, mid, env) {
  const u = await getUser(cid, env);
  u.autoEnabled = !u.autoEnabled;
  u.noTradeStreak = 0;
  await saveUser(cid, u, env);
  if (u.autoEnabled) {
    await addAutoUser(cid, env);
  } else {
    await removeAutoUser(cid, env);
    // v3.3: clean up candle-close key and error count on OFF
    await kdel(`lc:${cid}`, env);
    await kput(`errcnt:${cid}`, 0, env);
  }
  const wl = u.watchlist.map(disp).join(', ');
  const t  = u.autoEnabled
    ? `🔄 Auto Scan ON\n\n${disp(u.pair)}${wl ? '\nWatchlist: ' + wl : ''}\nInterval: ${u.interval}min  Grade: ${u.gradeFilter || 'ALL'}\n⏰ Next scan: ${nextCandleIn(u.interval)}`
    : `🔕 Auto Scan OFF`;
  return reply(cid, mid, t, env, mainKb(u));
}

async function doSettings(cid, mid, env) {
  const u = await getUser(cid, env);
  const t = `⚙️ Settings\n\nPair: ${disp(u.pair)}\nInterval: ${u.interval}min\nGrade: ${u.gradeFilter || 'ALL'}\nMin Conf: ${u.minConfidence || 0}%\nDaily Summary: ${u.dailySummary ? `ON (${u.summaryHour ?? 20}:00 UTC)` : 'OFF'}`;
  return reply(cid, mid, t, env, settingsKb(u));
}

async function doStatus(cid, mid, env) {
  const u   = await getUser(cid, env);
  const cnt = await getCounter(cid, env);
  const h   = await getHist(cid, env);
  const pen = h.filter(x => !x.result && x.direction).length;
  // v3.3: next candle countdown shown when auto is ON
  const nextScan = u.autoEnabled ? `\n⏰ Next scan: ${nextCandleIn(u.interval)}` : '';
  const t = `📋 Status\n\nPair: ${disp(u.pair)}\nWatchlist: ${u.watchlist.map(disp).join(', ') || 'None'}\nInterval: ${u.interval}min\nAuto: ${u.autoEnabled ? 'ON' : 'OFF'}${nextScan}\nGrade: ${u.gradeFilter || 'ALL'}\nMin Conf: ${u.minConfidence || 0}%\nSummary: ${u.dailySummary ? 'ON' : 'OFF'}\nTotal Signals: ${cnt}  Pending: ${pen}`;
  return reply(cid, mid, t, env, kb([[btn('⚙️ Settings', 'cmd:settings'), btn('🔙 Back', 'cmd:main')]]));
}

async function doHist(cid, mid, page, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtHist(h, page), env, histNavKb(page, h.length));
}

async function doStats(cid, mid, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtStats(h), env, kb([[btn('📈 History', 'cmd:history:0'), btn('🔙 Back', 'cmd:main')]]));
}

async function doWatchlist(cid, mid, env) {
  const u  = await getUser(cid, env);
  const wl = u.watchlist;
  const t  = `👁 Watchlist (${wl.length}/${MAX_WL})\n\n${wl.length ? wl.map(disp).join(', ') : 'Empty'}\n\n📊 = Quick signal  ❌ = Remove`;
  return reply(cid, mid, t, env, wlKb(wl));
}

async function doToday(cid, mid, env) {
  const h     = await getHist(cid, env);
  const today = new Date().toISOString().slice(0, 10);
  const th    = h.filter(x => x.timestamp?.startsWith(today));
  if (!th.length)
    return reply(cid, mid, `📅 Today (${today})\n\nNo signals yet.`, env, kb([[btn('🔙 Back', 'cmd:main')]]));
  const res  = th.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const wins = res.filter(x => x.result === 'WIN').length;
  const wr   = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
  let t = `📅 Today — ${today}\n━━━━━━━━━━━━━━\n`;
  t += `📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n\n`;
  for (const x of th.slice(0, 8)) {
    const dE = x.direction === 'BUY' ? '🟢' : '🔴';
    const rE = x.result === 'WIN' ? '✅' : x.result === 'LOSS' ? '❌' : x.result === 'CANCEL' ? '🗑' : '⏳';
    const g  = x.grade ? ` ${x.grade.split(' ')[0]}` : '';
    t += `${rE} #${x.no} ${dE} ${disp(x.pair)}${g} ${x.confidence}\n`;
  }
  return reply(cid, mid, t, env, kb([[btn('📈 History', 'cmd:history:0'), btn('🔙 Back', 'cmd:main')]]));
}

async function doSummary(cid, mid, env) {
  const h     = await getHist(cid, env);
  const today = new Date().toISOString().slice(0, 10);
  const th    = h.filter(x => x.timestamp?.startsWith(today));
  if (!th.length)
    return reply(cid, mid, `No signals today yet.`, env, kb([[btn('🔙 Back', 'cmd:main')]]));
  const res   = th.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const wins  = res.filter(x => x.result === 'WIN').length;
  const wr    = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
  const allR  = h.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const allWR = allR.length > 0 ? Math.round(allR.filter(x => x.result === 'WIN').length / allR.length * 100) : 0;
  const trend = wr > allWR ? '📈 Above avg' : wr < allWR ? '📉 Below avg' : '➡️ On avg';
  const gm = {};
  for (const x of res) {
    const g = (x.grade || '?').split(' ')[0];
    if (!gm[g]) gm[g] = { w:0, l:0 };
    x.result === 'WIN' ? gm[g].w++ : gm[g].l++;
  }
  let t = `📅 Daily Summary — ${today}\n━━━━━━━━━━━━━━\n`;
  t += `📊 ${th.length} signals  Resolved: ${res.length}\n✅ ${wins}W  ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n`;
  if (Object.keys(gm).length) {
    t += `\nGrades:\n`;
    for (const [g, s] of Object.entries(gm)) {
      const tt = s.w + s.l;
      t += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w / tt * 100)}%)\n`;
    }
  }
  t += `\n${trend} (all-time: ${allWR}%)`;
  return reply(cid, mid, t, env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')]]));
}

// v3.3: Cancel all pending trades
async function doCancelAll(cid, mid, env) {
  const u    = await getUser(cid, env);
  const h    = await getHist(cid, env);
  const pend = h.filter(x => !x.result && x.direction);
  if (!pend.length)
    return reply(cid, mid, `ℹ️ No pending trades to cancel.`, env, mainKb(u));

  const allIds = await getPendingIds(env);
  const myTids = pend.map(x => x.id);

  for (const trade of pend) {
    await setResult(cid, trade.id, 'CANCEL', null, null, env);
    await clearLock(cid, trade.pair, env);
    await kdel(`pt:${trade.id}`, env);
  }
  await savePendingIds(allIds.filter(id => !myTids.includes(id)), env);

  return reply(cid, mid, `🗑 Cancelled ${pend.length} pending trade(s).`, env, mainKb(u));
}

// v3.3: Manual WIN/LOSS result override
async function doManualResult(cid, mid, no, result, env) {
  const u     = await getUser(cid, env);
  const h     = await getHist(cid, env);
  const trade = h.find(x => x.no === no);

  if (!trade)
    return reply(cid, mid, `❌ Signal #${no} not found.`, env, mainKb(u));
  if (trade.result === 'WIN' || trade.result === 'LOSS')
    return reply(cid, mid, `ℹ️ Signal #${no} already resolved as ${trade.result}.`, env, mainKb(u));

  await setResult(cid, trade.id, result, null, null, env);
  await clearLock(cid, trade.pair, env);
  await kdel(`pt:${trade.id}`, env);

  const ids = await getPendingIds(env);
  await savePendingIds(ids.filter(id => id !== trade.id), env);

  const dE = trade.direction === 'BUY' ? '🟢' : '🔴';
  const rE = result === 'WIN' ? '✅ WIN' : '❌ LOSS';
  const t  = `${rE} manually set\n\n#${no} ${dE} ${trade.direction} ${disp(trade.pair)}\n${trade.grade || ''}`;
  return reply(cid, mid, t, env, afterKb());
}

// ─── SIGNAL FETCH ─────────────────────────────────────────────────────────────

async function fetchSig(pair, env) {
  const req = new Request(`https://signal/api/signal?pair=${pair}`, { headers: { Accept: 'application/json' } });
  const res = env.SIGNAL_WORKER
    ? await env.SIGNAL_WORKER.fetch(req)
    : await fetch(`https://my-worker-601.umuhammadiswa.workers.dev/api/signal?pair=${pair}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
  return res.json();
}

async function fetchPrice(pair, env) {
  try {
    const d = await fetchSig(pair, env);
    return d?.signal?.recommendations?.['1min']?.entry?.price
        || d?.signal?.recommendations?.['5min']?.entry?.price
        || d?.signal?.recommendations?.['15min']?.entry?.price || null;
  } catch { return null; }
}

// ─── CRON ─────────────────────────────────────────────────────────────────────

async function cron(env, logs = [], force = false) {
  const log = m => { console.log(m); logs.push(String(m)); };
  log(`Cron ${new Date().toISOString()}`);
  if (!env?.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing'); return; }
  if (!env?.BOT_KV)    { log('ERROR: BOT_KV missing');    return; }
  await autoScan(env, log).catch(e => log('ScanErr: ' + e.message));
  await resultCheck(env, log).catch(e => log('ResultErr: ' + e.message));
  await dailySummary(env, log).catch(e => log('SummaryErr: ' + e.message));
  log('Done');
}

async function autoScan(env, log) {
  const users = await getAutoUsers(env);
  log(`Scan: ${users.length} users`);
  const now = Date.now();

  for (const cid of users) {
    try {
      const u = await getUser(cid, env);
      if (!u.autoEnabled) continue;

      // ── v3.3 Feature 1: Candle-close gate ─────────────────
      // Scan fires only when a new candle has opened (clock-aligned).
      // wrangler.toml cron must be "* * * * *" for this to work correctly.
      const intervalMin   = u.interval || 5;
      const intervalMs    = intervalMin * 60 * 1000;
      const currentCandle = Math.floor(now / intervalMs) * intervalMs;
      const lastCandle    = (await kget(`lc:${cid}`, env)) || 0;
      if (currentCandle <= lastCandle) {
        log(`Skip ${cid} — waiting for next candle close`);
        continue;
      }
      await kput(`lc:${cid}`, currentCandle, env, { expirationTtl: intervalMin * 60 * 2 });
      // ──────────────────────────────────────────────────────

      const list = [u.pair, ...u.watchlist].filter((p, i, a) => a.indexOf(p) === i);
      let anySignalSent = false;
      let pairErrors    = 0;

      for (const pair of list) {
        try {
          // ── v3.3 Feature 4: Same-candle dedup ───────────────
          const scKey          = `sc:${cid}:${norm(pair)}`;
          const lastPairCandle = (await kget(scKey, env)) || 0;
          if (lastPairCandle >= currentCandle) {
            log(`Dedup ${pair} — already sent this candle`);
            continue;
          }
          // ────────────────────────────────────────────────────

          const data = await fetchSig(pair, env);
          const sig  = data.signal;
          const dir  = sig?.finalSignal;

          if (dir === 'BUY' || dir === 'SELL') {
            if (!passGrade(sig, u.gradeFilter) || !passConf(sig, u.minConfidence)) { log(`Filtered ${pair}`); continue; }
            const lock = await getLock(cid, pair, env);
            if (lock?.direction === dir && lock?.expiryAt > now) { log(`Locked ${pair}`); continue; }
            const no = await logAndSchedule(cid, pair, sig, env);
            await sendMsg(cid, fmtSignal(data, pair, intervalMin, no), env, { reply_markup: signalKb(no) });
            // Mark this pair as sent for this candle
            await kput(scKey, currentCandle, env, { expirationTtl: intervalMin * 60 + 60 });
            log(`Sent #${no} ${pair} ${dir}`);
            anySignalSent = true;
          }
        } catch (e) {
          log(`Pair ${pair}: ${e.message}`);
          pairErrors++;
        }
      }

      // ── v3.3 Feature 6: Worker error auto-pause ───────────
      // If ALL pairs failed this scan, count it as a consecutive error.
      // After MAX_ERRORS consecutive full failures → auto OFF + notify.
      if (list.length > 0 && pairErrors === list.length) {
        const errKey = `errcnt:${cid}`;
        const errs   = ((await kget(errKey, env)) || 0) + 1;
        await kput(errKey, errs, env, { expirationTtl: 3600 });
        log(`Worker errors for ${cid}: ${errs}/${MAX_ERRORS}`);
        if (errs >= MAX_ERRORS) {
          u.autoEnabled = false;
          await saveUser(cid, u, env);
          await removeAutoUser(cid, env);
          await kdel(`lc:${cid}`, env);
          await kput(errKey, 0, env);
          await sendMsg(cid,
            `⚠️ Auto Scan paused\n\nSignal worker unreachable — ${MAX_ERRORS} consecutive scan failures.\nFix the worker then tap 🔄 Start Auto to resume.`,
            env, { reply_markup: mainKb(u) });
          log(`Auto paused for ${cid} after ${MAX_ERRORS} errors`);
        }
      } else if (pairErrors === 0 && list.length > 0) {
        // Full success — reset error counter
        await kput(`errcnt:${cid}`, 0, env);
      }
      // ──────────────────────────────────────────────────────

      if (!anySignalSent) {
        u.noTradeStreak = (u.noTradeStreak || 0) + 1;
        if (u.noTradeStreak >= 12) {
          await sendMsg(cid, `⚪ No setup for ${u.noTradeStreak} scans across ${list.length} pair(s).`, env,
            { reply_markup: kb([[btn('🔕 Stop Auto', 'cmd:toggle_auto')]]) });
          u.noTradeStreak = 0;
        }
      } else {
        u.noTradeStreak = 0;
      }

      await saveUser(cid, u, env);
    } catch (e) { log(`User ${cid}: ${e.message}`); }
  }
}

async function resultCheck(env, log) {
  const ids = await getPendingIds(env);
  if (!ids.length) return;
  log(`Results: ${ids.length} pending`);
  const now = Date.now(), keep = [];
  for (const tid of ids) {
    try {
      const t = await kget(`pt:${tid}`, env);
      if (!t) continue;
      if (t.expiryAt > now) { keep.push(tid); continue; }

      const cur = await fetchPrice(t.pair, env);

      if (!cur || !t.entryPrice) {
        await setResult(t.chatId, tid, 'SKIP', null, null, env);
        await clearLock(t.chatId, t.pair, env);
        await kdel(`pt:${tid}`, env);
        await sendMsg(t.chatId, `⏭ Tracking No. ${t.signalNo || tid} — price unavailable`, env, { reply_markup: afterKb() });
        continue;
      }

      const entry   = parseFloat(t.entryPrice);
      const current = parseFloat(cur);

      if (isNaN(entry) || isNaN(current)) {
        await setResult(t.chatId, tid, 'SKIP', null, null, env);
        await clearLock(t.chatId, t.pair, env);
        await kdel(`pt:${tid}`, env);
        await sendMsg(t.chatId, `⏭ Tracking No. ${t.signalNo || tid} — invalid price data`, env, { reply_markup: afterKb() });
        continue;
      }

      const diff   = current - entry;
      const result = t.direction === 'BUY' ? (diff > 0 ? 'WIN' : 'LOSS') : (diff < 0 ? 'WIN' : 'LOSS');
      const pips   = isCr(t.pair)
        ? Math.round(Math.abs(diff) * 100) / 100
        : Math.round(Math.abs(diff) * 10000 * 10) / 10;
      const unit   = isCr(t.pair) ? '$' : ' pips';

      await setResult(t.chatId, tid, result, current, pips, env);
      await clearLock(t.chatId, t.pair, env);
      await kdel(`pt:${tid}`, env);

      const late  = Math.round((now - t.expiryAt) / 60000);
      const lateS = late > 1 ? ` (+${late}min)` : '';
      const dE    = t.direction === 'BUY' ? '🟢' : '🔴';
      const rE    = result === 'WIN' ? '✅ WIN' : '❌ LOSS';
      const gS    = t.grade ? `  ${t.grade}` : '';

      await sendMsg(t.chatId,
        `📊 Tracking No. ${t.signalNo || tid}${lateS}\n━━━━━━━━━━━━━━\n${rE}  ${dE} ${t.direction} ${disp(t.pair)}${gS}\n💰 Entry:  ${fmtPrice(entry, t.pair)}\n🏁 Exit:   ${fmtPrice(current, t.pair)}\n📏 Move:   ${diff > 0 ? '+' : ''}${pips}${unit}`,
        env, { reply_markup: afterKb() });

      await checkMilestone(t.chatId, env);
    } catch (e) { log(`Result ${tid}: ${e.message}`); keep.push(tid); }
  }
  await savePendingIds(keep, env);
}

async function dailySummary(env, log) {
  const hour  = new Date().getUTCHours();
  const users = await getSummaryUsers(env);
  log(`Summary: ${users.length} users, hour=${hour}`);
  for (const cid of users) {
    try {
      const u = await getUser(cid, env);
      if (!u.dailySummary || hour !== (u.summaryHour ?? 20)) continue;
      const last = (await kget(`ds:${cid}`, env)) || 0;
      if (Date.now() - last < 55 * 60 * 1000) continue;
      const h     = await getHist(cid, env);
      const today = new Date().toISOString().slice(0, 10);
      const th    = h.filter(x => x.timestamp?.startsWith(today));
      if (!th.length) continue;
      const res  = th.filter(x => x.result === 'WIN' || x.result === 'LOSS');
      const wins = res.filter(x => x.result === 'WIN').length;
      const wr   = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
      const t    = `📅 Daily Summary — ${today}\n━━━━━━━━━━━━━━\n📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n⏳ Pending: ${th.filter(x => !x.result).length}`;
      await sendMsg(cid, t, env, { reply_markup: kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')]]) });
      await kput(`ds:${cid}`, Date.now(), env);
      log(`Summary sent to ${cid}`);
    } catch (e) { log(`Summary ${cid}: ${e.message}`); }
  }
}

async function checkMilestone(cid, env) {
  try {
    const mk  = `ms:${cid}`;
    const ms  = (await kget(mk, env)) || { lastCount: 0 };
    const h   = await getHist(cid, env);
    const res = h.filter(x => x.result === 'WIN' || x.result === 'LOSS');

    const since = Math.max(0, res.length - ms.lastCount);
    if (since < MILESTONE) return;

    const batch = res.slice(0, since);
    const wins  = batch.filter(x => x.result === 'WIN').length;
    const wr    = Math.round(wins / batch.length * 100);
    const gm = {}, pm = {};
    for (const x of batch) {
      const g = (x.grade || '?').split(' ')[0];
      if (!gm[g]) gm[g] = { w:0, l:0 };
      x.result === 'WIN' ? gm[g].w++ : gm[g].l++;
      if (!pm[x.pair]) pm[x.pair] = { w:0, l:0 };
      x.result === 'WIN' ? pm[x.pair].w++ : pm[x.pair].l++;
    }
    let t = `🏁 ${MILESTONE}-Signal Report (#${batch[batch.length-1]?.no || '?'} to #${batch[0]?.no || '?'})\n━━━━━━━━━━━━━━\n✅ ${wins}W  ❌ ${batch.length - wins}L\n📊 Win Rate: ${wr}%\n\nGrades:\n`;
    for (const [g, s] of Object.entries(gm)) {
      const tt = s.w + s.l;
      t += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w / tt * 100)}%)\n`;
    }
    t += `\nTop Pairs:\n`;
    Object.entries(pm)
      .sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l))
      .slice(0, 4)
      .forEach(([p, s]) => {
        const tt = s.w + s.l;
        t += `  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w / tt * 100)}%)\n`;
      });
    t += `\n🔄 Next ${MILESTONE} signals tracking starts now.`;
    await sendMsg(cid, t, env, { reply_markup: kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')]]) });
    await kput(mk, { lastCount: res.length }, env);
  } catch (e) { console.error('milestone:', e.message); }
}
