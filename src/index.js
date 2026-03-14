/**
 * FTT Signal Telegram Bot — v2.2
 * Fixed: Cron auto scan, auto win/loss tracking, KV reliability
 *
 * KV Binding     : BOT_KV
 * Service Binding: SIGNAL_WORKER → my-worker-601
 * Secrets        : BOT_TOKEN, SETUP_SECRET
 */

const PAIR_PAGES = [
  ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
  ['USD/CAD', 'GBP/JPY', 'EUR/GBP', 'NZD/USD'],
  ['USD/CHF', 'EUR/JPY', 'EUR/AUD', 'AUD/JPY'],
  ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD'],
  ['XRP/USD', 'ADA/USD', 'DOGE/USD', 'AVAX/USD'],
];

const VALID_INTERVALS = [1, 5, 15];
const MAX_WATCHLIST   = 6;
const MAX_HISTORY     = 50;
const CRYPTO_BASES    = ['BTC','ETH','BNB','XRP','SOL','ADA','DOGE','AVAX','DOT','LINK'];

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(update, env));
      return new Response('OK');
    }

    if (url.pathname === '/debug') {
      const pair = url.searchParams.get('pair') || 'EURUSD';
      try {
        const data = await fetchSignal(pair, env);
        return new Response(JSON.stringify(data, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          headers: { 'Content-Type': 'application/json' }, status: 500,
        });
      }
    }

    // Debug cron manually (waits for result)
    if (url.pathname === '/runcron') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const logs = [];
      const force = url.searchParams.get('force') === 'true';
      await runCron(env, logs, force);
      return new Response(logs.join('\n') || 'Cron done (no logs)', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Check KV state
    if (url.pathname === '/debugkv') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      try {
        const autoUsers  = (await env.BOT_KV.get('auto_users', 'json')) || [];
        const pendingIds = (await env.BOT_KV.get('pending_ids', 'json')) || [];
        const result     = { autoUsers, pendingIds, users: {} };
        for (const id of autoUsers) {
          result.users[id] = (await env.BOT_KV.get(`u:${id}`, 'json')) || null;
        }
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          headers: { 'Content-Type': 'application/json' }, status: 500,
        });
      }
    }

    // Register chatId for auto (call from Telegram to force-add)
    if (url.pathname === '/addauto') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const chatId = url.searchParams.get('chat');
      if (!chatId) return new Response('Missing ?chat=', { status: 400 });
      const list = (await env.BOT_KV.get('auto_users', 'json')) || [];
      if (!list.includes(chatId)) list.push(chatId);
      await env.BOT_KV.put('auto_users', JSON.stringify(list));
      const user = (await env.BOT_KV.get(`u:${chatId}`, 'json')) || {};
      user.autoEnabled = true;
      user.lastPairScanAt = {};  // reset so scan runs immediately
      user.noTradeStreak = 0;
      await env.BOT_KV.put(`u:${chatId}`, JSON.stringify(user));
      return new Response(JSON.stringify({ ok: true, autoUsers: list, user }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/setup') {
      if (url.searchParams.get('secret') !== env.SETUP_SECRET)
        return new Response('Unauthorized', { status: 401 });
      const webhookUrl = `https://${url.hostname}/webhook`;
      const res = await fetch(`${tgApi(env)}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query'],
          drop_pending_updates: true,
        }),
      });
      return new Response(JSON.stringify(await res.json(), null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('FTT Signal Bot v2.2 — OK');
  },

  // Cron: every 1 minute
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, [], true));
  },
};

// ─── CRON MASTER ──────────────────────────────────────────────────────────────

async function runCron(env, logs = [], force = false) {
  const log = (m) => { console.log(m); logs.push(String(m)); };
  log('Cron started: ' + new Date().toISOString());
  if (!env.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing in env'); return; }
  if (!env.BOT_KV)    { log('ERROR: BOT_KV binding missing');  return; }
  try { await runAutoScan(env, log, force); }    catch (e) { log('AutoScan error: ' + e.message); }
  try { await runResultCheck(env, log); } catch (e) { log('ResultCheck error: ' + e.message); }
  log('Cron done');
}

// ─── SIGNAL FETCH ─────────────────────────────────────────────────────────────

async function fetchSignal(pair, env) {
  const req = new Request(`https://signal/api/signal?pair=${pair}`, {
    headers: { Accept: 'application/json' },
  });
  let res;
  if (env.SIGNAL_WORKER) {
    res = await env.SIGNAL_WORKER.fetch(req);
  } else {
    res = await fetch(
      `https://my-worker-601.umuhammadiswa.workers.dev/api/signal?pair=${pair}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchCurrentPrice(pair, env) {
  try {
    const data = await fetchSignal(pair, env);
    return data?.signal?.recommendations?.['1min']?.entry?.price
        || data?.signal?.recommendations?.['5min']?.entry?.price
        || data?.signal?.recommendations?.['15min']?.entry?.price
        || null;
  } catch { return null; }
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────

function tgApi(env) { return `https://api.telegram.org/bot${env.BOT_TOKEN}`; }

async function tgCall(method, body, env) {
  if (!env.BOT_TOKEN) { console.error('tgCall: BOT_TOKEN missing'); return; }
  try {
    const res = await fetch(`${tgApi(env)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`tgCall ${method} ${res.status}: ${t.slice(0, 300)}`);
    }
  } catch (e) { console.error(`tgCall ${method}: ${e.message}`); }
}

// Plain text only — no Markdown parse errors
function send(chatId, text, env, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text: clean(text),
    disable_web_page_preview: true,
    ...extra,
  }, env);
}

function edit(chatId, msgId, text, env, extra = {}) {
  return tgCall('editMessageText', {
    chat_id: chatId,
    message_id: msgId,
    text: clean(text),
    disable_web_page_preview: true,
    ...extra,
  }, env);
}

function answerCb(id, text, env) {
  return tgCall('answerCallbackQuery', { callback_query_id: id, text: text || '' }, env);
}

function clean(t) {
  return String(t || '').replace(/[*_`\[\]]/g, '');
}

// ─── KV HELPERS ───────────────────────────────────────────────────────────────

async function kvGet(key, env) {
  try { return await env.BOT_KV.get(key, 'json'); }
  catch (e) { console.error('kvGet', key, e.message); return null; }
}

async function kvPut(key, value, env, opts = {}) {
  try { await env.BOT_KV.put(key, JSON.stringify(value), opts); return true; }
  catch (e) { console.error('kvPut', key, e.message); return false; }
}

// ─── USER DATA ────────────────────────────────────────────────────────────────

function defaultUser() {
  return {
    pair: 'EURUSD',
    watchlist: [],
    interval: 5,
    autoEnabled: false,
    lastPairScanAt: {},
    noTradeStreak: 0,
  };
}

async function getUser(chatId, env) {
  const d = await kvGet(`u:${chatId}`, env);
  return d ? { ...defaultUser(), ...d } : defaultUser();
}

async function saveUser(chatId, data, env) {
  await kvPut(`u:${chatId}`, data, env);
}

async function getAutoUsers(env) {
  return (await kvGet('auto_users', env)) || [];
}

async function addAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  const id   = String(chatId);
  if (!list.includes(id)) await kvPut('auto_users', [...list, id], env);
}

async function removeAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  await kvPut('auto_users', list.filter(id => id !== String(chatId)), env);
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────

async function getHistory(chatId, env) {
  return (await kvGet(`h:${chatId}`, env)) || [];
}

async function addToHistory(chatId, entry, env) {
  const h = await getHistory(chatId, env);
  h.unshift(entry);
  await kvPut(`h:${chatId}`, h.slice(0, MAX_HISTORY), env);
}

async function setTradeResult(chatId, tradeId, result, exitPrice, pips, env) {
  const h   = await getHistory(chatId, env);
  const idx = h.findIndex(x => x.id === tradeId);
  if (idx !== -1) {
    h[idx] = { ...h[idx], result, exitPrice, pips, resolvedAt: new Date().toISOString() };
    await kvPut(`h:${chatId}`, h, env);
  }
}

// ─── PENDING TRADES ───────────────────────────────────────────────────────────
// Each trade stored as individual KV key: pt:{tradeId}
// List of trade IDs: pending_ids
// This avoids list race conditions

async function getPendingIds(env) {
  return (await kvGet('pending_ids', env)) || [];
}

async function addPendingTrade(trade, env) {
  await kvPut(`pt:${trade.tradeId}`, trade, env, { expirationTtl: 3600 }); // auto-expire 1h
  const ids = await getPendingIds(env);
  if (!ids.includes(trade.tradeId)) {
    await kvPut('pending_ids', [...ids, trade.tradeId], env);
  }
}

async function removePendingId(tradeId, env) {
  const ids = await getPendingIds(env);
  await kvPut('pending_ids', ids.filter(id => id !== tradeId), env);
}

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

function mainKb(autoEnabled) {
  return { inline_keyboard: [
    [
      { text: '📊 Signal Now',  callback_data: 'cmd:signal'      },
      { text: autoEnabled ? '🔕 Stop Auto' : '🔄 Start Auto', callback_data: 'cmd:toggle_auto' },
    ],
    [
      { text: '💱 Change Pair', callback_data: 'pairpage:0'    },
      { text: '⏱ Interval',    callback_data: 'cmd:intervals'  },
    ],
    [
      { text: '👁 Watchlist',   callback_data: 'cmd:watchlist'  },
      { text: '📈 History',     callback_data: 'cmd:history'    },
    ],
    [
      { text: '🏆 Stats',       callback_data: 'cmd:stats'      },
      { text: '📋 Status',      callback_data: 'cmd:status'     },
    ],
  ]};
}

function pairsKb(page) {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const kb = [];
  for (let i = 0; i < PAIR_PAGES[page].length; i += 2) {
    const row = [{ text: PAIR_PAGES[page][i], callback_data: `pair:${PAIR_PAGES[page][i]}` }];
    if (PAIR_PAGES[page][i+1]) row.push({ text: PAIR_PAGES[page][i+1], callback_data: `pair:${PAIR_PAGES[page][i+1]}` });
    kb.push(row);
  }
  const nav = [];
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `pairpage:${page-1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `pairpage:${page+1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'cmd:main' }]);
  return { inline_keyboard: kb };
}

