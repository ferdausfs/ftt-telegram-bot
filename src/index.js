/**
 * FTT Signal Telegram Bot — Cloudflare Worker
 * v1.3 — Fixed: Service Binding replaces HTTP fetch (fixes error 1042)
 *
 * Secrets (Cloudflare Dashboard → Worker → Settings → Variables):
 *   BOT_TOKEN    — Telegram bot token from @BotFather
 *   SETUP_SECRET — Any password to protect /setup endpoint
 *
 * KV Binding  : BOT_KV
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

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(update, env));
      return new Response('OK');
    }

    // Test in browser: /debug?pair=EURUSD
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

    // One-time webhook setup: /setup?secret=YOUR_SETUP_SECRET
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

    return new Response('FTT Signal Bot — OK');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoScan(env));
  },
};

// ─── SIGNAL FETCH — Service Binding (fixes error 1042) ────────────────────────

async function fetchSignal(pair, env) {
  // Use Service Binding if available (worker-to-worker, no HTTP block)
  // Falls back to direct fetch for /debug testing from browser
  const req = new Request(`https://signal/api/signal?pair=${pair}`, {
    headers: { Accept: 'application/json' },
  });

  let res;
  if (env.SIGNAL_WORKER) {
    // Service Binding — direct internal call, no 1042
    res = await env.SIGNAL_WORKER.fetch(req);
  } else {
    // Fallback (should not happen in production)
    res = await fetch(
      `https://my-worker-601.umuhammadiswa.workers.dev/api/signal?pair=${pair}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 400)}`);
  }
  return res.json();
}

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────

function tgApi(env) {
  return `https://api.telegram.org/bot${env.BOT_TOKEN}`;
}

async function tgCall(method, body, env) {
  try {
    const res = await fetch(`${tgApi(env)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`tgCall ${method} ${res.status}:`, err);
    }
  } catch (e) {
    console.error(`tgCall ${method}:`, e.message);
  }
}

function sendMessage(chatId, text, env, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId, text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...extra,
  }, env);
}

function editMessage(chatId, messageId, text, env, extra = {}) {
  return tgCall('editMessageText', {
    chat_id: chatId, message_id: messageId, text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...extra,
  }, env);
}

function answerCallback(id, text, env) {
  return tgCall('answerCallbackQuery', { callback_query_id: id, text: text || '' }, env);
}

// ─── KV: USER DATA ────────────────────────────────────────────────────────────

function defaultUser() {
  return { pair: 'EURUSD', interval: 5, autoEnabled: false, lastSignalAt: 0, noTradeStreak: 0 };
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

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

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
  if (page > 0)                     nav.push({ text: '◀ Prev', callback_data: `pairpage:${page - 1}` });
  if (page < PAIR_PAGES.length - 1) nav.push({ text: 'Next ▶', callback_data: `pairpage:${page + 1}` });
  if (nav.length) keyboard.push(nav);
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

// ─── SIGNAL FORMATTER ─────────────────────────────────────────────────────────

function esc(text) {
  if (!text) return '';
  return String(text).replace(/[_*`[\]]/g, '\\$&');
}

function displayPair(pair) {
  if (!pair.includes('/') && pair.length === 6)
    return pair.slice(0, 3) + '/' + pair.slice(3);
  return pair;
}

function formatSignal(data, pair, interval) {
  const label = displayPair(pair);

  if (data.marketStatus === 'CLOSED') {
    return (
      `📊 *${label}* | ${interval}min\n` +
      `━━━━━━━━━━━━━━\n` +
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
    if (reason)    msg += `\n📝 _${esc(reason)}_`;
  } else {
    msg += `⚪ *NO TRADE*\n`;
    if (filters.length > 0) {
      msg += `🔕 _${esc(filters.join(' · '))}_`;
    } else {
      msg += `🔕 _${align === 'MIXED' ? 'Timeframes mixed' : 'Setup not clear'}_`;
    }
  }

  return msg;
}

// ─── UPDATE HANDLER ───────────────────────────────────────────────────────────

async function handleUpdate(update, env) {
  try {
    if (update.message)             await handleMessage(update.message, env);
    else if (update.callback_query) await handleCallback(update.callback_query, env);
  } catch (e) {
    console.error('handleUpdate:', e.message);
  }
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const user   = await getUser(chatId, env);

  if (text.startsWith('/start')) {
    return sendMessage(chatId,
      `👋 *FTT Signal Bot*\n\nReal-time binary signals from your FTT Signal Engine.\n\n` +
      `💱 Pair: *EUR/USD*  ⏱ *5min*  🔕 Auto OFF\n\nUse the buttons below 👇`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (text.startsWith('/signal'))   return doSignal(chatId, env);
  if (text.startsWith('/auto'))     return doToggleAuto(chatId, env);
  if (text.startsWith('/status'))   return doStatus(chatId, env);

  if (text.startsWith('/pair ')) {
    const raw    = text.slice(6).trim().toUpperCase().replace(/[\s/]/g, '');
    user.pair    = raw;
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
      `*Commands*\n\n/signal — Get signal now\n/auto — Toggle auto scan\n` +
      `/status — View settings\n/pair EURUSD — Set pair\n` +
      `/interval 5 — Set interval (1, 5, 15)\n\nOr use buttons 👇`,
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
      `🏠 *FTT Signal Bot*\n\n💱 *${displayPair(user.pair)}*  ⏱ ${user.interval}min  ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data === 'cmd:signal')      return doSignal(chatId, env, msgId);
  if (data === 'cmd:toggle_auto') return doToggleAuto(chatId, env, msgId);
  if (data === 'cmd:status')      return doStatus(chatId, env, msgId);

  if (data === 'cmd:intervals') {
    return editMessage(chatId, msgId,
      `⏱ *Select Scan Interval*\n\nHow often should I check for signals?`,
      env, { reply_markup: intervalKeyboard() });
  }

  if (data.startsWith('pairpage:')) {
    const page  = parseInt(data.split(':')[1], 10);
    const label = page < 3 ? '🏦 Forex Pairs' : '🪙 Crypto Pairs';
    return editMessage(chatId, msgId,
      `💱 *${label}*\n\nSelect your trading pair:`,
      env, { reply_markup: pairsKeyboard(page) });
  }

  if (data.startsWith('pair:')) {
    const raw    = data.slice(5).replace('/', '');
    user.pair    = raw;
    await saveUser(chatId, user, env);
    return editMessage(chatId, msgId,
      `✅ Pair set to *${displayPair(raw)}*\n\n⏱ Interval: *${user.interval}min*  ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }

  if (data.startsWith('interval:')) {
    const mins        = parseInt(data.split(':')[1], 10);
    user.interval     = mins;
    user.lastSignalAt = 0;
    await saveUser(chatId, user, env);
    return editMessage(chatId, msgId,
      `✅ Interval set to *${mins} min*\n\n💱 *${displayPair(user.pair)}*  ${user.autoEnabled ? '🔄 Auto ON' : '🔕 Auto OFF'}`,
      env, { reply_markup: mainKeyboard(user.autoEnabled) });
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
    const text = formatSignal(data, user.pair, user.interval);
    const kb   = signalKeyboard(user.autoEnabled);
    if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: kb });
    else           await sendMessage(chatId, text, env, { reply_markup: kb });
  } catch (e) {
    console.error('doSignal:', e.message);
    const errText = `❌ *Signal fetch failed*\n\n\`${e.message.slice(0, 300)}\``;
    if (editMsgId) await editMessage(chatId, editMsgId, errText, env, { reply_markup: mainKeyboard(user.autoEnabled) });
    else           await sendMessage(chatId, errText, env, { reply_markup: mainKeyboard(user.autoEnabled) });
  }
}

async function doToggleAuto(chatId, env, editMsgId = null) {
  const user         = await getUser(chatId, env);
  user.autoEnabled   = !user.autoEnabled;
  user.lastSignalAt  = 0;
  user.noTradeStreak = 0;
  await saveUser(chatId, user, env);

  if (user.autoEnabled) await addAutoUser(chatId, env);
  else                  await removeAutoUser(chatId, env);

  const txt = user.autoEnabled
    ? `🔄 *Auto Scan ON*\n\n💱 Pair: *${displayPair(user.pair)}*\n⏱ Interval: *${user.interval} min*\n\nBUY/SELL alerts will be sent automatically.`
    : `🔕 *Auto Scan OFF*\n\nUse *Signal Now* to check manually.`;

  if (editMsgId) await editMessage(chatId, editMsgId, txt, env, { reply_markup: mainKeyboard(user.autoEnabled) });
  else           await sendMessage(chatId, txt, env, { reply_markup: mainKeyboard(user.autoEnabled) });
}

async function doStatus(chatId, env, editMsgId = null) {
  const user       = await getUser(chatId, env);
  const autoStatus = user.autoEnabled ? '✅ ON' : '🔕 OFF';
  const lastSent   = user.lastSignalAt ? new Date(user.lastSignalAt).toUTCString() : 'Never';

  const text = (
    `📋 *Settings*\n\n` +
    `💱 Pair: *${displayPair(user.pair)}*\n` +
    `⏱ Interval: *${user.interval} min*\n` +
    `🔄 Auto Scan: *${autoStatus}*\n` +
    `🕐 Last signal: ${lastSent}`
  );

  const kb = {
    inline_keyboard: [
      [
        { text: '💱 Change Pair',    callback_data: 'pairpage:0'    },
        { text: '⏱ Change Interval', callback_data: 'cmd:intervals' },
      ],
      [{ text: '🔙 Back', callback_data: 'cmd:main' }],
    ],
  };

  if (editMsgId) await editMessage(chatId, editMsgId, text, env, { reply_markup: kb });
  else           await sendMessage(chatId, text, env, { reply_markup: kb });
}

// ─── AUTO SCAN (CRON every 1 min) ────────────────────────────────────────────

async function runAutoScan(env) {
  const autoUsers = await getAutoUsers(env);
  if (!autoUsers.length) return;

  const now = Date.now();

  for (const chatId of autoUsers) {
    try {
      const user = await getUser(chatId, env);
      if (!user.autoEnabled) continue;

      const intervalMs = user.interval * 60 * 1000;
      if (now - (user.lastSignalAt || 0) < intervalMs) continue;

      const data = await fetchSignal(user.pair, env);
      const sig  = data.signal;
      const dir  = sig ? sig.finalSignal : null;

      if (dir === 'BUY' || dir === 'SELL') {
        const text = formatSignal(data, user.pair, user.interval);
        await sendMessage(chatId, text, env, {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔁 Refresh',   callback_data: 'cmd:signal'      },
              { text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' },
            ]],
          },
        });
        user.noTradeStreak = 0;
      } else {
        user.noTradeStreak = (user.noTradeStreak || 0) + 1;
        if (user.noTradeStreak >= 10) {
          await sendMessage(chatId,
            `📊 *${displayPair(user.pair)}* | ${user.interval}min\n━━━━━━━━━━━━━━\n⚪ No clear setup for ${user.noTradeStreak} scans.`,
            env, {
              reply_markup: {
                inline_keyboard: [[
                  { text: '🔕 Stop Auto', callback_data: 'cmd:toggle_auto' },
                ]],
              },
            });
          user.noTradeStreak = 0;
        }
      }

      user.lastSignalAt = now;
      await saveUser(chatId, user, env);

    } catch (e) {
      console.error(`Auto scan [${chatId}]:`, e.message);
    }
  }
}
