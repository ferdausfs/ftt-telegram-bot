/**
 * FTT Signal Telegram Bot — v3.0
 * New: Grade filter, /scan all pairs, daily summary, milestone fix,
 *      quick stats in menu, history pagination, pair quick-signal
 *
 * KV Binding     : BOT_KV
 * Service Binding: SIGNAL_WORKER → my-worker-601
 * Secrets        : BOT_TOKEN, SETUP_SECRET
 */

const PAIR_PAGES = [
  ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'],
  ['USD/CAD','GBP/JPY','EUR/GBP','NZD/USD'],
  ['USD/CHF','EUR/JPY','EUR/AUD','AUD/JPY'],
  ['BTC/USD','ETH/USD','SOL/USD','BNB/USD'],
  ['XRP/USD','ADA/USD','DOGE/USD','AVAX/USD'],
];
const VALID_INTERVALS  = [1,5,15];
const MAX_WATCHLIST    = 6;
const MAX_HISTORY      = 100;  // increased
const MILESTONE_COUNT  = 50;
const CRYPTO_BASES     = ['BTC','ETH','BNB','XRP','SOL','ADA','DOGE','AVAX','DOT','LINK'];

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(update, env));
      return new Response('OK');
    }

    if (url.pathname === '/setup') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const webhookUrl = `https://${url.hostname}/webhook`;
      const res = await fetch(`${tgApi(env)}/setWebhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message','callback_query'], drop_pending_updates: true }),
      });
      return new Response(JSON.stringify(await res.json(), null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/runcron') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const logs = [];
      const force = url.searchParams.get('force') === 'true';
      await runCron(env, logs, force);
      return new Response(logs.join('\n'), { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname === '/debugkv') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const autoUsers  = (await kvGet('auto_users', env)) || [];
      const pendingIds = (await kvGet('pending_ids', env)) || [];
      const users = {};
      for (const id of autoUsers) users[id] = await kvGet(`u:${id}`, env);
      return new Response(JSON.stringify({ autoUsers, pendingIds, users }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/addauto') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const chatId = url.searchParams.get('chat');
      if (!chatId) return new Response('Missing ?chat=', { status: 400 });
      const list = (await kvGet('auto_users', env)) || [];
      if (!list.includes(chatId)) list.push(chatId);
      await kvPut('auto_users', list, env);
      const user = (await kvGet(`u:${chatId}`, env)) || defaultUser();
      user.autoEnabled = true;
      user.lastPairScanAt = {};
      await kvPut(`u:${chatId}`, user, env);
      return new Response(JSON.stringify({ ok: true, autoUsers: list }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/export') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const chatId = url.searchParams.get('chat');
      if (!chatId) return new Response('Missing ?chat=', { status: 400 });
      const history = (await kvGet(`h:${chatId}`, env)) || [];
      if (!history.length) return new Response('No data', { status: 404 });
      const header = 'No,ID,Pair,Direction,Grade,Confidence,Entry,Exit,Pips,Result,Expiry(min),Timestamp,ResolvedAt';
      const rows = history.map(h => [
        h.no||'', h.id||'', h.pair||'', h.direction||'', h.grade||'',
        h.confidence||'', h.entryPrice||'', h.exitPrice||'', h.pips||'',
        h.result||'PENDING', h.expiryMinutes||'', h.timestamp||'', h.resolvedAt||''
      ].join(','));
      const csv = [header, ...rows].join('\n');
      return new Response(csv, { headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="ftt-signals-${chatId}-${new Date().toISOString().slice(0,10)}.csv"`,
      }});
    }

    if (url.pathname === '/debug') {
      const pair = url.searchParams.get('pair') || 'EURUSD';
      try {
        const data = await fetchSignal(pair, env);
        return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
      }
    }

    return new Response('FTT Signal Bot v3.0');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, [], true));
  },
};

// ─── CRON ─────────────────────────────────────────────────────────────────────