function wlAddKb(page, watchlist) {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const kb = [];
  for (let i = 0; i < PAIR_PAGES[page].length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i+2, PAIR_PAGES[page].length); j++) {
      const p    = PAIR_PAGES[page][j];
      const code = norm(p);
      const inWL = watchlist.includes(code);
      row.push({ text: inWL ? `✅ ${p}` : p, callback_data: inWL ? `wl:rm:${code}` : `wl:add:${code}` });
    }
    kb.push(row);
  }
  const nav = [];
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `wlpage:${page-1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `wlpage:${page+1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Watchlist', callback_data: 'cmd:watchlist' }]);
  return { inline_keyboard: kb };
}

function wlKb(watchlist) {
  const kb = [];
  for (let i = 0; i < watchlist.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i+2, watchlist.length); j++)
      row.push({ text: `❌ ${disp(watchlist[j])}`, callback_data: `wl:rm:${watchlist[j]}` });
    kb.push(row);
  }
  kb.push([{ text: '➕ Add Pairs', callback_data: 'wlpage:0' }]);
  kb.push([{ text: '🔙 Back', callback_data: 'cmd:main' }]);
  return { inline_keyboard: kb };
}

function intervalKb() {
  return { inline_keyboard: [
    [
      { text: '⚡ 1 min',  callback_data: 'interval:1'  },
      { text: '📊 5 min',  callback_data: 'interval:5'  },
      { text: '🕐 15 min', callback_data: 'interval:15' },
    ],
    [{ text: '🔙 Back', callback_data: 'cmd:main' }],
  ]};
}

