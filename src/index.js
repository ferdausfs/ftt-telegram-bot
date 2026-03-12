/**
 * FTT Signal Telegram Bot — Cloudflare Worker
 *
 * Features:
 *  - Pair selection (Forex + Crypto) via inline keyboard
 *  - Interval setting: 1min / 5min / 15min
 *  - Manual signal fetch: /signal
 *  - Auto scan via Cron trigger (runs every 1min, respects user interval)
 *  - Only sends BUY/SELL alerts — skips NO_TRADE silently during auto scan
 *  - Short, clean signal messages
 *
 * Secrets (set via Cloudflare dashboard or wrangler secret put):
 *  - BOT_TOKEN     : Telegram bot token from @BotFather
 *  - SETUP_SECRET  : Any password to protect /setup endpoint
 *
 * KV Binding: BOT_KV
 */

const SIGNAL_API = 'https://my-worker-601.umuhammadiswa.workers.dev';

// ─── PAIR PAGES (keyboard pages) ─────────────────────────────────────────────

const PAIR_PAGES = [
  ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
  ['USD/CAD', 'GBP/JPY', 'EUR/GBP', 'NZD/USD'],
  ['USD/CHF', 'EUR/JPY', 'EUR/AUD', 'AUD/JPY'],
  ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD'],
  ['XRP/USD', 'ADA/USD', 'DOGE/USD', 'AVAX/USD'],
];

const VALID_INTERVALS = [1, 5, 15];

// ─── ENTRY POINTS ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Telegram webhook
    if (request.method === 'POST' && url.pathname === '/webhook') {
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(update, env));
      return new Response('OK');
    }

    // One-time webhook registration
    // Visit: https://your-worker.workers.dev/setup?secret=YOUR_SETUP_SECRET
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
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('FTT Signal Telegram Bot — OK');
  },

  // Runs every minute; sends signals to users whose interval has elapsed
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoScan(env));
  },
};

// ─── TELEGRAM API HELPERS ────────────────────────────────────────────────────

function tgApi(env) {
  return `https://api.telegram.org/bot${env.BOT_TOKEN}`;
}