async function runCron(env, logs = [], force = false) {
  const log = m => { console.log(m); logs.push(String(m)); };
  log('Cron ' + new Date().toISOString());
  if (!env.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing'); return; }
  if (!env.BOT_KV)    { log('ERROR: BOT_KV missing');    return; }
  try { await runAutoScan(env, log, force); }   catch (e) { log('ScanErr: ' + e.message); }
  try { await runResultCheck(env, log); }        catch (e) { log('ResultErr: ' + e.message); }
  try { await runDailySummary(env, log); }       catch (e) { log('SummaryErr: ' + e.message); }
  log('Done');
}

// ─── SIGNAL FETCH ─────────────────────────────────────────────────────────────

async function fetchSignal(pair, env) {
  const req = new Request(`https://signal/api/signal?pair=${pair}`, { headers: { Accept: 'application/json' } });
  const res = env.SIGNAL_WORKER
    ? await env.SIGNAL_WORKER.fetch(req)
    : await fetch(`https://my-worker-601.umuhammadiswa.workers.dev/api/signal?pair=${pair}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text().catch(()=>'')).slice(0,200)}`);
  return res.json();
}

async function fetchCurrentPrice(pair, env) {
  try {
    const d = await fetchSignal(pair, env);
    return d?.signal?.recommendations?.['1min']?.entry?.price
        || d?.signal?.recommendations?.['5min']?.entry?.price
        || d?.signal?.recommendations?.['15min']?.entry?.price
        || null;
  } catch { return null; }
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────

function tgApi(env) { return `https://api.telegram.org/bot${env.BOT_TOKEN}`; }

async function tgCall(method, body, env) {
  if (!env.BOT_TOKEN) return;
  try {
    const res = await fetch(`${tgApi(env)}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      // Ignore "message is not modified" — not a real error
      if (!t.includes('message is not modified') && !t.includes('query is too old')) {
        console.error(`tg ${method} ${res.status}:`, t.slice(0,200));
      }
    }
  } catch (e) { console.error(`tg ${method}:`, e.message); }
}

function send(chatId, text, env, extra = {}) {
  return tgCall('sendMessage', { chat_id: chatId, text: cl(text), disable_web_page_preview: true, ...extra }, env);
}
function edit(chatId, msgId, text, env, extra = {}) {
  return tgCall('editMessageText', { chat_id: chatId, message_id: msgId, text: cl(text), disable_web_page_preview: true, ...extra }, env);
}
function answerCb(id, text, env) {
  return tgCall('answerCallbackQuery', { callback_query_id: id, text: text || '' }, env);
}
function cl(t) { return String(t||'').replace(/[*_`\[\]]/g,''); }

// ─── KV ───────────────────────────────────────────────────────────────────────

async function kvGet(key, env) {
  try { return await env.BOT_KV.get(key, 'json'); } catch { return null; }
}
async function kvPut(key, value, env, opts = {}) {
  try { await env.BOT_KV.put(key, JSON.stringify(value), opts); return true; }
  catch (e) { console.error('kvPut', key, e.message); return false; }
}
async function kvDel(key, env) {
  try { await env.BOT_KV.delete(key); } catch {}
}

// ─── USER ─────────────────────────────────────────────────────────────────────

function defaultUser() {
  return {
    pair: 'EURUSD', watchlist: [], interval: 5,
    autoEnabled: false, noTradeStreak: 0,
    gradeFilter: 'ALL',    // ALL / A / AB
    dailySummary: false,   // send daily summary
    summaryHour: 20,       // UTC hour for daily summary
  };
}

async function getUser(chatId, env) {
  const d = await kvGet(`u:${chatId}`, env);
  return d ? { ...defaultUser(), ...d } : defaultUser();
}
async function saveUser(chatId, data, env) { await kvPut(`u:${chatId}`, data, env); }

async function getAutoUsers(env) { return (await kvGet('auto_users', env)) || []; }
async function addAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  if (!list.includes(String(chatId))) await kvPut('auto_users', [...list, String(chatId)], env);
}
async function removeAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  await kvPut('auto_users', list.filter(id => id !== String(chatId)), env);
}
async function getSummaryUsers(env) { return (await kvGet('summary_users', env)) || []; }
async function addSummaryUser(chatId, env) {
  const list = await getSummaryUsers(env);
  if (!list.includes(String(chatId))) await kvPut('summary_users', [...list, String(chatId)], env);
}
async function removeSummaryUser(chatId, env) {
  const list = await getSummaryUsers(env);
  await kvPut('summary_users', list.filter(id => id !== String(chatId)), env);
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────

async function getHistory(chatId, env) { return (await kvGet(`h:${chatId}`, env)) || []; }

async function addToHistory(chatId, entry, env) {
  const h = await getHistory(chatId, env);
  // Persistent signal counter (never resets with history trim)
  const counter = ((await kvGet(`cnt:${chatId}`, env)) || 0) + 1;
  await kvPut(`cnt:${chatId}`, counter, env);
  entry.no = counter;
  h.unshift(entry);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  await kvPut(`h:${chatId}`, h.slice(0, MAX_HISTORY).filter(x => new Date(x.timestamp).getTime() > cutoff), env);
  return counter;
}

async function setTradeResult(chatId, tradeId, result, exitPrice, pips, env) {
  const h = await getHistory(chatId, env);
  const idx = h.findIndex(x => x.id === tradeId);
  if (idx !== -1) {
    h[idx] = { ...h[idx], result, exitPrice, pips, resolvedAt: new Date().toISOString() };
    await kvPut(`h:${chatId}`, h, env);
  }
}

// ─── PENDING TRADES ───────────────────────────────────────────────────────────

async function getPendingIds(env) { return (await kvGet('pending_ids', env)) || []; }
async function addPendingTrade(trade, env) {
  await kvPut(`pt:${trade.tradeId}`, trade, env, { expirationTtl: 7200 });
  const ids = await getPendingIds(env);
  if (!ids.includes(trade.tradeId)) await kvPut('pending_ids', [...ids, trade.tradeId], env);
}
async function savePendingIds(ids, env) { await kvPut('pending_ids', ids, env); }

// ─── ACTIVE LOCK ──────────────────────────────────────────────────────────────

async function getActiveLock(chatId, pair, env) { return kvGet(`lock:${chatId}:${pair}`, env); }
async function setActiveLock(chatId, pair, direction, expiryAt, env) {
  const ttl = Math.max(60, Math.ceil((expiryAt - Date.now()) / 1000) + 120);
  await kvPut(`lock:${chatId}:${pair}`, { direction, expiryAt }, env, { expirationTtl: ttl });
}
async function clearActiveLock(chatId, pair, env) { await kvDel(`lock:${chatId}:${pair}`, env); }

// ─── LOG & SCHEDULE ───────────────────────────────────────────────────────────

async function logAndSchedule(chatId, pair, sig, env) {
  const dir           = sig.finalSignal;
  const best          = sig.bestTimeframe;
  const expiryMinutes = best?.expiry?.totalMinutes || 5;
  const expiryAt      = Date.now() + expiryMinutes * 60 * 1000;
  const entryPrice    = sig.recommendations?.['1min']?.entry?.price
                     || sig.recommendations?.['5min']?.entry?.price || null;
  const grade         = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const tradeId       = uid();

  const signalNo = await addToHistory(chatId, {
    id: tradeId, pair, direction: dir,
    confidence: sig.confidence || '0%', grade,
    entryPrice, expiryMinutes,
    expiryAt: new Date(expiryAt).toISOString(),
    timestamp: new Date().toISOString(), result: null,
  }, env);

  await addPendingTrade({ chatId: String(chatId), tradeId, pair, direction: dir, entryPrice, expiryAt, signalNo, grade }, env);
  await setActiveLock(chatId, pair, dir, expiryAt, env);
  return signalNo;
}

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

function mainKb(user) {
  const auto = user.autoEnabled;
  return { inline_keyboard: [
    [
      { text: '📊 Signal Now',  callback_data: 'cmd:signal'     },
      { text: auto ? '🔕 Stop Auto' : '🔄 Start Auto', callback_data: 'cmd:toggle_auto' },
    ],
    [
      { text: '🔍 Scan All',    callback_data: 'cmd:scanall'    },
      { text: '📅 Today',       callback_data: 'cmd:today'      },
    ],
    [
      { text: '👁 Watchlist',   callback_data: 'cmd:watchlist'  },
      { text: '📈 History',     callback_data: 'cmd:history:0'  },
    ],
    [
      { text: '🏆 Stats',       callback_data: 'cmd:stats'      },
      { text: '📋 Summary',     callback_data: 'cmd:summary'    },
    ],
    [
      { text: '⚙️ Settings',    callback_data: 'cmd:settings'   },
      { text: '📋 Status',      callback_data: 'cmd:status'     },
    ],
  ]};
}

function settingsKb(user) {
  const gf   = user.gradeFilter || 'ALL';
  const ds   = user.dailySummary ? 'ON' : 'OFF';
  const sh   = user.summaryHour ?? 20;
  const minC = user.minConfidence || 0;
  return { inline_keyboard: [
    [
      { text: '💱 Change Pair',          callback_data: 'pairpage:0'         },
      { text: `⏱ Interval: ${user.interval}min`, callback_data: 'cmd:intervals' },
    ],
    [
      { text: `🎯 Grade: ${gf}`,          callback_data: 'cmd:gradefilter'    },
      { text: `📊 Min Conf: ${minC}%`,    callback_data: 'cmd:conffilter'     },
    ],
    [
      { text: `📅 Summary: ${ds}`,        callback_data: 'cmd:togglesummary'  },
      { text: `🕐 Time: ${sh}:00 UTC`,    callback_data: 'cmd:summarytime'    },
    ],
    [{ text: '🔙 Back', callback_data: 'cmd:main' }],
  ]};
}

function summaryTimeKb() {
  return { inline_keyboard: [
    [
      { text: '06:00 UTC', callback_data: 'sumhour:6'  },
      { text: '12:00 UTC', callback_data: 'sumhour:12' },
      { text: '18:00 UTC', callback_data: 'sumhour:18' },
    ],
    [
      { text: '20:00 UTC', callback_data: 'sumhour:20' },
      { text: '22:00 UTC', callback_data: 'sumhour:22' },
      { text: '00:00 UTC', callback_data: 'sumhour:0'  },
    ],
    [{ text: '🔙 Back', callback_data: 'cmd:settings' }],
  ]};
}

function confFilterKb() {
  return { inline_keyboard: [
    [
      { text: 'Any',   callback_data: 'cf:0'  },
      { text: '60%+',  callback_data: 'cf:60' },
      { text: '70%+',  callback_data: 'cf:70' },
    ],
    [
      { text: '75%+',  callback_data: 'cf:75' },
      { text: '80%+',  callback_data: 'cf:80' },
      { text: '85%+',  callback_data: 'cf:85' },
    ],
    [{ text: '🔙 Back', callback_data: 'cmd:settings' }],
  ]};
}

function pairsKb(page) {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const kb = PAIR_PAGES[page].reduce((rows, p, i) => {
    if (i % 2 === 0) rows.push([]);
    rows[rows.length-1].push({ text: p, callback_data: `pair:${p}` });
    return rows;
  }, []);
  const nav = [];
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `pairpage:${page-1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `pairpage:${page+1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'cmd:settings' }]);
  return { inline_keyboard: kb };
}