function afterKb() {
  return { inline_keyboard: [[
    { text: '🔁 New Signal', callback_data: 'cmd:signal'  },
    { text: '📈 History',    callback_data: 'cmd:history' },
    { text: '🔙 Menu',       callback_data: 'cmd:main'    },
  ]]};
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function disp(pair) {
  if (!pair.includes('/') && pair.length === 6)
    return pair.slice(0,3) + '/' + pair.slice(3);
  return pair;
}

function norm(pair) { return pair.replace('/', ''); }

function uid() { return Math.random().toString(36).slice(2,8).toUpperCase(); }

function isCrypto(pair) {
  return CRYPTO_BASES.some(b => pair.startsWith(b));
}

// ─── SIGNAL FORMATTER ─────────────────────────────────────────────────────────

function fmtSignal(data, pair, interval) {
  const label = disp(pair);

  if (data.marketStatus === 'CLOSED') {
    return `📊 ${label} | ${interval}min\n` +
           `━━━━━━━━━━━━━━\n` +
           `🔴 Forex Market CLOSED\n` +
           `🕐 Opens in: ${data.opensIn || 'Soon'}\n\n` +
           `💡 Try BTC/USD (24/7)`;
  }

  const sig = data.signal;
  if (!sig) return `📊 ${label} | ${interval}min\n━━━━━━━━━━━━━━\nNo signal data`;

  const dir      = sig.finalSignal   || 'NO_TRADE';
  const conf     = sig.confidence    || '0%';
  const grade    = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const htf      = sig.higherTFTrend || 'NEUTRAL';
  const reason   = sig.entryReason   || '';
  const filters  = sig.filtersApplied || [];
  const align    = sig.alignment     || '';
  const best     = sig.bestTimeframe;
  const expiry   = best?.expiry?.humanReadable || null;
  const cd       = best?.expiry?.countdown?.label || null;

  const dirE = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
  const htfE = htf === 'BUY' ? '📈' : htf === 'SELL' ? '📉' : '➡️';

  let msg = `📊 ${label} | ${interval}min\n━━━━━━━━━━━━━━\n`;

  if (dir === 'BUY' || dir === 'SELL') {
    msg += `${dirE} ${dir}  ${conf}  ${grade}\n`;
    if (expiry) msg += `⏰ Expiry: ${expiry}\n`;
    if (cd)     msg += `🕐 Candle closes: ${cd}\n`;
    msg += `${htfE} HTF 15min: ${htf}\n`;
    if (reason) msg += `\n📝 ${reason}\n`;
    msg += `\n⏳ Result will be tracked automatically`;
  } else {
    msg += `⚪ NO TRADE\n`;
    msg += filters.length > 0
      ? `🔕 ${filters.join(' · ')}`
      : `🔕 ${align === 'MIXED' ? 'Timeframes mixed' : 'Setup not clear'}`;
  }

  return msg;
}

function fmtHistory(history) {
  if (!history.length) return 'No signals logged yet.';
  let msg = `📈 Signal History (last ${history.length})\n━━━━━━━━━━━━━━\n`;
  for (const h of history.slice(0, 15)) {
    const dE = h.direction === 'BUY' ? '🟢' : '🔴';
    const rE = h.result === 'WIN' ? '✅' : h.result === 'LOSS' ? '❌' : h.result === 'SKIP' ? '⏭' : '⏳';
    const t  = new Date(h.timestamp).toUTCString().slice(5, 22);
    const p  = h.pips != null ? ` (${h.pips > 0 ? '+' : ''}${h.pips})` : '';
    msg += `${rE} ${dE} ${disp(h.pair)} ${h.confidence}${p}  ${t}\n`;
  }
  return msg;
}

function fmtStats(history) {
  const trades   = history.filter(h => h.direction === 'BUY' || h.direction === 'SELL');
  const resolved = trades.filter(h => h.result === 'WIN' || h.result === 'LOSS');
  const wins     = resolved.filter(h => h.result === 'WIN').length;
  const losses   = resolved.filter(h => h.result === 'LOSS').length;
  const total    = resolved.length;
  const wr       = total > 0 ? Math.round((wins / total) * 100) : 0;
  const pending  = trades.filter(h => !h.result).length;

  // Streak
  let streak = 0; let sType = '';
  for (const h of resolved) {
    if (!sType) { sType = h.result; streak = 1; }
    else if (h.result === sType) streak++;
    else break;
  }

  // Per pair
  const pm = {};
  for (const h of resolved) {
    if (!pm[h.pair]) pm[h.pair] = { w: 0, l: 0 };
    if (h.result === 'WIN')  pm[h.pair].w++;
    if (h.result === 'LOSS') pm[h.pair].l++;
  }

  let msg = `🏆 Win/Loss Stats\n━━━━━━━━━━━━━━\n`;
  msg += `✅ Wins:    ${wins}\n`;
  msg += `❌ Losses:  ${losses}\n`;
  msg += `📊 Win Rate: ${wr}% (${total} trades)\n`;
  msg += `⏳ Pending: ${pending}`;
  if (streak >= 2) msg += `\n🔥 Streak: ${streak} ${sType}s`;
  if (Object.keys(pm).length > 0) {
    msg += `\n\nPer Pair:\n`;
    for (const [pair, s] of Object.entries(pm)) {
      const t  = s.w + s.l;
      msg += `• ${disp(pair)}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`;
    }
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
  const text   = (msg.text || '').trim();
  const user   = await getUser(chatId, env);

  if (text.startsWith('/start')) {
    return send(chatId,
      `👋 FTT Signal Bot v2.2\n\n` +
      `Signals + Watchlist + Auto Win/Loss Tracking\n\n` +
      `Pair: EUR/USD  Interval: 5min  Auto OFF\n\nUse the buttons below 👇`,
      env, { reply_markup: mainKb(user.autoEnabled) });
  }
  if (text.startsWith('/signal'))    return doSignal(chatId, env);
  if (text.startsWith('/auto'))      return doToggle(chatId, env);
  if (text.startsWith('/status'))    return doStatus(chatId, env);
  if (text.startsWith('/history'))   return doHistory(chatId, env);
  if (text.startsWith('/stats'))     return doStats(chatId, env);
  if (text.startsWith('/watchlist')) return doWatchlist(chatId, env);

  if (text.startsWith('/pair ')) {
    const raw = text.slice(6).trim().toUpperCase().replace(/[\s/]/g,'');
    user.pair = raw;
    await saveUser(chatId, user, env);
    return send(chatId, `✅ Pair set to ${disp(raw)}`, env, { reply_markup: mainKb(user.autoEnabled) });
  }
  if (text.startsWith('/interval ')) {
    const m = parseInt(text.slice(10).trim(), 10);
    if (VALID_INTERVALS.includes(m)) {
      user.interval = m;
      await saveUser(chatId, user, env);
      return send(chatId, `✅ Interval set to ${m} min`, env, { reply_markup: mainKb(user.autoEnabled) });
    }
    return send(chatId, `❌ Valid: 1, 5, 15`, env);
  }
  if (text.startsWith('/help')) {
    return send(chatId,
      `/signal /auto /watchlist /history /stats /status\n/pair EURUSD\n/interval 5`,
      env, { reply_markup: mainKb(user.autoEnabled) });
  }
  return send(chatId, `Use the buttons below 👇`, env, { reply_markup: mainKb(user.autoEnabled) });
}

async function handleCb(cb, env) {
  const chatId = cb.message.chat.id;
  const msgId  = cb.message.message_id;
  const data   = cb.data;
  await answerCb(cb.id, '', env);
  const user = await getUser(chatId, env);

  if (data === 'cmd:main') {
    return edit(chatId, msgId,
      `FTT Signal Bot\n\n${disp(user.pair)}  ${user.interval}min  ${user.autoEnabled ? 'Auto ON' : 'Auto OFF'}\nWatchlist: ${user.watchlist.length} pairs`,
      env, { reply_markup: mainKb(user.autoEnabled) });
  }
  if (data === 'cmd:signal')      return doSignal(chatId, env, msgId);
  if (data === 'cmd:toggle_auto') return doToggle(chatId, env, msgId);
  if (data === 'cmd:status')      return doStatus(chatId, env, msgId);
  if (data === 'cmd:history')     return doHistory(chatId, env, msgId);
  if (data === 'cmd:stats')       return doStats(chatId, env, msgId);
  if (data === 'cmd:watchlist')   return doWatchlist(chatId, env, msgId);
  if (data === 'cmd:intervals') {
    return edit(chatId, msgId, `Select interval:`, env, { reply_markup: intervalKb() });
  }
  if (data.startsWith('pairpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    return edit(chatId, msgId, `Select pair:`, env, { reply_markup: pairsKb(page) });
  }
  if (data.startsWith('pair:')) {
    user.pair = norm(data.slice(5));
    await saveUser(chatId, user, env);
    return edit(chatId, msgId, `✅ Pair → ${disp(user.pair)}`, env, { reply_markup: mainKb(user.autoEnabled) });
  }
  if (data.startsWith('interval:')) {
    user.interval = parseInt(data.split(':')[1], 10);
    user.lastPairScanAt = {};
    await saveUser(chatId, user, env);
    return edit(chatId, msgId, `✅ Interval → ${user.interval} min`, env, { reply_markup: mainKb(user.autoEnabled) });
  }
  if (data.startsWith('wlpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    return edit(chatId, msgId, `Add to Watchlist (${user.watchlist.length}/${MAX_WATCHLIST}):`, env,
      { reply_markup: wlAddKb(page, user.watchlist) });
  }
  if (data.startsWith('wl:add:')) {
    const p = data.slice(7);
    if (!user.watchlist.includes(p) && user.watchlist.length < MAX_WATCHLIST) {
      user.watchlist = [...user.watchlist, p];
      await saveUser(chatId, user, env);
    }
    return doWatchlist(chatId, env, msgId);
  }
  if (data.startsWith('wl:rm:')) {
    user.watchlist = user.watchlist.filter(p => p !== data.slice(6));
    await saveUser(chatId, user, env);
    return doWatchlist(chatId, env, msgId);
  }
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

async function doSignal(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  if (msgId) await edit(chatId, msgId, `⏳ Fetching ${disp(user.pair)} signal...`, env);
  else       await send(chatId, `⏳ Fetching ${disp(user.pair)} signal...`, env);

  try {
    const data = await fetchSignal(user.pair, env);
    const sig  = data.signal;
    const dir  = sig?.finalSignal;
    const text = fmtSignal(data, user.pair, user.interval);

    if (dir === 'BUY' || dir === 'SELL') {
      await logAndSchedule(chatId, user.pair, sig, env);
    }

    if (msgId) await edit(chatId, msgId, text, env, { reply_markup: afterKb() });
    else       await send(chatId, text, env, { reply_markup: afterKb() });
  } catch (e) {
    console.error('doSignal:', e.message);
    const err = `❌ Signal fetch failed\n${e.message.slice(0, 200)}`;
    if (msgId) await edit(chatId, msgId, err, env, { reply_markup: mainKb(user.autoEnabled) });
    else       await send(chatId, err, env, { reply_markup: mainKb(user.autoEnabled) });
  }
}

async function logAndSchedule(chatId, pair, sig, env) {
  const dir           = sig.finalSignal;
  const expiryMinutes = sig.bestTimeframe?.expiry?.totalMinutes || 5;
  const expiryAt      = Date.now() + expiryMinutes * 60 * 1000;
  const entryPrice    = sig.recommendations?.['1min']?.entry?.price
                     || sig.recommendations?.['5min']?.entry?.price
                     || null;
  const tradeId = uid();

  await addToHistory(chatId, {
    id: tradeId, pair, direction: dir,
    confidence: sig.confidence || '0%',
    entryPrice, expiryMinutes,
    timestamp: new Date().toISOString(),
    result: null,
  }, env);

  await addPendingTrade({
    chatId: String(chatId), tradeId, pair, direction: dir,
    entryPrice, expiryAt,
  }, env);
}

async function doToggle(chatId, env, msgId = null) {
  const user       = await getUser(chatId, env);
  user.autoEnabled = !user.autoEnabled;
  user.lastPairScanAt = {};
  user.noTradeStreak  = 0;
  await saveUser(chatId, user, env);
  if (user.autoEnabled) await addAutoUser(chatId, env);
  else                  await removeAutoUser(chatId, env);

  const wl  = user.watchlist.map(disp).join(', ');
  const txt = user.autoEnabled
    ? `🔄 Auto Scan ON\n\n${disp(user.pair)}${wl ? '\nWatchlist: ' + wl : ''}\nInterval: ${user.interval} min\n\nSignals auto-logged. Results checked after expiry.`
    : `🔕 Auto Scan OFF`;

  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: mainKb(user.autoEnabled) });
  else       await send(chatId, txt, env, { reply_markup: mainKb(user.autoEnabled) });
}

async function doStatus(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  const txt  = `📋 Settings\n\n` +
    `Pair: ${disp(user.pair)}\n` +
    `Watchlist: ${user.watchlist.map(disp).join(', ') || 'None'}\n` +
    `Interval: ${user.interval} min\n` +
    `Auto Scan: ${user.autoEnabled ? 'ON' : 'OFF'}`;
  const kb = { inline_keyboard: [[
    { text: '💱 Pair',      callback_data: 'pairpage:0'    },
    { text: '⏱ Interval',   callback_data: 'cmd:intervals' },
  ],[
    { text: '👁 Watchlist', callback_data: 'cmd:watchlist' },
    { text: '🔙 Back',      callback_data: 'cmd:main'      },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doHistory(chatId, env, msgId = null) {
  const h   = await getHistory(chatId, env);
  const txt = fmtHistory(h);
  const kb  = { inline_keyboard: [[
    { text: '🏆 Stats', callback_data: 'cmd:stats' },
    { text: '🔙 Back',  callback_data: 'cmd:main'  },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doStats(chatId, env, msgId = null) {
  const h   = await getHistory(chatId, env);
  const txt = fmtStats(h);
  const kb  = { inline_keyboard: [[
    { text: '📈 History', callback_data: 'cmd:history' },
    { text: '🔙 Back',    callback_data: 'cmd:main'    },
  ]]};
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: kb });
  else       await send(chatId, txt, env, { reply_markup: kb });
}

async function doWatchlist(chatId, env, msgId = null) {
  const user = await getUser(chatId, env);
  const wl   = user.watchlist;
  const txt  = `👁 Watchlist (${wl.length}/${MAX_WATCHLIST})\n\n` +
    (wl.length > 0 ? `${wl.map(disp).join(', ')}\n\nTap to remove.` : `Empty — tap + Add Pairs`);
  if (msgId) await edit(chatId, msgId, txt, env, { reply_markup: wlKb(wl) });
  else       await send(chatId, txt, env, { reply_markup: wlKb(wl) });
}

// ─── AUTO SCAN ────────────────────────────────────────────────────────────────

async function runAutoScan(env, log = console.log, force = false) {
  const autoUsers = await getAutoUsers(env);
  log('Auto scan users: ' + autoUsers.length);
  if (!autoUsers.length) return;

  const now = Date.now();

  for (const chatId of autoUsers) {
    try {
      const user = await getUser(chatId, env);
      if (!user.autoEnabled) continue;

      const scanList   = [user.pair, ...(user.watchlist || [])].filter(
        (p, i, a) => a.indexOf(p) === i
      );

      for (const pair of scanList) {

        log(`Scanning ${pair} for ${chatId}`);

        try {
          const data = await fetchSignal(pair, env);
          const sig  = data.signal;
          const dir  = sig?.finalSignal;

          if (dir === 'BUY' || dir === 'SELL') {
            const text = fmtSignal(data, pair, user.interval);
            await send(chatId, text, env, { reply_markup: afterKb() });
            await logAndSchedule(chatId, pair, sig, env);
            user.noTradeStreak = 0;
          } else {
            user.noTradeStreak = (user.noTradeStreak || 0) + 1;
            if (user.noTradeStreak >= 10) {
              await send(chatId,
                `⚪ No clear setup across ${scanList.length} pair(s) for ${user.noTradeStreak} scans.`,
                env, { reply_markup: { inline_keyboard: [[
                  { text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' },
                ]]}});
              user.noTradeStreak = 0;
            }
          }



        } catch (e) {
          console.error(`Scan ${pair} [${chatId}]:`, e.message);
        }
      }

      await saveUser(chatId, user, env);

    } catch (e) {
      console.error(`AutoScan [${chatId}]:`, e.message);
    }
  }
}

// ─── AUTO RESULT CHECK ────────────────────────────────────────────────────────

async function runResultCheck(env, log = console.log) {
  const ids = await getPendingIds(env);
  if (!ids.length) return;
  log('Checking results for ' + ids.length + ' trades');

  const now       = Date.now();
  const remaining = [];

  for (const tradeId of ids) {
    try {
      const trade = await kvGet(`pt:${tradeId}`, env);
      if (!trade) continue; // expired from KV

      if (trade.expiryAt > now) {
        remaining.push(tradeId);
        continue;
      }

      // Expired — check price
      const currentPrice = await fetchCurrentPrice(trade.pair, env);

      if (currentPrice === null || trade.entryPrice === null) {
        await setTradeResult(trade.chatId, tradeId, 'SKIP', null, null, env);
        await send(trade.chatId,
          `⏭ Trade expired — could not verify price for ${disp(trade.pair)}\nID: ${tradeId}`,
          env, { reply_markup: afterKb() });
        continue;
      }

      const entry   = parseFloat(trade.entryPrice);
      const current = parseFloat(currentPrice);
      const diff    = current - entry;
      const result  = trade.direction === 'BUY'
        ? (diff > 0 ? 'WIN' : 'LOSS')
        : (diff < 0 ? 'WIN' : 'LOSS');

      const crypto = isCrypto(trade.pair);
      const pips   = crypto
        ? Math.round(Math.abs(diff) * 100) / 100
        : Math.round(Math.abs(diff) * 10000 * 10) / 10;
      const unit   = crypto ? '$' : ' pips';

      await setTradeResult(trade.chatId, tradeId, result, current, pips, env);

      const dirE = trade.direction === 'BUY' ? '🟢' : '🔴';
      const resE = result === 'WIN' ? '✅ WIN' : '❌ LOSS';

      await send(trade.chatId,
        `${resE} — Auto Result\n` +
        `━━━━━━━━━━━━━━\n` +
        `${dirE} ${trade.direction} ${disp(trade.pair)}\n` +
        `Entry:  ${entry.toFixed(5)}\n` +
        `Exit:   ${current.toFixed(5)}\n` +
        `Move:   ${diff > 0 ? '+' : ''}${pips}${unit}\n` +
        `ID: ${tradeId}`,
        env, { reply_markup: afterKb() });

    } catch (e) {
      console.error(`ResultCheck ${tradeId}:`, e.message);
      remaining.push(tradeId);
    }
  }

  await kvPut('pending_ids', remaining, env);
}
