/**
 * FTT Signal Telegram Bot — Cloudflare Worker
 * v2.1 — Auto Win/Loss tracking after signal expiry
 *
 * Secrets:
 *   BOT_TOKEN    — Telegram bot token
 *   SETUP_SECRET — Webhook setup password
 *
 * KV Binding     : BOT_KV
 * Service Binding: SIGNAL_WORKER → my-worker-601
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

    return new Response('FTT Signal Bot v2.1 — OK');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};

// ─── SIGNAL FETCH (Service Binding) ──────────────────────────────────────────

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
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Current price from signal API (1min close = latest price)
async function fetchCurrentPrice(pair, env) {
  const data = await fetchSignal(pair, env);
  // Try to get latest close price from 1min or any available TF
  const tf1 = data?.signal?.recommendations?.['1min']?.entry?.price;
  const tf5 = data?.signal?.recommendations?.['5min']?.entry?.price;
  const tf15 = data?.signal?.recommendations?.['15min']?.entry?.price;
  return tf1 || tf5 || tf15 || null;
}

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────

function tgApi(env) { return `https://api.telegram.org/bot${env.BOT_TOKEN}`; }

async function tgCall(method, body, env) {
  try {
    const res = await fetch(`${tgApi(env)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`tgCall ${method} ${res.status}:`, await res.text());
  } catch (e) { console.error(`tgCall ${method}:`, e.message); }
}

function sendMessage(chatId, text, env, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId, text, parse_mode: 'Markdown',
    disable_web_page_preview: true, ...extra,
  }, env);
}

function editMessage(chatId, messageId, text, env, extra = {}) {
  return tgCall('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown',
    disable_web_page_preview: true, ...extra,
  }, env);
}

function answerCallback(id, text, env) {
  return tgCall('answerCallbackQuery', { callback_query_id: id, text: text || '' }, env);
}

// ─── KV: USER DATA ────────────────────────────────────────────────────────────

function defaultUser() {
  return {
    pair: 'EURUSD',
    watchlist: [],
    interval: 5,
    autoEnabled: false,
    lastSignalAt: 0,
    lastPairScanAt: {},
    noTradeStreak: 0,
  };
}

async function getUser(chatId, env) {
  try {
    const d = await env.BOT_KV.get(`user:${chatId}`, 'json');
    return d ? { ...defaultUser(), ...d } : defaultUser();
  } catch { return defaultUser(); }
}

async function saveUser(chatId, data, env) {
  try { await env.BOT_KV.put(`user:${chatId}`, JSON.stringify(data)); }
  catch (e) { console.error('saveUser:', e.message); }
}

async function getAutoUsers(env) {
  try { return (await env.BOT_KV.get('auto_users', 'json')) || []; }
  catch { return []; }
}

async function addAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  const id = String(chatId);
  if (!list.includes(id)) {
    list.push(id);
    await env.BOT_KV.put('auto_users', JSON.stringify(list));
  }
}

async function removeAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  await env.BOT_KV.put('auto_users', JSON.stringify(
    list.filter(id => id !== String(chatId))
  ));
}

// ─── KV: SIGNAL HISTORY ───────────────────────────────────────────────────────

async function getHistory(chatId, env) {
  try { return (await env.BOT_KV.get(`history:${chatId}`, 'json')) || []; }
  catch { return []; }
}

async function addToHistory(chatId, entry, env) {
  const history = await getHistory(chatId, env);
  history.unshift(entry);
  await env.BOT_KV.put(`history:${chatId}`, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

async function updateHistoryResult(chatId, tradeId, result, exitPrice, env) {
  const history = await getHistory(chatId, env);
  const idx = history.findIndex(h => h.id === tradeId);
  if (idx !== -1) {
    history[idx].result    = result;
    history[idx].exitPrice = exitPrice || null;
    history[idx].resolvedAt = new Date().toISOString();
    await env.BOT_KV.put(`history:${chatId}`, JSON.stringify(history));
    return history[idx];
  }
  return null;
}

// Pending trades for auto result check
async function getPendingTrades(env) {
  try { return (await env.BOT_KV.get('pending_trades', 'json')) || []; }
  catch { return []; }
}

async function addPendingTrade(trade, env) {
  const list = await getPendingTrades(env);
  list.push(trade);
  await env.BOT_KV.put('pending_trades', JSON.stringify(list));
}

async function savePendingTrades(list, env) {
  await env.BOT_KV.put('pending_trades', JSON.stringify(list));
}

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

function mainKeyboard(autoEnabled) {
  return {
    inline_keyboard: [
      [
        { text: '📊 Signal Now',  callback_data: 'cmd:signal'      },
        { text: autoEnabled ? '🔕 Stop Auto' : '🔄 Start Auto', callback_data: 'cmd:toggle_auto' },
      ],
      [
        { text: '💱 Change Pair', callback_data: 'pairpage:0'      },
        { text: '⏱ Set Interval', callback_data: 'cmd:intervals'   },
      ],
      [
        { text: '👁 Watchlist',   callback_data: 'cmd:watchlist'   },
        { text: '📈 History',     callback_data: 'cmd:history'     },
      ],
      [
        { text: '🏆 Stats',       callback_data: 'cmd:stats'       },
        { text: '📋 Status',      callback_data: 'cmd:status'      },
      ],
    ],
  };
}

function pairsKeyboard(page) {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const pairs = PAIR_PAGES[page];
  const keyboard = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const row = [{ text: pairs[i], callback_data: `pair:${pairs[i]}` }];
    if (pairs[i + 1]) row.push({ text: pairs[i + 1], callback_data: `pair:${pairs[i + 1]}` });
    keyboard.push(row);
  }
  const nav = [];
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `pairpage:${page - 1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `pairpage:${page + 1}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: '🔙 Back', callback_data: 'cmd:main' }]);
  return { inline_keyboard: keyboard };
}

function watchlistAddKeyboard(page, watchlist) {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const pairs = PAIR_PAGES[page];
  const keyboard = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, pairs.length); j++) {
      const p    = pairs[j];
      const code = normalizePair(p);
      const inWL = watchlist.includes(code);
      row.push({
        text: inWL ? `✅ ${p}` : p,
        callback_data: inWL ? `wl:remove:${code}` : `wl:add:${code}`,
      });
    }
    keyboard.push(row);
  }
  const nav = [];
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `wlpage:${page - 1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `wlpage:${page + 1}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: '🔙 Watchlist', callback_data: 'cmd:watchlist' }]);
  return { inline_keyboard: keyboard };
}

function watchlistKeyboard(watchlist) {
  const keyboard = [];
  for (let i = 0; i < watchlist.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, watchlist.length); j++) {
      row.push({ text: `❌ ${displayPair(watchlist[j])}`, callback_data: `wl:remove:${watchlist[j]}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: '➕ Add Pairs', callback_data: 'wlpage:0' }]);
  keyboard.push([{ text: '🔙 Back', callback_data: 'cmd:main' }]);
  return { inline_keyboard: keyboard };
}

function intervalKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⚡ 1 min',  callback_data: 'interval:1'  },
        { text: '📊 5 min',  callback_data: 'interval:5'  },
        { text: '🕐 15 min', callback_data: 'interval:15' },
      ],
      [{ text: '🔙 Back', callback_data: 'cmd:main' }],
    ],
  };
}

function afterSignalKeyboard() {
  return {
    inline_keyboard: [[
      { text: '🔁 New Signal', callback_data: 'cmd:signal'  },
      { text: '📈 History',    callback_data: 'cmd:history' },
      { text: '🔙 Menu',       callback_data: 'cmd:main'    },
    ]],
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function esc(text) {
  if (!text) return '';
  return String(text).replace(/[_*`[\]]/g, '\\$&');
}

function displayPair(pair) {
  if (!pair.includes('/') && pair.length === 6)
    return pair.slice(0, 3) + '/' + pair.slice(3);
  return pair;
}

function normalizePair(pair) {
  return pair.replace('/', '');
}

function shortId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── SIGNAL FORMATTER ─────────────────────────────────────────────────────────

function formatSignal(data, pair, interval) {
  const label = displayPair(pair);

  if (data.marketStatus === 'CLOSED') {
    return (
      `📊 *${label}* | ${interval}min\n━━━━━━━━━━━━━━\n` +
      `🔴 *Forex Market CLOSED*\n` +
      `🕐 Opens in: ${data.opensIn || 'Soon'}\n\n` +
      `💡 Crypto pairs trade 24/7 — try BTC/USD`
    );
  }

  const sig = data.signal;
  if (!sig) return `📊 *${label}* | ${interval}min\n━━━━━━━━━━━━━━\n❌ No signal data`;

  const dir      = sig.finalSignal   || 'NO_TRADE';
  const conf     = sig.confidence    || '0%';
  const grade    = sig.grade ? `*${sig.grade.grade}* ${sig.grade.label}` : '';
  const htf      = sig.higherTFTrend || 'NEUTRAL';
  const reason   = sig.entryReason   || '';
  const filters  = sig.filtersApplied || [];
  const align    = sig.alignment     || '';

  const dirEmoji = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
  const htfEmoji = htf === 'BUY' ? '📈' : htf === 'SELL' ? '📉' : '➡️';

  const best      = sig.bestTimeframe;
  const expiry    = best?.expiry?.humanReadable || null;
  const countdown = best?.expiry?.countdown?.label || null;

  let msg = `📊 *${label}* | ${interval}min\n━━━━━━━━━━━━━━\n`;

  if (dir === 'BUY' || dir === 'SELL') {
    msg += `${dirEmoji} *${dir}*  ${conf}  ${grade}\n`;
    if (expiry)    msg += `⏰ Expiry: *${expiry}*\n`;
    if (countdown) msg += `🕐 Candle closes: *${countdown}*\n`;
    msg += `${htfEmoji} HTF 15min: *${htf}*\n`;
    if (reason)    msg += `\n📝 _${esc(reason)}_\n`;
    msg += `\n⏳ _Result will be checked automatically after expiry_`;
  } else {
    msg += `⚪ *NO TRADE*\n`;
    msg += filters.length > 0
      ? `🔕 _${esc(filters.join(' · '))}_`
      : `🔕 _${align === 'MIXED' ? 'Timeframes mixed' : 'Setup not clear'}_`;
  }

  return msg;
}

function formatHistory(history) {
  if (!history || history.length === 0)
    return `📈 *Signal History*\n\n_No signals logged yet._`;

  let msg = `📈 *Signal History* (last ${history.length})\n━━━━━━━━━━━━━━\n`;

  for (const h of history.slice(0, 15)) {
    const dirEmoji = h.direction === 'BUY' ? '🟢' : '🔴';
    const resEmoji = h.result === 'WIN'    ? '✅'
                   : h.result === 'LOSS'   ? '❌'
                   : h.result === 'SKIP'   ? '⏭'
                   : '⏳';
    const time = new Date(h.timestamp).toUTCString().slice(5, 22);
    const pnl  = h.pips != null ? ` (${h.pips > 0 ? '+' : ''}${h.pips} pips)` : '';
    msg += `${resEmoji} ${dirEmoji} *${displayPair(h.pair)}* ${h.confidence}${pnl} — ${time}\n`;
  }

  return msg;
}

function formatStats(history) {
  const trades   = history.filter(h => h.direction === 'BUY' || h.direction === 'SELL');
  const resolved = trades.filter(h => h.result === 'WIN' || h.result === 'LOSS');
  const wins     = resolved.filter(h => h.result === 'WIN').length;
  const losses   = resolved.filter(h => h.result === 'LOSS').length;
  const total    = resolved.length;
  const wr       = total > 0 ? Math.round((wins / total) * 100) : 0;
  const pending  = trades.filter(h => !h.result).length;

  // Streak
  let streak = 0; let streakType = '';
  for (const h of resolved) {
    if (streak === 0) { streakType = h.result; streak = 1; }
    else if (h.result === streakType) streak++;
    else break;
  }
  const streakText = streak >= 2 ? `\n🔥 Current streak: *${streak} ${streakType}s*` : '';

  // Per-pair stats
  const pairMap = {};
  for (const h of resolved) {
    if (!pairMap[h.pair]) pairMap[h.pair] = { w: 0, l: 0 };
    if (h.result === 'WIN')  pairMap[h.pair].w++;
    if (h.result === 'LOSS') pairMap[h.pair].l++;
  }

  let msg = `🏆 *Win/Loss Statistics*\n━━━━━━━━━━━━━━\n`;
  msg += `✅ Wins:      *${wins}*\n`;
  msg += `❌ Losses:    *${losses}*\n`;
  msg += `📊 Win Rate:  *${wr}%* (${total} trades)\n`;
  msg += `⏳ Pending:   *${pending}*`;
  msg += streakText;

  if (Object.keys(pairMap).length > 0) {
    msg += `\n\n*Per Pair:*\n`;
    for (const [pair, s] of Object.entries(pairMap)) {
      const t   = s.w + s.l;
      const pwr = Math.round((s.w / t) * 100);
      msg += `• ${displayPair(pair)}: ${s.w}W / ${s.l}L (${pwr}%)\n`;
    }
  }

  return msg;
}

// ─── UPDATE HANDLER ───────────────────────────────────────────────────────────

async function handleUpdate(update, env) {
  try {
    if (update.message)             await handleMessage(update.message, env);
    else if (update.callback_query) await handleCallback(update.callback_query, env);
  } catch (e) { console.error('handleUpdate:', e.message); }
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const user   = await getUser(chatId, env);

  if (text.startsWith('/start')) {
    return sendMessage(chatId,
      `👋 *FTT Signal Bot v2.1*\n\n` +
      `Signals + Watchlist + Auto Win/Loss Tracking\n\n` +
      `💱 Pair: *EUR/USD*  ⏱ *5min*  🔕 Auto OFF\n\nUse the buttons below 👇`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (text.startsWith('/signal'))    return doSignal(chatId, env);
  if (text.startsWith('/auto'))      return doToggleAuto(chatId, env);
  if (text.startsWith('/status'))    return doStatus(chatId, env);
  if (text.startsWith('/history'))   return doHistory(chatId, env);
  if (text.startsWith('/stats'))     return doStats(chatId, env);
  if (text.startsWith('/watchlist')) return doWatchlist(chatId, env);

  if (text.startsWith('/pair ')) {
    const raw  = text.slice(6).trim().toUpperCase().replace(/[\s/]/g, '');
    user.pair  = raw;
    await saveUser(chatId, user, env);
    return sendMessage(chatId, `✅ Pair set to *${displayPair(raw)}*`, env,
      { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (text.startsWith('/interval ')) {
    const m = parseInt(text.slice(10).trim(), 10);
    if (VALID_INTERVALS.includes(m)) {
      user.interval = m;
      await saveUser(chatId, user, env);
      return sendMessage(chatId, `✅ Interval set to *${m} min*`, env,
        { reply_markup: mainKeyboard(user.autoEnabled) });
    }
    return sendMessage(chatId, `❌ Valid intervals: 1, 5, 15`, env);
  }

  if (text.startsWith('/help')) {
    return sendMessage(chatId,
      `*FTT Signal Bot v2.1*\n\n` +
      `/signal — Get signal now\n/auto — Toggle auto scan\n` +
      `/watchlist — Manage watchlist\n/history — Signal history\n` +
      `/stats — Win/Loss stats\n/status — Settings\n` +
      `/pair EURUSD — Set pair\n/interval 5 — Set interval\n\nOr use buttons 👇`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  return sendMessage(chatId, `Use the buttons below 👇`, env,
    { reply_markup: mainKeyboard(user.autoEnabled) });
}

async function handleCallback(cb, env) {
  const chatId = cb.message.chat.id;
  const msgId  = cb.message.message_id;
  const data   = cb.data;

  await answerCallback(cb.id, '', env);
  const user = await getUser(chatId, env);

  if (data === 'cmd:main') {
    return editMessage(chatId, msgId,
      `🏠 *FTT Signal Bot v2.1*\n\n` +
      `💱 *${displayPair(user.pair)}*  ⏱ ${user.interval}min  ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}\n` +
      `👁 Watchlist: *${user.watchlist.length}* pairs`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data === 'cmd:signal')      return doSignal(chatId, env, msgId);
  if (data === 'cmd:toggle_auto') return doToggleAuto(chatId, env, msgId);
  if (data === 'cmd:status')      return doStatus(chatId, env, msgId);
  if (data === 'cmd:history')     return doHistory(chatId, env, msgId);
  if (data === 'cmd:stats')       return doStats(chatId, env, msgId);
  if (data === 'cmd:watchlist')   return doWatchlist(chatId, env, msgId);

  if (data === 'cmd:intervals') {
    return editMessage(chatId, msgId,
      `⏱ *Select Scan Interval*`,
      env, { reply_markup: intervalKeyboard() });
  }

  if (data.startsWith('pairpage:')) {
    const page  = parseInt(data.split(':')[1], 10);
    const label = page < 3 ? '🏦 Forex' : '🪙 Crypto';
    return editMessage(chatId, msgId,
      `💱 *${label} Pairs* — Select default pair:`,
      env, { reply_markup: pairsKeyboard(page) });
  }

  if (data.startsWith('pair:')) {
    const raw  = normalizePair(data.slice(5));
    user.pair  = raw;
    await saveUser(chatId, user, env);
    return editMessage(chatId, msgId,
      `✅ Default pair → *${displayPair(raw)}*`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data.startsWith('interval:')) {
    const mins           = parseInt(data.split(':')[1], 10);
    user.interval        = mins;
    user.lastSignalAt    = 0;
    user.lastPairScanAt  = {};
    await saveUser(chatId, user, env);
    return editMessage(chatId, msgId,
      `✅ Interval → *${mins} min*`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data.startsWith('wlpage:')) {
    const page = parseInt(data.split(':')[1], 10);
    const wl   = user.watchlist || [];
    return editMessage(chatId, msgId,
      `👁 *Add to Watchlist* (${wl.length}/${MAX_WATCHLIST})\n\n✅ = already added`,
      env, { reply_markup: watchlistAddKeyboard(page, wl) });
  }

  if (data.startsWith('wl:add:')) {
    const pair = data.slice(7);
    const wl   = user.watchlist || [];
    if (!wl.includes(pair) && wl.length < MAX_WATCHLIST) {
      user.watchlist = [...wl, pair];
      await saveUser(chatId, user, env);
    }
    return doWatchlist(chatId, env, msgId);
  }

  if (data.startsWith('wl:remove:')) {
    const pair         = data.slice(10);
    user.watchlist     = (user.watchlist || []).filter(p => p !== pair);
    await saveUser(chatId, user, env);
    return doWatchlist(chatId, env, msgId);
  }
}

// ─── COMMAND ACTIONS ──────────────────────────────────────────────────────────

async function doSignal(chatId, env, editMsgId = null) {
  const user    = await getUser(chatId, env);
  const label   = displayPair(user.pair);
  const loading = `⏳ Fetching *${label}* signal...`;

  if (editMsgId) await editMessage(chatId, editMsgId, loading, env);
  else           await sendMessage(chatId, loading, env);

  try {
    const data = await fetchSignal(user.pair, env);
    const sig  = data.signal;
    const dir  = sig?.finalSignal;

    if (dir === 'BUY' || dir === 'SELL') {
      // Entry price
      const entryPrice = sig.recommendations?.['1min']?.entry?.price
                      || sig.recommendations?.['5min']?.entry?.price
                      || sig.bestTimeframe?.expiry?.candles ? null : null;

      // Expiry in ms from now
      const expiryMinutes = sig.bestTimeframe?.expiry?.totalMinutes || user.interval;
      const expiryAt      = Date.now() + expiryMinutes * 60 * 1000;

      const tradeId = shortId();

      // Log to history
      await addToHistory(chatId, {
        id:         tradeId,
        pair:       user.pair,
        direction:  dir,
        confidence: sig.confidence || '0%',
        entryPrice: entryPrice,
        expiryMinutes: expiryMinutes,
        timestamp:  new Date().toISOString(),
        result:     null,
      }, env);

      // Add to pending auto-check list
      await addPendingTrade({
        chatId:    String(chatId),
        tradeId:   tradeId,
        pair:      user.pair,
        direction: dir,
        entryPrice: entryPrice,
        expiryAt:  expiryAt,
      }, env);

      const text = formatSignal(data, user.pair, user.interval);
      if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: afterSignalKeyboard() });
      else           await sendMessage(chatId, text, env, { reply_markup: afterSignalKeyboard() });
    } else {
      const text = formatSignal(data, user.pair, user.interval);
      const kb   = { inline_keyboard: [[
        { text: '🔁 Refresh', callback_data: 'cmd:signal' },
        { text: '🔙 Menu',    callback_data: 'cmd:main'   },
      ]] };
      if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: kb });
      else           await sendMessage(chatId, text, env, { reply_markup: kb });
    }
  } catch (e) {
    console.error('doSignal:', e.message);
    const err = `❌ *Signal fetch failed*\n\n\`${e.message.slice(0, 300)}\``;
    if (editMsgId) await editMessage(chatId, editMsgId, err, env, { reply_markup: mainKeyboard(user.autoEnabled) });
    else           await sendMessage(chatId, err, env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }
}

async function doToggleAuto(chatId, env, editMsgId = null) {
  const user         = await getUser(chatId, env);
  user.autoEnabled   = !user.autoEnabled;
  user.lastSignalAt  = 0;
  user.lastPairScanAt = {};
  user.noTradeStreak = 0;
  await saveUser(chatId, user, env);

  if (user.autoEnabled) await addAutoUser(chatId, env);
  else                  await removeAutoUser(chatId, env);

  const wlInfo = user.watchlist.length > 0
    ? `\n👁 Watchlist: *${user.watchlist.map(displayPair).join(', ')}*` : '';

  const txt = user.autoEnabled
    ? `🔄 *Auto Scan ON*\n\n💱 *${displayPair(user.pair)}*${wlInfo}\n⏱ *${user.interval} min*\n\nSignals auto-logged. Results checked at expiry.`
    : `🔕 *Auto Scan OFF*`;

  if (editMsgId) await editMessage(chatId, editMsgId, txt, env, { reply_markup: mainKeyboard(user.autoEnabled) });
  else           await sendMessage(chatId, txt, env, { reply_markup: mainKeyboard(user.autoEnabled) });
}

async function doStatus(chatId, env, editMsgId = null) {
  const user       = await getUser(chatId, env);
  const autoStatus = user.autoEnabled ? '✅ ON' : '🔕 OFF';
  const wl         = (user.watchlist || []).map(displayPair).join(', ') || 'None';
  const lastSent   = user.lastSignalAt ? new Date(user.lastSignalAt).toUTCString() : 'Never';

  const text = (
    `📋 *Settings*\n\n` +
    `💱 Pair: *${displayPair(user.pair)}*\n` +
    `👁 Watchlist: *${wl}*\n` +
    `⏱ Interval: *${user.interval} min*\n` +
    `🔄 Auto Scan: *${autoStatus}*\n` +
    `🕐 Last signal: ${lastSent}`
  );

  const kb = { inline_keyboard: [
    [
      { text: '💱 Change Pair',    callback_data: 'pairpage:0'    },
      { text: '⏱ Change Interval', callback_data: 'cmd:intervals' },
    ],
    [
      { text: '👁 Watchlist', callback_data: 'cmd:watchlist' },
      { text: '🔙 Back',      callback_data: 'cmd:main'      },
    ],
  ]};

  if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: kb });
  else           await sendMessage(chatId, text, env, { reply_markup: kb });
}

async function doHistory(chatId, env, editMsgId = null) {
  const history = await getHistory(chatId, env);
  const text    = formatHistory(history);
  const kb = { inline_keyboard: [[
    { text: '🏆 Stats', callback_data: 'cmd:stats' },
    { text: '🔙 Back',  callback_data: 'cmd:main'  },
  ]]};
  if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: kb });
  else           await sendMessage(chatId, text, env, { reply_markup: kb });
}

async function doStats(chatId, env, editMsgId = null) {
  const history = await getHistory(chatId, env);
  const text    = formatStats(history);
  const kb = { inline_keyboard: [[
    { text: '📈 History', callback_data: 'cmd:history' },
    { text: '🔙 Back',    callback_data: 'cmd:main'    },
  ]]};
  if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: kb });
  else           await sendMessage(chatId, text, env, { reply_markup: kb });
}

async function doWatchlist(chatId, env, editMsgId = null) {
  const user = await getUser(chatId, env);
  const wl   = user.watchlist || [];
  const text = (
    `👁 *Watchlist* (${wl.length}/${MAX_WATCHLIST})\n\n` +
    (wl.length > 0
      ? `*${wl.map(displayPair).join(', ')}*\n\nTap a pair to remove it.`
      : `_Empty — tap ➕ Add Pairs to start._`)
  );
  if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: watchlistKeyboard(wl) });
  else           await sendMessage(chatId, text, env, { reply_markup: watchlistKeyboard(wl) });
}

// ─── CRON: Auto Scan + Auto Win/Loss Check ────────────────────────────────────

async function runCron(env) {
  await Promise.all([
    runAutoScan(env),
    runResultCheck(env),
  ]);
}

// ── Auto Scan ─────────────────────────────────────────────────────────────────

async function runAutoScan(env) {
  const autoUsers = await getAutoUsers(env);
  if (!autoUsers.length) return;

  const now = Date.now();

  for (const chatId of autoUsers) {
    try {
      const user = await getUser(chatId, env);
      if (!user.autoEnabled) continue;

      const intervalMs = user.interval * 60 * 1000;
      const scanList   = [user.pair, ...(user.watchlist || [])].filter(
        (p, i, arr) => arr.indexOf(p) === i
      );

      let changed = false;

      for (const pair of scanList) {
        const lastScan = (user.lastPairScanAt || {})[pair] || 0;
        if (now - lastScan < intervalMs) continue;

        try {
          const data = await fetchSignal(pair, env);
          const sig  = data.signal;
          const dir  = sig?.finalSignal;

          if (dir === 'BUY' || dir === 'SELL') {
            const expiryMinutes = sig.bestTimeframe?.expiry?.totalMinutes || user.interval;
            const expiryAt      = now + expiryMinutes * 60 * 1000;
            const entryPrice    = sig.recommendations?.['1min']?.entry?.price
                               || sig.recommendations?.['5min']?.entry?.price
                               || null;
            const tradeId = shortId();

            await addToHistory(chatId, {
              id:            tradeId,
              pair:          pair,
              direction:     dir,
              confidence:    sig.confidence || '0%',
              entryPrice:    entryPrice,
              expiryMinutes: expiryMinutes,
              timestamp:     new Date().toISOString(),
              result:        null,
            }, env);

            await addPendingTrade({
              chatId:     String(chatId),
              tradeId:    tradeId,
              pair:       pair,
              direction:  dir,
              entryPrice: entryPrice,
              expiryAt:   expiryAt,
            }, env);

            const text = formatSignal(data, pair, user.interval);
            await sendMessage(chatId, text, env, { reply_markup: afterSignalKeyboard() });
            user.noTradeStreak = 0;

          } else {
            user.noTradeStreak = (user.noTradeStreak || 0) + 1;
            if (user.noTradeStreak >= 10) {
              await sendMessage(chatId,
                `⚪ No clear setup across ${scanList.length} pair(s) for ${user.noTradeStreak} scans.`,
                env, { reply_markup: { inline_keyboard: [[
                  { text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' },
                ]]}});
              user.noTradeStreak = 0;
            }
          }

          if (!user.lastPairScanAt) user.lastPairScanAt = {};
          user.lastPairScanAt[pair] = now;
          changed = true;

        } catch (e) {
          console.error(`Scan ${pair} [${chatId}]:`, e.message);
        }
      }

      if (changed) {
        user.lastSignalAt = now;
        await saveUser(chatId, user, env);
      }

    } catch (e) {
      console.error(`Auto scan [${chatId}]:`, e.message);
    }
  }
}

// ── Auto Result Check ─────────────────────────────────────────────────────────

async function runResultCheck(env) {
  const pending = await getPendingTrades(env);
  if (!pending.length) return;

  const now       = Date.now();
  const remaining = [];

  for (const trade of pending) {
    // Not expired yet
    if (trade.expiryAt > now) {
      remaining.push(trade);
      continue;
    }

    // Expired — check current price
    try {
      const currentPrice = await fetchCurrentPrice(trade.pair, env);

      if (currentPrice === null || trade.entryPrice === null) {
        // Can't determine result — mark SKIP
        await updateHistoryResult(trade.chatId, trade.tradeId, 'SKIP', null, env);
        await sendMessage(trade.chatId,
          `⏭ *Trade expired* — couldn't verify price for *${displayPair(trade.pair)}*\n` +
          `\`${trade.tradeId}\` marked as Skipped.`,
          env, { reply_markup: afterSignalKeyboard() });
        continue;
      }

      const entry   = parseFloat(trade.entryPrice);
      const current = parseFloat(currentPrice);
      const diff    = current - entry;

      // WIN/LOSS logic
      let result;
      if (trade.direction === 'BUY')  result = diff > 0 ? 'WIN' : 'LOSS';
      else                             result = diff < 0 ? 'WIN' : 'LOSS';

      // Pips calculation (forex: diff * 10000, crypto: diff)
      const isCrypto  = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK']
                          .some(b => trade.pair.startsWith(b));
      const pips      = isCrypto
        ? Math.round(Math.abs(diff) * 100) / 100
        : Math.round(Math.abs(diff) * 10000 * 10) / 10;
      const pipUnit   = isCrypto ? '$' : ' pips';

      await updateHistoryResult(trade.chatId, trade.tradeId, result, currentPrice, env);

      const emoji    = result === 'WIN' ? '✅' : '❌';
      const dirEmoji = trade.direction === 'BUY' ? '🟢' : '🔴';

      await sendMessage(trade.chatId,
        `${emoji} *${result}* — Auto Result\n` +
        `━━━━━━━━━━━━━━\n` +
        `${dirEmoji} *${trade.direction}* ${displayPair(trade.pair)}\n` +
        `📥 Entry:   *${entry.toFixed(5)}*\n` +
        `📤 Exit:    *${current.toFixed(5)}*\n` +
        `📏 Move:    *${pips}${pipUnit}*\n` +
        `\`${trade.tradeId}\``,
        env, { reply_markup: afterSignalKeyboard() });

    } catch (e) {
      console.error(`Result check ${trade.tradeId}:`, e.message);
      remaining.push(trade); // retry next cron
    }
  }

  await savePendingTrades(remaining, env);
}