function wlAddKb(page, wl) {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const kb = PAIR_PAGES[page].reduce((rows, p, i) => {
    if (i % 2 === 0) rows.push([]);
    const code = norm(p), inWL = wl.includes(code);
    // Include page in callback so we return to same page after add/remove
    rows[rows.length-1].push({
      text: inWL ? `✅ ${p}` : p,
      callback_data: inWL ? `wl:rmpage:${code}:${page}` : `wl:addpage:${code}:${page}`,
    });
    return rows;
  }, []);
  const nav = [];
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `wlpage:${page-1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `wlpage:${page+1}` });
  if (nav.length) kb.push(nav);
  kb.push([
    { text: `✅ Done (${wl.length}/${MAX_WATCHLIST})`, callback_data: 'cmd:watchlist' },
  ]);
  return { inline_keyboard: kb };
}

function wlKb(wl) {
  // Each pair: one row with [📊 Signal] [❌ Remove]
  const kb = wl.map(p => ([
    { text: `📊 ${disp(p)}`, callback_data: `qs:${p}` },
    { text: `❌`,            callback_data: `wl:rm:${p}` },
  ]));
  kb.push([{ text: '➕ Add Pairs', callback_data: 'wlpage:0' }]);
  kb.push([{ text: '🔙 Back',      callback_data: 'cmd:main'  }]);
  return { inline_keyboard: kb };
}

function intervalKb() {
  return { inline_keyboard: [
    [
      { text: '⚡ 1 min',  callback_data: 'interval:1'  },
      { text: '📊 5 min',  callback_data: 'interval:5'  },
      { text: '🕐 15 min', callback_data: 'interval:15' },
    ],
    [{ text: '🔙 Back', callback_data: 'cmd:settings' }],
  ]};
}

function gradeFilterKb() {
  return { inline_keyboard: [
    [
      { text: '🌐 All grades',    callback_data: 'gf:ALL' },
      { text: '⭐ A + B only',    callback_data: 'gf:AB'  },
      { text: '🏆 A grade only',  callback_data: 'gf:A'   },
    ],
    [{ text: '🔙 Back', callback_data: 'cmd:settings' }],
  ]};
}

function afterKb() {
  return { inline_keyboard: [[
    { text: '🔁 New Signal', callback_data: 'cmd:signal'   },
    { text: '📈 History',    callback_data: 'cmd:history:0'},
    { text: '🔙 Menu',       callback_data: 'cmd:main'     },
  ]]};
}

function historyNavKb(page, total) {
  const perPage = 10, totalPages = Math.ceil(total / perPage);
  const nav = [];
  if (page > 0)               nav.push({ text: '◀ Prev', callback_data: `cmd:history:${page-1}` });
  if (page < totalPages - 1)  nav.push({ text: 'Next ▶', callback_data: `cmd:history:${page+1}` });
  const kb = [];
  if (nav.length) kb.push(nav);
  kb.push([
    { text: '🏆 Stats',  callback_data: 'cmd:stats'    },
    { text: '🔙 Back',   callback_data: 'cmd:main'     },
  ]);
  return { inline_keyboard: kb };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function disp(p) { return (!p.includes('/') && p.length===6) ? p.slice(0,3)+'/'+p.slice(3) : p; }
function norm(p) { return p.replace('/',''); }
function uid()  { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function isCrypto(p) { return CRYPTO_BASES.some(b => p.startsWith(b)); }

function passesGradeFilter(sig, filter) {
  if (filter === 'ALL') return true;
  const g = sig.grade?.grade || '';
  if (filter === 'A')  return g === 'A';
  if (filter === 'AB') return g === 'A' || g === 'B';
  return true;
}

function passesConfFilter(sig, minConf) {
  if (!minConf || minConf === 0) return true;
  const conf = parseInt((sig.confidence || '0%').replace('%',''), 10);
  return conf >= minConf;
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

function fmtSignal(data, pair, interval, signalNo) {
  const label = disp(pair);
  if (data.marketStatus === 'CLOSED') {
    return `📊 ${label} | ${interval}min\n━━━━━━━━━━━━━━\n🔴 Forex Market CLOSED\n💡 Try BTC/USD (24/7)`;
  }
  const sig = data.signal;
  if (!sig) return `📊 ${label} | ${interval}min\n━━━━━━━━━━━━━━\nNo signal data`;

  const dir    = sig.finalSignal || 'NO_TRADE';
  const conf   = sig.confidence  || '0%';
  const grade  = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const htf    = sig.higherTFTrend || 'NEUTRAL';
  const reason = sig.entryReason  || '';
  const best   = sig.bestTimeframe;
  const expiry = best?.expiry?.humanReadable || null;
  const cd     = best?.expiry?.countdown?.label || null;

  const dE = dir==='BUY'?'🟢':dir==='SELL'?'🔴':'⚪';
  const hE = htf==='BUY'?'📈':htf==='SELL'?'📉':'➡️';

  const entryPrice = sig.recommendations?.['1min']?.entry?.price
                  || sig.recommendations?.['5min']?.entry?.price
                  || sig.recommendations?.['15min']?.entry?.price || null;

  let msg = '';
  if (signalNo) msg += `📌 Signal No. ${signalNo}\n`;
  msg += `📊 ${label} | ${interval}min\n━━━━━━━━━━━━━━\n`;

  if (dir === 'BUY' || dir === 'SELL') {
    msg += `${dE} ${dir}  ${conf}  ${grade}\n`;
    if (entryPrice) msg += `💰 Entry: ${parseFloat(entryPrice).toFixed(5)}\n`;
    if (expiry)     msg += `⏰ Expiry: ${expiry}\n`;
    if (cd)         msg += `🕐 Candle closes: ${cd}\n`;
    msg += `${hE} HTF 15min: ${htf}\n`;
    if (reason)     msg += `\n📝 ${reason}\n`;
    msg += `\n⏳ Result will be tracked automatically`;
  } else {
    const filters = sig.filtersApplied || [];
    const align   = sig.alignment || '';
    msg += `⚪ NO TRADE\n`;
    msg += filters.length > 0 ? `🔕 ${filters.join(' · ')}` : `🔕 ${align==='MIXED'?'Timeframes mixed':'Setup not clear'}`;
  }
  return msg;
}

function fmtHistory(history, page = 0) {
  const perPage = 10;
  const start   = page * perPage;
  const slice   = history.slice(start, start + perPage);
  if (!slice.length) return 'No signals yet.';

  let msg = `📈 Signal History (${start+1}-${start+slice.length} of ${history.length})\n━━━━━━━━━━━━━━\n`;
  for (const h of slice) {
    const dE = h.direction==='BUY'?'🟢':'🔴';
    const rE = h.result==='WIN'?'✅':h.result==='LOSS'?'❌':h.result==='SKIP'?'⏭':'⏳';
    const g  = h.grade ? ` ${h.grade.split(' ')[0]}` : '';
    const t  = new Date(h.timestamp).toUTCString().slice(5,17);
    const p  = h.pips != null ? ` ${h.pips>0?'+':''}${h.pips}` : '';
    msg += `${rE} #${h.no||'?'} ${dE} ${disp(h.pair)}${g} ${h.confidence}${p}  ${t}\n`;
  }
  return msg;
}