async function tgCall(method, body, env) {
  try {
    await fetch(`${tgApi(env)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`tgCall ${method} failed:`, e.message);
  }
}

function sendMessage(chatId, text, env, extra = {}) {
  return tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra }, env);
}

function editMessage(chatId, messageId, text, env, extra = {}) {
  return tgCall('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', ...extra,
  }, env);
}

function answerCallback(id, text, env) {
  return tgCall('answerCallbackQuery', { callback_query_id: id, text: text || '' }, env);
}

// ─── KV: USER DATA ───────────────────────────────────────────────────────────

async function getUser(chatId, env) {
  try {
    const d = await env.BOT_KV.get(`user:${chatId}`, 'json');
    return d || defaultUser();
  } catch {
    return defaultUser();
  }
}

function defaultUser() {
  return { pair: 'EUR/USD', interval: 5, autoEnabled: false, lastSignalAt: 0, noTradeStreak: 0 };
}

async function saveUser(chatId, data, env) {
  await env.BOT_KV.put(`user:${chatId}`, JSON.stringify(data));
}

// Auto-users list
async function getAutoUsers(env) {
  try { return (await env.BOT_KV.get('auto_users', 'json')) || []; }
  catch { return []; }
}

async function addAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  const id = String(chatId);
  if (!list.includes(id)) { list.push(id); await env.BOT_KV.put('auto_users', JSON.stringify(list)); }
}

async function removeAutoUser(chatId, env) {
  const list = await getAutoUsers(env);
  const filtered = list.filter(id => id !== String(chatId));
  await env.BOT_KV.put('auto_users', JSON.stringify(filtered));
}

// ─── KEYBOARDS ───────────────────────────────────────────────────────────────

function mainKeyboard(autoEnabled) {
  return {
    inline_keyboard: [
      [
        { text: '📊 Signal Now', callback_data: 'cmd:signal' },
        { text: autoEnabled ? '🔕 Stop Auto' : '🔄 Start Auto', callback_data: 'cmd:toggle_auto' },
      ],
      [
        { text: '💱 Change Pair', callback_data: 'pairpage:0' },
        { text: '⏱ Set Interval', callback_data: 'cmd:intervals' },
      ],
      [{ text: '📋 Status', callback_data: 'cmd:status' }],
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
  if (page > 0) nav.push({ text: '◀ Forex', callback_data: `pairpage:${page - 1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `pairpage:${page + 1}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: '🔙 Back', callback_data: 'cmd:main' }]);

  return { inline_keyboard: keyboard };
}

function intervalKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⚡ 1 min', callback_data: 'interval:1' },
        { text: '📊 5 min', callback_data: 'interval:5' },
        { text: '🕐 15 min', callback_data: 'interval:15' },
      ],
      [{ text: '🔙 Back', callback_data: 'cmd:main' }],
    ],
  };
}

function signalKeyboard(autoEnabled) {
  return {
    inline_keyboard: [
      [
        { text: '🔁 Refresh', callback_data: 'cmd:signal' },
        { text: autoEnabled ? '🔕 Stop Auto' : '🔄 Start Auto', callback_data: 'cmd:toggle_auto' },
      ],
      [{ text: '🔙 Menu', callback_data: 'cmd:main' }],
    ],
  };
}

// ─── SIGNAL FORMAT ───────────────────────────────────────────────────────────

async function fetchSignal(pair) {
  const url = `${SIGNAL_API}/api/signal?pair=${encodeURIComponent(pair)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatSignal(data, pair, interval) {
  // Market closed (Forex weekend)
  if (data.marketStatus === 'CLOSED') {
    return `📊 *${pair}* | ${interval}min\n` +
      `━━━━━━━━━━━━━━\n` +
      `🔴 *Forex Market CLOSED*\n` +
      `🕐 Opens: ${data.opensIn || 'Soon'}\n` +
      `💡 Try a crypto pair (BTC/USD runs 24/7)`;
  }

  const sig = data.signal;
  if (!sig) return `📊 *${pair}* | ${interval}min\n━━━━━━━━━━━━━━\n❌ No signal data`;

  const dir = sig.finalSignal;
  const conf = sig.confidence || '0%';
  const grade = sig.grade ? sig.grade.grade : '?';
  const gradeLabel = sig.grade ? sig.grade.label : '';
  const htfTrend = sig.higherTFTrend || 'NEUTRAL';
  const reason = sig.entryReason || '';
  const filters = sig.filtersApplied || [];
  const alignment = sig.alignment || '';

  const dirEmoji = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
  const htfEmoji = htfTrend === 'BUY' ? '📈' : htfTrend === 'SELL' ? '📉' : '➡️';

  // Expiry + countdown from best timeframe
  const best = sig.bestTimeframe;
  const expiry = best && best.expiry ? best.expiry.humanReadable : null;
  const countdown = best && best.expiry && best.expiry.countdown
    ? best.expiry.countdown.label : null;

  let msg = `📊 *${pair}* | ${interval}min\n`;
  msg += `━━━━━━━━━━━━━━\n`;

  if (dir === 'BUY' || dir === 'SELL') {
    msg += `${dirEmoji} *${dir}* | ${conf} | *${grade}* ${gradeLabel}\n`;
    if (expiry)    msg += `⏰ Expiry: *${expiry}*\n`;
    if (countdown) msg += `🕐 Candle closes in: *${countdown}*\n`;
    msg += `${htfEmoji} HTF (15min): *${htfTrend}*\n`;
    if (reason)    msg += `\n📝 _${reason}_`;
  } else {
    // NO_TRADE
    msg += `⚪ *NO TRADE*\n`;
    if (filters.length > 0) {
      msg += `🔕 _${filters.join(' · ')}_\n`;
    } else {
      msg += `🔕 _${alignment === 'MIXED' ? 'Timeframes mixed' : 'Setup not clear'}_\n`;
    }
  }

  return msg;
}

// ─── UPDATE HANDLER ───────────────────────────────────────────────────────────

async function handleUpdate(update, env) {
  if (update.message)        await handleMessage(update.message, env);
  else if (update.callback_query) await handleCallback(update.callback_query, env);
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const user   = await getUser(chatId, env);

  if (text.startsWith('/start')) {
    return sendMessage(chatId,
      `👋 *FTT Signal Bot*\n\nReal-time binary trading signals from your FTT Signal Engine.\n\n*Default:* EUR/USD · 5min · Auto OFF\n\nUse the buttons below 👇`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (text.startsWith('/signal')) return doSignal(chatId, env);
  if (text.startsWith('/auto'))   return doToggleAuto(chatId, env);
  if (text.startsWith('/status')) return doStatus(chatId, env);

  if (text.startsWith('/pair ')) {
    const pair = text.slice(6).trim().toUpperCase().replace(/\s/g, '');
    const normalized = pair.length === 6 && !pair.includes('/')
      ? pair.slice(0, 3) + '/' + pair.slice(3) : pair;
    user.pair = normalized;
    await saveUser(chatId, user, env);
    return sendMessage(chatId, `✅ Pair set to *${normalized}*`, env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (text.startsWith('/interval ')) {
    const m = parseInt(text.slice(10).trim());
    if (VALID_INTERVALS.includes(m)) {
      user.interval = m;
      await saveUser(chatId, user, env);
      return sendMessage(chatId, `✅ Interval set to *${m} min*`, env, { reply_markup: mainKeyboard(user.autoEnabled) });
    }
    return sendMessage(chatId, `❌ Valid intervals: 1, 5, 15`, env);
  }

  if (text.startsWith('/help')) {
    return sendMessage(chatId,
      `*Commands*\n\n` +
      `/signal — Get signal now\n` +
      `/auto — Toggle auto scan\n` +
      `/status — View settings\n` +
      `/pair EURUSD — Set pair\n` +
      `/interval 5 — Set interval (1, 5, 15)\n\n` +
      `Or use the inline buttons 👇`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  return sendMessage(chatId, `Use the buttons below 👇`, env, { reply_markup: mainKeyboard(user.autoEnabled) });
}

async function handleCallback(cb, env) {
  const chatId = cb.message.chat.id;
  const msgId  = cb.message.message_id;
  const data   = cb.data;

  await answerCallback(cb.id, '', env);

  const user = await getUser(chatId, env);

  if (data === 'cmd:main') {
    return editMessage(chatId, msgId,
      `🏠 *FTT Signal Bot*\n\n💱 Pair: *${user.pair}* · ⏱ ${user.interval}min · ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data === 'cmd:signal')      return doSignal(chatId, env, msgId);
  if (data === 'cmd:toggle_auto') return doToggleAuto(chatId, env, msgId);
  if (data === 'cmd:status')      return doStatus(chatId, env, msgId);
  if (data === 'cmd:intervals') {
    return editMessage(chatId, msgId,
      `⏱ *Select Scan Interval*\n\nHow often should I fetch signals?`,
      env, { reply_markup: intervalKeyboard() });
  }

  if (data.startsWith('pairpage:')) {
    const page = parseInt(data.split(':')[1]);
    const label = page < 3 ? 'Forex Pairs' : 'Crypto Pairs';
    return editMessage(chatId, msgId,
      `💱 *${label}*\n\nSelect your trading pair:`,
      env, { reply_markup: pairsKeyboard(page) });
  }

  if (data.startsWith('pair:')) {
    const pair = data.slice(5); // everything after "pair:"
    user.pair = pair;
    await saveUser(chatId, user, env);
    return editMessage(chatId, msgId,
      `✅ Pair set to *${pair}*\n\n⏱ Interval: *${user.interval}min* · ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data.startsWith('interval:')) {
    const mins = parseInt(data.split(':')[1]);
    user.interval = mins;
    user.lastSignalAt = 0; // reset so auto fires immediately with new interval
    await saveUser(chatId, user, env);
    return editMessage(chatId, msgId,
      `✅ Interval set to *${mins} min*\n\n💱 Pair: *${user.pair}* · ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }
}

// ─── COMMAND ACTIONS ─────────────────────────────────────────────────────────

async function doSignal(chatId, env, editMsgId = null) {
  const user = await getUser(chatId, env);
  const loadingText = `⏳ Fetching *${user.pair}* signal...`;

  if (editMsgId) await editMessage(chatId, editMsgId, loadingText, env);
  else           await sendMessage(chatId, loadingText, env);

  try {
    const data = await fetchSignal(user.pair);
    const text = formatSignal(data, user.pair, user.interval);
    const keyboard = signalKeyboard(user.autoEnabled);
    if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: keyboard });
    else           await sendMessage(chatId, text, env, { reply_markup: keyboard });
  } catch (e) {
    const err = `❌ Failed to fetch signal: ${e.message}`;
    if (editMsgId) await editMessage(chatId, editMsgId, err, env, { reply_markup: mainKeyboard(user.autoEnabled) });
    else           await sendMessage(chatId, err, env);
  }
}

async function doToggleAuto(chatId, env, editMsgId = null) {
  const user = await getUser(chatId, env);
  user.autoEnabled = !user.autoEnabled;
  user.lastSignalAt = 0;
  user.noTradeStreak = 0;
  await saveUser(chatId, user, env);

  if (user.autoEnabled) await addAutoUser(chatId, env);
  else                  await removeAutoUser(chatId, env);

  const statusText = user.autoEnabled
    ? `🔄 *Auto Scan ON*\n\n💱 Pair: *${user.pair}*\n⏱ Interval: *${user.interval} min*\n\nI'll send you BUY/SELL alerts automatically.`
    : `🔕 *Auto Scan OFF*\n\nUse *Signal Now* to check manually.`;

  if (editMsgId) await editMessage(chatId, editMsgId, statusText, env, { reply_markup: mainKeyboard(user.autoEnabled) });
  else           await sendMessage(chatId, statusText, env, { reply_markup: mainKeyboard(user.autoEnabled) });
}

async function doStatus(chatId, env, editMsgId = null) {
  const user = await getUser(chatId, env);
  const autoStatus = user.autoEnabled ? '✅ ON' : '🔕 OFF';
  const lastSent = user.lastSignalAt
    ? `<!date^${Math.floor(user.lastSignalAt / 1000)}^{date_short_pretty} {time}|${new Date(user.lastSignalAt).toUTCString()}>`
    : 'Never';

  const text = `📋 *Settings*\n\n` +
    `💱 Pair: *${user.pair}*\n` +
    `⏱ Interval: *${user.interval} min*\n` +
    `🔄 Auto Scan: *${autoStatus}*\n` +
    `🕐 Last signal: ${user.lastSignalAt ? new Date(user.lastSignalAt).toUTCString() : 'Never'}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💱 Change Pair', callback_data: 'pairpage:0' },
        { text: '⏱ Change Interval', callback_data: 'cmd:intervals' },
      ],
      [{ text: '🔙 Back', callback_data: 'cmd:main' }],
    ],
  };

  if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: keyboard });
  else           await sendMessage(chatId, text, env, { reply_markup: keyboard });
}

// ─── AUTO SCAN (CRON) ─────────────────────────────────────────────────────────

async function runAutoScan(env) {
  const autoUsers = await getAutoUsers(env);
  if (!autoUsers.length) return;

  const now = Date.now();

  for (const chatId of autoUsers) {
    try {
      const user = await getUser(chatId, env);
      if (!user.autoEnabled) continue;

      const intervalMs = user.interval * 60 * 1000;
      if (now - (user.lastSignalAt || 0) < intervalMs) continue; // not time yet

      const data = await fetchSignal(user.pair);
      const sig = data.signal;
      const dir = sig ? sig.finalSignal : null;

      // Only send for actionable signals
      if (dir === 'BUY' || dir === 'SELL') {
        const text = formatSignal(data, user.pair, user.interval);
        await sendMessage(chatId, text, env, {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔁 Refresh', callback_data: 'cmd:signal' },
              { text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' },
            ]],
          },
        });
        user.noTradeStreak = 0;
      } else {
        // Silently update — no spam for NO_TRADE
        user.noTradeStreak = (user.noTradeStreak || 0) + 1;

        // After 10 consecutive NO_TRADEs, send one "no setup" nudge
        if (user.noTradeStreak === 10) {
          await sendMessage(chatId,
            `📊 *${user.pair}* | ${user.interval}min\n━━━━━━━━━━━━━━\n⚪ Still no clear setup — waiting for a signal.`,
            env, {
              reply_markup: {
                inline_keyboard: [[{ text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' }]],
              },
            });
          user.noTradeStreak = 0;
        }
      }

      user.lastSignalAt = now;
      await saveUser(chatId, user, env);

    } catch (e) {
      console.error(`Auto scan error for chatId ${chatId}:`, e.message);
    }
  }
}