function fmtStats(history) {
  const trades   = history.filter(h => h.direction==='BUY'||h.direction==='SELL');
  const resolved = trades.filter(h => h.result==='WIN'||h.result==='LOSS');
  const wins     = resolved.filter(h => h.result==='WIN').length;
  const losses   = resolved.filter(h => h.result==='LOSS').length;
  const total    = resolved.length;
  const wr       = total > 0 ? Math.round(wins/total*100) : 0;
  const pending  = trades.filter(h => !h.result||h.result==='SKIP').length;

  // Streak
  let streak = 0, sType = '';
  for (const h of resolved) {
    if (!sType) { sType=h.result; streak=1; }
    else if (h.result===sType) streak++;
    else break;
  }

  // Per pair
  const pm = {};
  for (const h of resolved) {
    if (!pm[h.pair]) pm[h.pair]={w:0,l:0};
    h.result==='WIN' ? pm[h.pair].w++ : pm[h.pair].l++;
  }

  // Per grade
  const gm = {};
  for (const h of resolved) {
    const g = (h.grade||'Unknown').split(' ')[0];
    if (!gm[g]) gm[g]={w:0,l:0};
    h.result==='WIN' ? gm[g].w++ : gm[g].l++;
  }

  let msg = `🏆 Win/Loss Stats\n━━━━━━━━━━━━━━\n`;
  msg += `✅ Wins:     ${wins}\n`;
  msg += `❌ Losses:   ${losses}\n`;
  msg += `📊 Win Rate: ${wr}% (${total} trades)\n`;
  msg += `⏳ Pending:  ${pending}`;
  if (streak >= 2) msg += `\n🔥 Streak: ${streak} ${sType}s`;

  if (Object.keys(gm).length > 0) {
    msg += `\n\nGrade Breakdown:\n`;
    for (const [g, s] of Object.entries(gm)) {
      const t = s.w+s.l;
      msg += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`;
    }
  }

  if (Object.keys(pm).length > 0) {
    msg += `\nTop Pairs:\n`;
    Object.entries(pm).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l)).slice(0,5)
      .forEach(([p,s]) => {
        const t=s.w+s.l;
        msg += `  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`;
      });
  }
  return msg;
}

// ─── UPDATE HANDLER ───────────────────────────────────────────────────────────

async function handleUpdate(update, env) {
  try {
    if (update.message)             await handleMessage(update.message, env);
    else if (update.callback_query) await handleCb(update.callback_query, env);
  } catch (e) { console.error('handleUpdate:', e.message); }
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text   = (msg.text||'').trim();
  const user   = await getUser(chatId, env);

  if (text.startsWith('/start')) {
    return send(chatId,
      `👋 FTT Signal Bot v3.0\n\nSignals + Watchlist + Auto W/L Tracking + Grade Filter + Daily Summary\n\nPair: EUR/USD  5min  Auto OFF`,
      env, { reply_markup: mainKb(user) });
  }
  if (text.startsWith('/signal'))    return doSignal(chatId, env);
  if (text.startsWith('/scan'))      return doScanAll(chatId, env);
  if (text.startsWith('/auto'))      return doToggle(chatId, env);
  if (text.startsWith('/status'))    return doStatus(chatId, env);
  if (text.startsWith('/history'))   return doHistory(chatId, env, null, 0);
  if (text.startsWith('/stats'))     return doStats(chatId, env);
  if (text.startsWith('/watchlist')) return doWatchlist(chatId, env);

  if (text.startsWith('/pair ')) {
    const raw = text.slice(6).trim().toUpperCase().replace(/[\s/]/g,'');
    user.pair = raw; await saveUser(chatId, user, env);
    return send(chatId, `✅ Pair → ${disp(raw)}`, env, { reply_markup: mainKb(user) });
  }
  if (text.startsWith('/interval ')) {
    const m = parseInt(text.slice(10).trim(), 10);
    if (VALID_INTERVALS.includes(m)) {
      user.interval = m; await saveUser(chatId, user, env);
      return send(chatId, `✅ Interval → ${m} min`, env, { reply_markup: mainKb(user) });
    }
    return send(chatId, `❌ Valid: 1, 5, 15`, env);
  }
  if (text.startsWith('/today'))   return doToday(chatId, env);
  if (text.startsWith('/summary')) return doManualSummary(chatId, env);
  if (text.startsWith('/help')) {
    return send(chatId,
      `FTT Signal Bot v3.0\n\n/signal — Signal for default pair\n/scan — Scan all pairs now\n/auto — Toggle auto scan\n/watchlist — Manage pairs\n/history — Signal history\n/stats — Win/Loss stats\n/status — Settings\n/pair EURUSD — Set pair\n/interval 5 — Set interval`,
      env, { reply_markup: mainKb(user) });
  }
  return send(chatId, `Use the buttons below 👇`, env, { reply_markup: mainKb(user) });
}

async function handleCb(cb, env) {
  const chatId = cb.message.chat.id;
  const msgId  = cb.message.message_id;
  const data   = cb.data;

  // MUST answer within 10s — do this FIRST before any KV calls
  await answerCb(cb.id, '', env);

  const user = await getUser(chatId, env);

  if (data === 'cmd:main') {
    const h    = await getHistory(chatId, env);
    const res  = h.filter(x => x.result==='WIN'||x.result==='LOSS');
    const wr   = res.length > 0 ? Math.round(res.filter(x=>x.result==='WIN').length/res.length*100) : 0;
    const cnt  = (await kvGet(`cnt:${chatId}`, env)) || 0;
    return edit(chatId, msgId,
      `FTT Signal Bot v3.0\n\n${disp(user.pair)}  ${user.interval}min  ${user.autoEnabled?'Auto ON':'Auto OFF'}\nWatchlist: ${user.watchlist.length} pairs  |  Grade: ${user.gradeFilter||'ALL'}\n\nTotal Signals: ${cnt}  Win Rate: ${wr}% (${res.length} resolved)`,
      env, { reply_markup: mainKb(user) });
  }

  if (data === 'cmd:signal')       return doSignal(chatId, env, msgId);
  if (data === 'cmd:toggle_auto')  return doToggle(chatId, env, msgId);
  if (data === 'cmd:status')       return doStatus(chatId, env, msgId);
  if (data === 'cmd:stats')        return doStats(chatId, env, msgId);
  if (data === 'cmd:watchlist')    return doWatchlist(chatId, env, msgId);
  if (data === 'cmd:scanall')      return doScanAll(chatId, env, msgId);
  if (data === 'cmd:settings')     return doSettings(chatId, env, msgId);
  if (data === 'cmd:gradefilter') {
    return edit(chatId, msgId, `🎯 Grade Filter\n\nOnly send signals above selected grade:`, env, { reply_markup: gradeFilterKb() });
  }
  if (data === 'cmd:togglesummary') {
    user.dailySummary = !user.dailySummary;
    await saveUser(chatId, user, env);
    if (user.dailySummary) await addSummaryUser(chatId, env);
    else                   await removeSummaryUser(chatId, env);
    return doSettings(chatId, env, msgId);
  }
  if (data.startsWith('sumhour:')) {
    user.summaryHour = parseInt(data.split(':')[1], 10);
    await saveUser(chatId, user, env);
    return doSettings(chatId, env, msgId);
  }
  if (data === 'cmd:summarytime') {
    return edit(chatId, msgId, `🕐 Select Daily Summary Time (UTC):`, env, { reply_markup: summaryTimeKb() });
  }
  if (data === 'cmd:conffilter') {
    return edit(chatId, msgId, `📊 Minimum Confidence Filter:

Only send signals at or above this confidence level.`, env, { reply_markup: confFilterKb() });
  }
  if (data.startsWith('cf:')) {
    user.minConfidence = parseInt(data.split(':')[1], 10);
    await saveUser(chatId, user, env);
    return doSettings(chatId, env, msgId);
  }
  if (data === 'cmd:today') return doToday(chatId, env, msgId);
  if (data === 'cmd:summary') return doManualSummary(chatId, env, msgId);
  if (data === 'cmd:intervals') {
    return edit(chatId, msgId, `⏱ Select Interval:`, env, { reply_markup: intervalKb() });
  }
  if (data.startsWith('cmd:history:')) {
    const page = parseInt(data.split(':')[2], 10) || 0;
    return doHistory(chatId, env, msgId, page);
  }

  if (data.startsWith('pairpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    return edit(chatId, msgId, `💱 Select default pair:`, env, { reply_markup: pairsKb(page) });
  }
  if (data.startsWith('pair:')) {
    user.pair = norm(data.slice(5)); await saveUser(chatId, user, env);
    return doSettings(chatId, env, msgId);
  }
  if (data.startsWith('interval:')) {
    user.interval = parseInt(data.split(':')[1], 10);
    await saveUser(chatId, user, env);
    return doSettings(chatId, env, msgId);
  }
  if (data.startsWith('gf:')) {
    user.gradeFilter = data.slice(3); await saveUser(chatId, user, env);
    return doSettings(chatId, env, msgId);
  }
  if (data.startsWith('wlpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    return edit(chatId, msgId, `👁 Add to Watchlist (${user.watchlist.length}/${MAX_WATCHLIST}):`, env,
      { reply_markup: wlAddKb(page, user.watchlist) });
  }
  // Watchlist remove (from main watchlist view)
  if (data.startsWith('wl:rm:')) {
    const pair = data.slice(6);
    user.watchlist = user.watchlist.filter(p => p !== pair);
    await saveUser(chatId, user, env);
    return doWatchlist(chatId, env, msgId);
  }
  // Watchlist add/remove from add-page (page-aware)
  if (data.startsWith('wl:addpage:')) {
    const parts = data.split(':');
    const pair = parts[2], page = parseInt(parts[3]||'0', 10);
    if (!user.watchlist.includes(pair) && user.watchlist.length < MAX_WATCHLIST) {
      user.watchlist = [...user.watchlist, pair];
      await saveUser(chatId, user, env);
    }
    return edit(chatId, msgId,
      `👁 Add to Watchlist (${user.watchlist.length}/${MAX_WATCHLIST}):`,
      env, { reply_markup: wlAddKb(page, user.watchlist) });
  }
  if (data.startsWith('wl:rmpage:')) {
    const parts = data.split(':');
    const pair = parts[2], page = parseInt(parts[3]||'0', 10);
    user.watchlist = user.watchlist.filter(p => p !== pair);
    await saveUser(chatId, user, env);
    return edit(chatId, msgId,
      `👁 Add to Watchlist (${user.watchlist.length}/${MAX_WATCHLIST}):`,
      env, { reply_markup: wlAddKb(page, user.watchlist) });
  }
  // Quick signal for watchlist pair
  if (data.startsWith('qs:')) {
    const pair = data.slice(3);
    return doQuickSignal(chatId, pair, env, msgId);
  }
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

async function doSignal(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  if (msgId) await edit(chatId, msgId, `⏳ Fetching ${disp(user.pair)}...`, env);
  else       await send(chatId, `⏳ Fetching ${disp(user.pair)}...`, env);
  try {
    const data = await fetchSignal(user.pair, env);
    const sig  = data.signal;
    const dir  = sig?.finalSignal;
    let signalNo = null;
    if (dir==='BUY'||dir==='SELL') signalNo = await logAndSchedule(chatId, user.pair, sig, env);
    const text = fmtSignal(data, user.pair, user.interval, signalNo);
    const kb   = afterKb();
    if (msgId) await edit(chatId, msgId, text, env, { reply_markup: kb });
    else       await send(chatId, text, env, { reply_markup: kb });
  } catch (e) {
    const err = `❌ Signal fetch failed\n${e.message.slice(0,200)}`;
    if (msgId) await edit(chatId, msgId, err, env, { reply_markup: mainKb(user) });
    else       await send(chatId, err, env, { reply_markup: mainKb(user) });
  }
}

async function doQuickSignal(chatId, pair, env, msgId = null) {
  const user = await getUser(chatId, env);
  if (msgId) await edit(chatId, msgId, `⏳ Fetching ${disp(pair)}...`, env);
  else       await send(chatId, `⏳ Fetching ${disp(pair)}...`, env);
  try {
    const data = await fetchSignal(pair, env);
    const sig  = data.signal;
    const dir  = sig?.finalSignal;
    let signalNo = null;
    if (dir==='BUY'||dir==='SELL') signalNo = await logAndSchedule(chatId, pair, sig, env);
    const text = fmtSignal(data, pair, user.interval, signalNo);
    if (msgId) await edit(chatId, msgId, text, env, { reply_markup: afterKb() });
    else       await send(chatId, text, env, { reply_markup: afterKb() });
  } catch (e) {
    const err = `❌ Failed: ${e.message.slice(0,150)}`;
    if (msgId) await edit(chatId, msgId, err, env, { reply_markup: mainKb(user) });
    else       await send(chatId, err, env, { reply_markup: mainKb(user) });
  }
}

async function doScanAll(chatId, env, msgId = null) {
  const user     = await getUser(chatId, env);
  const scanList = [user.pair, ...user.watchlist].filter((p,i,a)=>a.indexOf(p)===i);
  if (msgId) await edit(chatId, msgId, `🔍 Scanning ${scanList.length} pairs...`, env);
  else       await send(chatId, `🔍 Scanning ${scanList.length} pairs...`, env);

  let found = 0;
  for (const pair of scanList) {
    try {
      const data = await fetchSignal(pair, env);
      const sig  = data.signal;
      const dir  = sig?.finalSignal;
      if (dir==='BUY'||dir==='SELL') {
        if (!passesGradeFilter(sig, user.gradeFilter||'ALL')) continue;
        const signalNo = await logAndSchedule(chatId, pair, sig, env);
        await send(chatId, fmtSignal(data, pair, user.interval, signalNo), env, { reply_markup: afterKb() });
        found++;
      }
    } catch (e) { console.error(`scanAll ${pair}:`, e.message); }
  }

  const summary = found > 0
    ? `✅ Scan complete — ${found} signal(s) found across ${scanList.length} pairs`
    : `⚪ Scan complete — No actionable signals across ${scanList.length} pairs`;
  await send(chatId, summary, env, { reply_markup: mainKb(user) });
}

async function doToggle(chatId, env, msgId = null) {
  const user       = await getUser(chatId, env);
  user.autoEnabled = !user.autoEnabled;
  user.noTradeStreak = 0;
  await saveUser(chatId, user, env);
  if (user.autoEnabled) await addAutoUser(chatId, env);
  else                  await removeAutoUser(chatId, env);

  const wl  = user.watchlist.map(disp).join(', ');
  const txt = user.autoEnabled
    ? `🔄 Auto Scan ON\n\n${disp(user.pair)}${wl?'\nWatchlist: '+wl:''}\nInterval: ${user.interval} min  Grade: ${user.gradeFilter||'ALL'}\n\nSignals logged + results auto-tracked.`
    : `🔕 Auto Scan OFF`;
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: mainKb(user) });
  else       await send(chatId, txt, env, { reply_markup: mainKb(user) });
}

async function doSettings(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  const txt  = `⚙️ Settings\n\nPair: ${disp(user.pair)}\nInterval: ${user.interval} min\nGrade Filter: ${user.gradeFilter||'ALL'}\nDaily Summary: ${user.dailySummary?`ON (${user.summaryHour}:00 UTC)`:'OFF'}`;
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: settingsKb(user) });
  else       await send(chatId, txt, env, { reply_markup: settingsKb(user) });
}

async function doStatus(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  const cnt  = (await kvGet(`cnt:${chatId}`, env)) || 0;
  const txt  = `📋 Status\n\nPair: ${disp(user.pair)}\nWatchlist: ${user.watchlist.map(disp).join(', ')||'None'}\nInterval: ${user.interval} min\nAuto: ${user.autoEnabled?'ON':'OFF'}\nGrade Filter: ${user.gradeFilter||'ALL'}\nDaily Summary: ${user.dailySummary?'ON':'OFF'}\nTotal Signals: ${cnt}`;
  const kb   = { inline_keyboard: [[
    { text: '⚙️ Settings',  callback_data: 'cmd:settings'  },
    { text: '🔙 Back',      callback_data: 'cmd:main'       },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doHistory(chatId, env, msgId = null, page = 0) {
  const h   = await getHistory(chatId, env);
  const txt = fmtHistory(h, page);
  const kb  = historyNavKb(page, h.length);
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doStats(chatId, env, msgId = null) {
  const h   = await getHistory(chatId, env);
  const txt = fmtStats(h);
  const kb  = { inline_keyboard: [[
    { text: '📈 History', callback_data: 'cmd:history:0' },
    { text: '🔙 Back',    callback_data: 'cmd:main'       },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doWatchlist(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  const wl   = user.watchlist;
  const txt  = `👁 Watchlist (${wl.length}/${MAX_WATCHLIST})\n\n${wl.length>0?wl.map(disp).join(', '):'Empty'}\n\nTap pair name to get quick signal.\nTap ❌ pair to remove.`;
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: wlKb(wl) });
  else       await send(chatId, txt, env, { reply_markup: wlKb(wl) });
}

// ─── TODAY & MANUAL SUMMARY ──────────────────────────────────────────────────

async function doToday(chatId, env, msgId = null) {
  const history = await getHistory(chatId, env);
  const today   = new Date().toISOString().slice(0, 10);
  const todayH  = history.filter(h => h.timestamp?.startsWith(today));
  if (!todayH.length) {
    const txt = `📅 Today (${today})

No signals yet today.`;
    if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: mainKb(await getUser(chatId, env)) });
    else       await send(chatId, txt, env, { reply_markup: mainKb(await getUser(chatId, env)) });
    return;
  }
  const resolved = todayH.filter(h => h.result==='WIN'||h.result==='LOSS');
  const wins  = resolved.filter(h => h.result==='WIN').length;
  const losses= resolved.filter(h => h.result==='LOSS').length;
  const wr    = resolved.length > 0 ? Math.round(wins/resolved.length*100) : 0;
  const pending = todayH.filter(h => !h.result || h.result==='SKIP').length;

  let txt = `📅 Today — ${today}
━━━━━━━━━━━━━━
`;
  txt += `📊 Signals: ${todayH.length}
`;
  txt += `✅ ${wins}W  ❌ ${losses}L  ⏳ ${pending} pending
`;
  txt += `📈 Win Rate: ${wr}%

Recent:
`;
  for (const h of todayH.slice(0, 8)) {
    const dE = h.direction==='BUY'?'🟢':'🔴';
    const rE = h.result==='WIN'?'✅':h.result==='LOSS'?'❌':'⏳';
    const g  = h.grade ? ` ${h.grade.split(' ')[0]}` : '';
    txt += `${rE} #${h.no} ${dE} ${disp(h.pair)}${g} ${h.confidence}
`;
  }
  const kb = { inline_keyboard: [[
    { text: '📈 Full History', callback_data: 'cmd:history:0' },
    { text: '🔙 Menu',         callback_data: 'cmd:main'       },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doManualSummary(chatId, env, msgId = null) {
  const user    = await getUser(chatId, env);
  const history = await getHistory(chatId, env);
  const today   = new Date().toISOString().slice(0, 10);
  const todayH  = history.filter(h => h.timestamp?.startsWith(today));
  if (!todayH.length) {
    const t = `No signals today yet.`;
    if (msgId) await edit(chatId, msgId, t, env, { reply_markup: mainKb(user) });
    else       await send(chatId, t, env, { reply_markup: mainKb(user) });
    return;
  }
  const resolved = todayH.filter(h => h.result==='WIN'||h.result==='LOSS');
  const wins  = resolved.filter(h => h.result==='WIN').length;
  const losses= resolved.filter(h => h.result==='LOSS').length;
  const wr    = resolved.length > 0 ? Math.round(wins/resolved.length*100) : 0;

  const gm = {};
  for (const h of resolved) {
    const g = (h.grade||'?').split(' ')[0];
    if (!gm[g]) gm[g]={w:0,l:0};
    h.result==='WIN'?gm[g].w++:gm[g].l++;
  }

  const allResolved = history.filter(h => h.result==='WIN'||h.result==='LOSS');
  const allWins     = allResolved.filter(h => h.result==='WIN').length;
  const allWR       = allResolved.length > 0 ? Math.round(allWins/allResolved.length*100) : 0;
  const trend = wr > allWR ? '📈 Above average' : wr < allWR ? '📉 Below average' : '➡️ On average';

  let txt = `📅 Daily Summary — ${today}
━━━━━━━━━━━━━━
`;
  txt += `📊 Signals: ${todayH.length}  Resolved: ${resolved.length}
`;
  txt += `✅ Wins: ${wins}  ❌ Losses: ${losses}
`;
  txt += `📈 Win Rate: ${wr}%
`;
  if (Object.keys(gm).length > 0) {
    txt += `
Grades:
`;
    for (const [g,s] of Object.entries(gm)) {
      const t=s.w+s.l;
      txt += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)
`;
    }
  }
  txt += `
${trend} (all-time: ${allWR}%)`;

  const kb = { inline_keyboard: [[
    { text: '📈 History', callback_data: 'cmd:history:0' },
    { text: '🏆 Stats',   callback_data: 'cmd:stats'     },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

// ─── AUTO SCAN ────────────────────────────────────────────────────────────────

async function runAutoScan(env, log, force = false) {
  const autoUsers = await getAutoUsers(env);
  log(`AutoScan: ${autoUsers.length} users`);

  for (const chatId of autoUsers) {
    try {
      const user = await getUser(chatId, env);
      if (!user.autoEnabled) continue;

      const scanList = [user.pair, ...(user.watchlist||[])].filter((p,i,a)=>a.indexOf(p)===i);

      for (const pair of scanList) {
        try {
          const data = await fetchSignal(pair, env);
          const sig  = data.signal;
          const dir  = sig?.finalSignal;

          if (dir==='BUY'||dir==='SELL') {
            // Grade + Confidence filter
            if (!passesGradeFilter(sig, user.gradeFilter||'ALL') || !passesConfFilter(sig, user.minConfidence||0)) {
              log(`Filtered ${pair} ${dir} grade ${sig.grade?.grade}`);
              continue;
            }
            // Duplicate lock
            const lock = await getActiveLock(chatId, pair, env);
            if (lock && lock.direction===dir && lock.expiryAt>Date.now()) {
              log(`Locked ${pair} ${dir}`);
              continue;
            }

            const signalNo = await logAndSchedule(chatId, pair, sig, env);
            const text     = fmtSignal(data, pair, user.interval, signalNo);
            await send(chatId, text, env, { reply_markup: afterKb() });
            log(`Sent #${signalNo} ${pair} ${dir}`);
            user.noTradeStreak = 0;

          } else {
            user.noTradeStreak = (user.noTradeStreak||0) + 1;
            if (user.noTradeStreak >= 12) {
              await send(chatId, `⚪ No clear setup for ${user.noTradeStreak} scans across ${scanList.length} pair(s).`, env,
                { reply_markup: { inline_keyboard: [[{ text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' }]]}});
              user.noTradeStreak = 0;
            }
          }
        } catch (e) { log(`ScanPair ${pair} [${chatId}]: ${e.message}`); }
      }

      await saveUser(chatId, user, env);
    } catch (e) { log(`ScanUser ${chatId}: ${e.message}`); }
  }
}

// ─── RESULT CHECK ─────────────────────────────────────────────────────────────

async function runResultCheck(env, log = console.log) {
  const ids = await getPendingIds(env);
  if (!ids.length) return;
  log(`ResultCheck: ${ids.length} pending`);

  const now = Date.now(), remaining = [];

  for (const tradeId of ids) {
    try {
      const trade = await kvGet(`pt:${tradeId}`, env);
      if (!trade) continue;
      if (trade.expiryAt > now) { remaining.push(tradeId); continue; }

      const currentPrice = await fetchCurrentPrice(trade.pair, env);
      if (currentPrice === null || trade.entryPrice === null) {
        await setTradeResult(trade.chatId, tradeId, 'SKIP', null, null, env);
        await clearActiveLock(trade.chatId, trade.pair, env);
        await send(trade.chatId, `⏭ Tracking No. ${trade.signalNo||tradeId} — could not verify price`, env, { reply_markup: afterKb() });
        continue;
      }

      const entry  = parseFloat(trade.entryPrice);
      const current = parseFloat(currentPrice);
      const diff    = current - entry;
      const result  = trade.direction==='BUY' ? (diff>0?'WIN':'LOSS') : (diff<0?'WIN':'LOSS');

      const crypto = isCrypto(trade.pair);
      const pips   = crypto ? Math.round(Math.abs(diff)*100)/100 : Math.round(Math.abs(diff)*10000*10)/10;
      const unit   = crypto ? '$' : ' pips';

      await setTradeResult(trade.chatId, tradeId, result, current, pips, env);
      await clearActiveLock(trade.chatId, trade.pair, env);

      const lateMin = Math.round((now - trade.expiryAt) / 60000);
      const lateStr = lateMin > 1 ? ` (+${lateMin}min)` : '';
      const gradeStr = trade.grade ? `  ${trade.grade}` : '';
      const dE = trade.direction==='BUY'?'🟢':'🔴';
      const rE = result==='WIN'?'✅ WIN':'❌ LOSS';

      await send(trade.chatId,
        `📊 Tracking No. ${trade.signalNo||tradeId}${lateStr}\n━━━━━━━━━━━━━━\n${rE}  ${dE} ${trade.direction} ${disp(trade.pair)}${gradeStr}\n💰 Entry:  ${entry.toFixed(5)}\n🏁 Exit:   ${current.toFixed(5)}\n📏 Move:   ${diff>0?'+':''}${pips}${unit}`,
        env, { reply_markup: afterKb() });

      await checkMilestone(trade.chatId, env);

    } catch (e) { log(`ResultCheck ${tradeId}: ${e.message}`); remaining.push(tradeId); }
  }

  await savePendingIds(remaining, env);
}

// ─── MILESTONE (every 50 resolved) ───────────────────────────────────────────

async function checkMilestone(chatId, env) {
  try {
    // Use persistent resolved counter separate from history
    const mKey     = `ms:${chatId}`;
    const ms       = (await kvGet(mKey, env)) || { lastCount: 0 };
    const history  = await getHistory(chatId, env);
    const resolved = history.filter(h => h.result==='WIN'||h.result==='LOSS');

    // Total resolved = persistent counter
    const totalResolved = (await kvGet(`rct:${chatId}`, env)) || resolved.length;
    await kvPut(`rct:${chatId}`, totalResolved, env);

    const since = totalResolved - ms.lastCount;
    if (since < MILESTONE_COUNT) return;

    // Build batch from current history (up to 50 newest resolved)
    const batch = resolved.slice(0, Math.min(since, 50));
    const wins  = batch.filter(h=>h.result==='WIN').length;
    const losses= batch.filter(h=>h.result==='LOSS').length;
    const wr    = Math.round(wins/batch.length*100);

    const gm = {}, pm = {};
    for (const h of batch) {
      const g = (h.grade||'?').split(' ')[0];
      if (!gm[g]) gm[g]={w:0,l:0};
      h.result==='WIN'?gm[g].w++:gm[g].l++;
      if (!pm[h.pair]) pm[h.pair]={w:0,l:0};
      h.result==='WIN'?pm[h.pair].w++:pm[h.pair].l++;
    }

    let streak=0, sType='';
    for (const h of resolved) {
      if (!sType){sType=h.result;streak=1;}
      else if(h.result===sType)streak++;
      else break;
    }

    let msg = `🏁 ${MILESTONE_COUNT}-Signal Report\n(#${batch[batch.length-1]?.no||'?'} to #${batch[0]?.no||'?'})\n━━━━━━━━━━━━━━\n`;
    msg += `✅ Wins:    ${wins}\n❌ Losses:  ${losses}\n📊 Win Rate: ${wr}%`;
    if (streak>=3) msg += `\n🔥 Streak: ${streak} ${sType}s`;
    msg += `\n\nGrade:\n`;
    for (const [g,s] of Object.entries(gm)) {
      msg += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w/(s.w+s.l)*100)}%)\n`;
    }
    msg += `\nTop Pairs:\n`;
    Object.entries(pm).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l)).slice(0,4)
      .forEach(([p,s])=>{ msg+=`  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w/(s.w+s.l)*100)}%)\n`; });
    msg += `\n🔄 Next ${MILESTONE_COUNT} signals tracking starts now.`;

    await send(chatId, msg, env, { reply_markup: { inline_keyboard: [[
      { text: '📈 History', callback_data: 'cmd:history:0' },
      { text: '🏆 Stats',   callback_data: 'cmd:stats'     },
    ]]}});

    await kvPut(mKey, { lastCount: totalResolved }, env);
  } catch (e) { console.error('milestone:', e.message); }
}

// ─── DAILY SUMMARY ────────────────────────────────────────────────────────────

async function runDailySummary(env, log = console.log) {
  const now   = new Date();
  const hour  = now.getUTCHours();
  // Use dedicated summary_users list (independent of auto scan)
  const users = await getSummaryUsers(env);
  log(`DailySummary: ${users.length} users, hour=${hour} UTC`);

  for (const chatId of users) {
    try {
      const user = await getUser(chatId, env);
      if (!user.dailySummary) continue;
      if (hour !== (user.summaryHour ?? 20)) continue;

      // Avoid sending twice in same hour
      const lastSent = (await kvGet(`ds:${chatId}`, env)) || 0;
      if (Date.now() - lastSent < 55 * 60 * 1000) continue;

      const history = await getHistory(chatId, env);
      const today   = now.toISOString().slice(0, 10);
      const todayH  = history.filter(h => h.timestamp?.startsWith(today));
      if (todayH.length === 0) {
        log(`No signals today for ${chatId}, skipping`);
        continue;
      }

      const resolved = todayH.filter(h => h.result==='WIN'||h.result==='LOSS');
      const wins     = resolved.filter(h => h.result==='WIN').length;
      const losses   = resolved.filter(h => h.result==='LOSS').length;
      const wr       = resolved.length > 0 ? Math.round(wins/resolved.length*100) : 0;
      const pending  = todayH.filter(h => !h.result || h.result==='SKIP').length;

      // Per pair today
      const pm = {};
      for (const h of resolved) {
        if (!pm[h.pair]) pm[h.pair] = {w:0,l:0};
        h.result==='WIN' ? pm[h.pair].w++ : pm[h.pair].l++;
      }

      // Best/worst pair
      let bestPair = '', worstPair = '';
      let bestWR = -1, worstWR = 101;
      for (const [p, s] of Object.entries(pm)) {
        const t = s.w+s.l; if (t < 2) continue;
        const pwr = s.w/t*100;
        if (pwr > bestWR)  { bestWR = pwr;  bestPair = p; }
        if (pwr < worstWR) { worstWR = pwr; worstPair = p; }
      }

      let msg = `📅 Daily Summary — ${today}
━━━━━━━━━━━━━━
`;
      msg += `📊 Signals: ${todayH.length}  |  Resolved: ${resolved.length}
`;
      msg += `✅ Wins: ${wins}  |  ❌ Losses: ${losses}
`;
      msg += `📈 Win Rate: ${wr}%
`;
      if (pending > 0) msg += `⏳ Pending: ${pending}
`;
      if (bestPair)  msg += `
🏆 Best:  ${disp(bestPair)} (${Math.round(bestWR)}%)
`;
      if (worstPair && worstPair !== bestPair) msg += `📉 Worst: ${disp(worstPair)} (${Math.round(worstWR)}%)
`;

      // Grade breakdown today
      const gm = {};
      for (const h of resolved) {
        const g = (h.grade||'?').split(' ')[0];
        if (!gm[g]) gm[g]={w:0,l:0};
        h.result==='WIN'?gm[g].w++:gm[g].l++;
      }
      if (Object.keys(gm).length > 0) {
        msg += `
Grades:
`;
        for (const [g,s] of Object.entries(gm)) {
          const t=s.w+s.l;
          msg += `  ${g}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)
`;
        }
      }

      // Overall win rate comparison
      const allResolved = history.filter(h => h.result==='WIN'||h.result==='LOSS');
      const allWins     = allResolved.filter(h => h.result==='WIN').length;
      const allWR       = allResolved.length > 0 ? Math.round(allWins/allResolved.length*100) : 0;
      const trend       = wr > allWR ? '📈 Above average' : wr < allWR ? '📉 Below average' : '➡️ On average';
      msg += `
${trend} (all-time: ${allWR}%)`;

      await send(chatId, msg, env, { reply_markup: { inline_keyboard: [[
        { text: '📈 History', callback_data: 'cmd:history:0' },
        { text: '🏆 Stats',   callback_data: 'cmd:stats'     },
      ]]}});

      await kvPut(`ds:${chatId}`, Date.now(), env);
      log(`Daily summary sent to ${chatId}`);
    } catch (e) { log(`DailySummary ${chatId}: ${e.message}`); }
  }
}
