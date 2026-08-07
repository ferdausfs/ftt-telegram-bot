/**
 * FTT Signal Telegram Bot — v4.4.1 (ROUND-2 BUGFIX: A+ grade + dual-AI + OTC fillStatus)
 * KV Binding     : BOT_KV
 * Service Binding: SIGNAL_WORKER → asignal.umuhammadiswa.workers.dev
 * Secrets        : BOT_TOKEN, SETUP_SECRET
 *
 * ── v4.4.1 BUGFIXES (this round) ─────────────────────────────────────────────
 *  [B1] passGrade drops A+ for grade-filtered users → now includes A+ in A and AB (mirror worker F3-03)
 *  [B2] passAI dead with dual-combiner shape → now handles {combined,status,combinedAgreed} (mirror worker CHECK-A)
 *  [INT] fmtSignal/doAnalyze AI block now handles dual-combiner so AI badge still shows
 *  [INT] fillStatus/entryDistancePct verified for OTC too (bot already rendered it)
 *
 * ── v4.4 ARENA-STYLE MENU (hub like Arena screenshot) ────────────────────────
 *  [M1] mainKb = clean 2×3 grid (Arena pattern):
 *        📊 Signal Now     👁 Watchlist
 *        🚀 Premium        ⚡ Quick actions
 *        📈 History        ⚙️ Settings
 *  [M2] ⚡ Quick actions → submenu hub (Signal/Auto/Scan + Explore analytics)
 *  [M3] settingsKb unified + Mode prominent; settings2 merged (legacy ok)
 *  [M4] 🚀 Premium placeholder — informational, no payment
 *  [M5] Back/nav: every submenu 🔙 Back → previous (quick→main, settings→main)
 *
 * ── v4.3 RESULT/HISTORY PREMIUM + ENTRY HIT ──────────────────────────────────
 *  [UX4] Result push card is now a leveled premium card:
 *        📌 Signal #12 · 🎯 TP hit · +3min
 *        ✅ WIN — 🟢 EUR/USD [A+ EXCELLENT]
 *        ━━━━━━━━━━━━━━━━━
 *        💰 Entry: 1.08000 → Exit: 1.08550
 *        🎯 Result: WIN +55.0 pips (+0.51%)
 *        ━━━━━━━━━━━━━━━━━
 *        ⚡ Entry hit ✓ — price reached entry
 *  [UX5] Entry hit/miss line: PENDING_ENTRY trades are watched during the
 *        tracking window — if price touches the entry level → "⚡ Entry hit ✓",
 *        otherwise "⚠️ Entry miss — price never reached entry". INSTANT fills
 *        always count as hit. Trades store fillStatus + observed entryHit.
 *  [UX6] fmtHist pending rows show live countdown; daily summary shows grade
 *        breakdown; fmtSignal AI block leveled (AGREE/DISAGREE/UNCERTAIN),
 *        D2 filters as code badges, news warning as a clean 2-line block.
 *
 * ── v4.2 PREMIUM MESSAGE DESIGN ──────────────────────────────────────────────
 *  [UX1] fmtSignal rewritten as a leveled premium card: 19-char ━ separators
 *        between sections, header line (📊 PAIR | TF | mode badge), signal
 *        line (🟢/🔴 DIR + confidence + [GRADE] in one row), Entry/SL/TP +
 *        fill-status block, HTF·Regime·Structure block, 📝 reason block,
 *        AI block, warning block, footer. NO_TRADE / CLOSED states are clean
 *        empty-state cards. All dynamic text is HTML-escaped.
 *  [UX2] Fill status (⚡ INSTANT / ⏳ PENDING) is ALWAYS shown — defaults to
 *        INSTANT when the worker does not send fillStatus.
 *  [UX3] fmtHist aligned columns + separator; result push card premium
 *        (✅/❌ big result + entry/exit/move block); /risk esc'd + separators.
 *
 * ── v4.2 BUG FIXES ───────────────────────────────────────────────────────────
 *  [Bug#1] HTML-escape gaps: doAnalyze + all catch-path error messages sent
 *          raw dynamic content (reason, confluence, ai.concerns, e.message)
 *          with parse_mode:'HTML' → Telegram 400 when worker data contained
 *          < > &. Fixed: esc() everywhere dynamic text is injected.
 *  [Bug#2] disp(null) crashed (legacy v3 history entries with null pair) →
 *          whole /history /stats /best /weekly /journal failed. Fixed:
 *          disp() is null-safe, plus NaN-hour guard in fmtHeatmap.
 *  [Bug#3] Scan All ignored FX mode — fetchSig called without mode param so
 *          FX/BOTH users got no SL/TP levels. Fixed: mode passed through.
 *  [Bug#4] Manual WIN/LOSS + Cancel All left stale expiry reminders (rem:*,
 *          remind_ids) → "⏰ expires in ~30s" fired AFTER resolution. Fixed:
 *          delReminder() called in doManualResult + doCancelAll.
 *  [Bug#5] FX trades tracked with 5min default expiry (no bestTimeframe
 *          expiry in FX payload) → spot trades force-resolved at 5min.
 *          Fixed: FX trades get 60min horizon + SL/TP hit-check in
 *          resultCheck (TP hit → WIN, SL hit → LOSS, else keep tracking).
 *  [Bug#6] fetchSig 20s race covered only the fetch, not res.json() (a slow
 *          body could still hang). Fixed: json() inside the race.
 *
 * CRITICAL FIXES (v4.1 → v4.1-fixed, kept):
 *  [Bug#1] ROOT CAUSE: parse_mode:'MarkdownV2' + esc() was silently breaking
 *          ALL editMsg/sendMsg calls when signal worker data (entryReason,
 *          ai.reason, ai.concerns, newsAlert.title) contained special chars
 *          like ( ) . ! - _ etc. Telegram returned HTTP 400, tg() logged it
 *          but never threw → message never updated → "nothing changes" bug.
 *          FIX: parse_mode is 'HTML' only (3 chars to escape: & < >) and every
 *          dynamic value goes through esc(). No MarkdownV2 anywhere.
 *  [Bug#2] cmd:cancelall was used in Risk Dashboard "🗑 Cancel All" button
 *          but had no handler in onCb → clicking it did nothing silently.
 *          FIX: Added handler that calls doCancelAll(cid, mid, env).
 *  [Bug#3] hasHighImpactNews() in doSignal/doQuickSignal ran sequentially
 *          AFTER fetchSig, blocking signal delivery by up to 6s if the
 *          Forex Factory calendar API was slow. FIX: runs in Promise.all
 *          concurrently with fetchSig, with .catch(() => null) so a calendar
 *          failure never affects signal delivery.
 *
 * BUG FIXES (from v4.0):
 *  [Fix#1] ⏳ Fetching message stuck — restored with mainKb after signal sent
 *  [Fix#2] Feature #15 confidence trend alert — now implemented
 *  [Fix#3] passGrade 'AB' matched empty grade — fixed with ['A','B'].includes(g)
 *  [Fix#4] fetchSig Service Binding had no timeout — added Promise.race + 20s
 *  [Fix#5] noTradeStreak alert had no Menu button — added
 *
 * NEW FEATURES:
 *  [F01] Correlated Trade Warning — warns if a new signal shares currency exposure
 *        with an already-open trade (e.g. EURUSD BUY + GBPUSD BUY both sell USD)
 *  [F02] AI-Only Mode — Settings toggle; only sends signals where AI agrees
 *  [F03] Economic Calendar Filter — blocks/warns during ±15min of High-impact news
 *        (uses nfs.faireconomy.media, cached in KV 1hr). Configurable per user.
 *  [F04] Open Risk Dashboard — /risk or 📉 Risk button; shows all pending trades
 *        with time remaining, entry, and correlated pair warnings
 *  [F05] Hourly Heatmap — /heatmap or 🕐 Heatmap button; shows win rate per UTC hour
 *  [F06] Best Pairs Leaderboard — /best or 🔥 Best button; top 5 pairs by win rate
 *        (min 5 trades). Useful for tuning the watchlist.
 *  [F07] Drawdown Tracker — max consecutive loss streak + peak-to-trough shown in /stats
 *  [F08] Signal Replay — /replay PAIR or 🔄 Replay; fetches signal without logging.
 *        Great for analysis without polluting trade history.
 *  [F09] Custom Alerts — /alerts menu; set per-pair confidence threshold alerts.
 *        Alert fires even if the pair is normally filtered out.
 *  [F10] Telegram Channel Mode — /setchannel <id>; auto-posts signals to a channel
 *        (bot must be admin). /clearchannel to remove.
 */

const PAIR_PAGES = [
  ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'],
  ['USD/CAD','AUD/CAD','GBP/JPY','EUR/GBP','NZD/USD'],
  ['USD/CHF','EUR/JPY','EUR/AUD','AUD/JPY'],
  ['BTC/USD','ETH/USD','SOL/USD','BNB/USD'],
  ['XRP/USD','ADA/USD','DOGE/USD','AVAX/USD'],
];
const MAX_WL       = 6;
const MAX_HIST     = 100;
const MILESTONE    = 50;
const MAX_ERRORS   = 3;
const NEWS_WINDOW  = 15; // ±minutes around high-impact news
const CRYPTO       = ['BTC','ETH','BNB','XRP','SOL','ADA','DOGE','AVAX','DOT','LINK'];
const QUOTEX_URL   = 'https://quotex.com/trade';
const CAL_URL      = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

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
    return new Response('FTT Signal Bot v4.4.1');
  },

  async scheduled(e, env, ctx) {
    // Worker push (Phase 10) now handles all auto signal delivery + result push.
    // Bot cron only handles: result tracking (for bot analytics), reminders, summaries.
    ctx.waitUntil(cronLite(env));
  },
};

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────

const TG   = env  => `https://api.telegram.org/bot${env.BOT_TOKEN}`;
const post = body => ({ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
const json = ()   => ({ headers: { 'Content-Type': 'application/json' } });

// [Bug#1 FIX] No MarkdownV2 anywhere — parse_mode is 'HTML' (only 3 chars
// to escape: & < >). All dynamic content passes through esc() so special
// chars in worker data (entryReason, ai.reason, ai.concerns, newsAlert.title)
// can never produce a Telegram 400 again.

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

// HTML escape for dynamic content (safe with parse_mode:'HTML' — only 3 chars)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Premium card separator (19 chars — consistent across all cards)
const SEP = '━━━━━━━━━━━━━━━━━';

const sendMsg = (cid, text, env, extra = {}) =>
  tg('sendMessage', { chat_id: cid, text: String(text || ''), disable_web_page_preview: true, parse_mode: 'HTML', ...extra }, env);

const editMsg = (cid, mid, text, env, extra = {}) =>
  tg('editMessageText', { chat_id: cid, message_id: mid, text: String(text || ''), disable_web_page_preview: true, parse_mode: 'HTML', ...extra }, env);

const answerCb = (id, env, text = '') =>
  tg('answerCallbackQuery', { callback_query_id: id, text }, env);

// Delete a message silently (ignore errors — e.g. already deleted or too old)
const deleteMsg = (cid, mid, env) =>
  tg('deleteMessage', { chat_id: cid, message_id: mid }, env).catch(() => null);

const reply = (cid, mid, text, env, kboard) => {
  const extra = kboard ? { reply_markup: kboard } : {};
  return mid ? editMsg(cid, mid, text, env, extra) : sendMsg(cid, text, env, extra);
};

// ─── KV HELPERS ───────────────────────────────────────────────────────────────

const kget = async (k, env) => { try { return await env.BOT_KV.get(k, 'json'); } catch { return null; } };
const kput = async (k, v, env, opts = {}) => { try { await env.BOT_KV.put(k, JSON.stringify(v), opts); } catch (e) { console.error('kput', k, e.message); } };
const kdel = async (k, env) => { try { await env.BOT_KV.delete(k); } catch {} };

// ─── ANALYTICS KV HELPERS ─────────────────────────────────────────────────────

async function getRegimeStats(cid, env) {
  const d = await kget(`rs:${cid}`, env);
  return d || { TRENDING:{w:0,l:0}, RANGING:{w:0,l:0}, BREAKOUT:{w:0,l:0}, VOLATILE:{w:0,l:0} };
}
async function updateRegimeStats(cid, regime, result, env) {
  if (!regime || (result !== 'WIN' && result !== 'LOSS')) return;
  const s = await getRegimeStats(cid, env);
  if (!s[regime]) s[regime] = { w:0, l:0 };
  result === 'WIN' ? s[regime].w++ : s[regime].l++;
  await kput(`rs:${cid}`, s, env);
}

async function getSessionStats(cid, env) {
  const d = await kget(`ss:${cid}`, env);
  return d || {};
}
async function updateSessionStats(cid, sessionKey, result, env) {
  if (!sessionKey || (result !== 'WIN' && result !== 'LOSS')) return;
  const s = await getSessionStats(cid, env);
  if (!s[sessionKey]) s[sessionKey] = { w:0, l:0 };
  result === 'WIN' ? s[sessionKey].w++ : s[sessionKey].l++;
  await kput(`ss:${cid}`, s, env);
}

async function getRisk(cid, env) { return (await kget(`risk:${cid}`, env)) || { streak: 0, type: null }; }
async function updateRisk(cid, result, env) {
  const r = await getRisk(cid, env);
  if (result === 'LOSS') {
    r.streak = r.type === 'LOSS' ? r.streak + 1 : 1; r.type = 'LOSS';
  } else if (result === 'WIN') {
    r.streak = r.type === 'WIN' ? r.streak + 1 : 1; r.type = 'WIN';
  } else {
    r.streak = 0; r.type = null;
  }
  await kput(`risk:${cid}`, r, env, { expirationTtl: 86400 });
  return r;
}

// [Fix#2] Feature #15: Confidence Trend Tracking
async function getConfTrend(cid, env) { return (await kget(`ct:${cid}`, env)) || []; }
async function updateConfTrend(cid, confStr, env) {
  const val = parseInt((confStr || '0%').replace('%', ''), 10);
  if (isNaN(val)) return { alert: false };
  const arr = await getConfTrend(cid, env);
  arr.unshift(val);
  const trimmed = arr.slice(0, 5);
  await kput(`ct:${cid}`, trimmed, env, { expirationTtl: 86400 });
  if (trimmed.length >= 3 && trimmed[0] < trimmed[1] && trimmed[1] < trimmed[2])
    return { alert: true, vals: trimmed.slice(0, 3) };
  return { alert: false };
}

// [F09] Custom Alerts KV
async function getAlerts(cid, env) { return (await kget(`alerts:${cid}`, env)) || {}; }
async function setAlert(cid, pair, minConf, env) {
  const a = await getAlerts(cid, env);
  a[norm(pair)] = minConf;
  await kput(`alerts:${cid}`, a, env);
}
async function delAlert(cid, pair, env) {
  const a = await getAlerts(cid, env);
  delete a[norm(pair)];
  await kput(`alerts:${cid}`, a, env);
}

// ─── [F03] ECONOMIC CALENDAR ──────────────────────────────────────────────────

async function getEconCalendar(env) {
  try {
    const cached = await kget('econ_cal', env);
    if (cached && cached.ts > Date.now() - 3600000) return cached.events || [];
    const r = await fetch(CAL_URL, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const events = await r.json();
    await kput('econ_cal', { ts: Date.now(), events }, env, { expirationTtl: 3600 });
    return events;
  } catch { return []; }
}

// Returns { title, currency, minsAway } or null
async function hasHighImpactNews(env, windowMin = NEWS_WINDOW) {
  try {
    const events = await getEconCalendar(env);
    const now = Date.now();
    const win = windowMin * 60 * 1000;
    for (const ev of events) {
      if (ev.impact !== 'High') continue;
      const evTime = new Date(ev.date).getTime();
      if (isNaN(evTime)) continue;
      const diff = evTime - now;
      if (Math.abs(diff) <= win) {
        const minsAway = Math.round(diff / 60000);
        return { title: ev.title, currency: ev.country || ev.currency || '?', minsAway };
      }
    }
    return null;
  } catch { return null; }
}

// ─── [F01] CORRELATED TRADE HELPERS ───────────────────────────────────────────

// [Bug#2 FIX] norm(null) → null.replace() → TypeError THROW.
// Old history entries from v3.x may have null/undefined pair.
// Now returns {} on bad input so callers never throw.
function getCurrencyExposure(pair, direction) {
  if (!pair || !direction) return {};
  try {
    const p = String(pair).replace('/', '').toUpperCase();
    if (!p || p.length < 6) return {};
    if (CRYPTO.some(c => p.startsWith(c))) {
      return { _CRYPTO: direction === 'BUY' ? 'long' : 'short' };
    }
    const base  = p.slice(0, 3);
    const quote = p.slice(3, 6);
    return direction === 'BUY'
      ? { [base]: 'long', [quote]: 'short' }
      : { [base]: 'short', [quote]: 'long' };
  } catch { return {}; }
}

// Returns array of warning strings for correlated open trades
async function checkCorrelated(cid, newPair, newDir, env) {
  try {
    const h       = await getHist(cid, env);
    // [Bug#2 FIX] filter out entries with null/undefined pair
    const pending = h.filter(x => !x.result && x.direction && x.pair && norm(x.pair) !== norm(newPair));
    const newExp  = getCurrencyExposure(newPair, newDir);
    const warnings = [];
    for (const t of pending) {
      const exp = getCurrencyExposure(t.pair, t.direction);
      for (const [currency, side] of Object.entries(newExp)) {
        if (exp[currency] === side) {
          warnings.push(`${disp(t.pair)} ${t.direction} (${currency === '_CRYPTO' ? 'crypto' : currency})`);
          break;
        }
      }
    }
    return warnings;
  } catch { return []; }
}

// ─── EXPIRY REMINDERS ─────────────────────────────────────────────────────────

async function getPendingReminders(env) { return (await kget('remind_ids', env)) || []; }
async function addReminder(rem, env) {
  await kput(`rem:${rem.tradeId}`, rem, env, { expirationTtl: 3600 });
  const ids = await getPendingReminders(env);
  if (!ids.includes(rem.tradeId)) await kput('remind_ids', [...ids, rem.tradeId], env);
}
async function delReminder(tid, env) {
  await kdel(`rem:${tid}`, env);
  const ids = await getPendingReminders(env);
  await kput('remind_ids', ids.filter(x => x !== tid), env);
}

// ─── USER ─────────────────────────────────────────────────────────────────────

const normFxMode = (v) => (v === 'fx' || v === 'both' ? v : 'ftt');   // legacy true→ftt, false→ftt

const DEF_USER = () => ({
  pair: 'EURUSD', watchlist: [], interval: 5, autoEnabled: false,
  noTradeStreak: 0, gradeFilter: 'ALL', minConfidence: 0,
  dailySummary: false, summaryHour: 20,
  // [v4.1] new fields
  aiOnlyMode: false,   // [F02] only send when AI agrees
  blockNews: true,     // [F03] skip auto signals during news window
  channelId: null,     // [F10] channel to mirror signals to
  fxMode: 'ftt',        // [FX] 'ftt' | 'fx' | 'both' — signal output mode
});

async function getUser(cid, env) {
  const d = await kget(`u:${cid}`, env);
  return d ? { ...DEF_USER(), ...d } : DEF_USER();
}
const saveUser = (cid, u, env) => kput(`u:${cid}`, u, env);

async function getAutoUsers(env) { return (await kget('auto_users', env)) || []; }
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
    if (result === 'WIN' || result === 'LOSS') {
      const trade = h[i];
      if (trade.regime)     await updateRegimeStats(cid, trade.regime, result, env);
      if (trade.sessionKey) await updateSessionStats(cid, trade.sessionKey, result, env);
    }
  }
}

// ─── PENDING TRADES ───────────────────────────────────────────────────────────

const getPendingIds  = async env => (await kget('pending_ids', env)) || [];
const savePendingIds = (ids, env) => kput('pending_ids', ids, env);
async function addPending(trade, env) {
  await kput(`pt:${trade.tradeId}`, trade, env, { expirationTtl: 7200 });
  const ids = await getPendingIds(env);
  if (!ids.includes(trade.tradeId)) await kput('pending_ids', [...ids, trade.tradeId], env);
}

// ─── LOCKS ────────────────────────────────────────────────────────────────────

const getLock   = (cid, pair, env) => kget(`lock:${cid}:${pair}`, env);
const clearLock = (cid, pair, env) => kdel(`lock:${cid}:${pair}`, env);
async function setLock(cid, pair, dir, expiryAt, env) {
  const ttl = Math.max(60, Math.ceil((expiryAt - Date.now()) / 1000) + 120);
  await kput(`lock:${cid}:${pair}`, { direction: dir, expiryAt }, env, { expirationTtl: ttl });
}

// ─── LOG & SCHEDULE ───────────────────────────────────────────────────────────

async function logAndSchedule(cid, pair, sig, env) {
  const dir        = sig.finalSignal;
  // [Bug#5 FIX] FX trades have no fixed expiry (hold until SL/TP) — use a
  // 60min tracking horizon and resolve by SL/TP hit in resultCheck.
  // FTT trades keep the candle-based expiry.
  const isFx       = sig.mode === 'fx';
  const expMins    = isFx ? 60 : (sig.bestTimeframe?.expiry?.totalMinutes || 5);
  const expAt      = Date.now() + expMins * 60 * 1000;
  const entry      = sig.recommendations?.['1min']?.entry?.price || sig.recommendations?.['5min']?.entry?.price || null;
  const sl         = isFx ? (sig.fxLevels?.sl ?? null) : null;
  const tp         = isFx ? (sig.fxLevels?.tp ?? null) : null;
  const grade      = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const tid        = uid();
  const regime     = sig.marketRegime || 'UNKNOWN';
  const session    = sig.session || {};
  const sessionKey = session.overlap && session.overlap !== 'NONE'
    ? session.overlap : (session.sessions && session.sessions[0]) || 'UNKNOWN';

  const no = await addHist(cid, {
    id: tid, pair, direction: dir, confidence: sig.confidence || '0%', grade,
    entryPrice: entry, expiryMinutes: expMins, expiryAt: expAt, sl, tp,
    fillStatus: sig.fillStatus || 'INSTANT',
    timestamp: new Date().toISOString(), result: null, regime, sessionKey,
  }, env);

  await addPending({ chatId: String(cid), tradeId: tid, pair, direction: dir, entryPrice: entry, expiryAt: expAt, signalNo: no, grade, regime, sessionKey, sl, tp, fillStatus: sig.fillStatus || 'INSTANT' }, env);

  // FX: no "expires in ~30s" reminder — the trade stays open until SL/TP
  if (!isFx) {
    const remAt = expAt - 30000;
    if (remAt > Date.now())
      await addReminder({ tradeId: tid, chatId: String(cid), pair, direction: dir, signalNo: no, remAt }, env);
  }

  await setLock(cid, pair, dir, expAt, env);
  return no;
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────

// [Fix#3] 'AB'.includes('') was true — fixed with ['A','B'].includes(g)
// BUG-B1 (High) FIX v4.4.1 — mirror worker F3-03: include A+ in A and AB filters
const passGrade = (sig, f) => {
  if (!f || f === 'ALL') return true;
  const g = sig.grade?.grade || '';
  if (!g) return false;
  return f === 'A' ? ['A+', 'A'].includes(g) : f === 'AB' ? ['A+', 'A', 'B'].includes(g) : true;
};
const passConf = (sig, min) => {
  if (!min) return true;
  return parseInt((sig.confidence || '0%').replace('%', ''), 10) >= min;
};
// [F02] AI-Only filter
// BUG-B2 (High) FIX v4.4.1 — mirror worker CHECK-A/Bug-006: dual-combiner shape
// worker standard-engine now returns { cerebras, groq, combined, combinedAgreed, agrees }
// with NO top-level status; OTC still returns { status, agrees }.
const passAI = (sig, aiOnly) => {
  if (!aiOnly) return true;
  const v = sig?.aiValidation;
  if (!v) return false;
  const status = v.status || (v.combined && v.combined.status);
  const agreed = v.agrees !== undefined ? v.agrees : v.combinedAgreed;
  return status === 'OK' && agreed === true;
};

// ─── CANDLE HELPERS ───────────────────────────────────────────────────────────

function nextCandleIn(intervalMin) {
  const ms   = intervalMin * 60 * 1000;
  const next = (Math.floor(Date.now() / ms) + 1) * ms;
  const diff = next - Date.now();
  return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
}

function msToHuman(ms) {
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

const kb  = rows => ({ inline_keyboard: rows });
const btn = (text, cb) => ({ text, callback_data: cb });

const signalKb = (no = null) => {
  const rows = [[{ text: '📈 Trade on Quotex', url: QUOTEX_URL }]];
  if (no) rows.push([btn(`✅ WIN #${no}`, `res:win:${no}`), btn(`❌ LOSS #${no}`, `res:loss:${no}`)]);
  rows.push([btn('🔁 New Signal', 'cmd:signal'), btn('📈 History', 'cmd:history:0'), btn('🔙 Menu', 'cmd:main')]);
  return kb(rows);
};

const channelKb = () => kb([[{ text: '📈 Trade on Quotex', url: QUOTEX_URL }]]);

const afterKb = () => kb([
  [btn('🔁 New Signal', 'cmd:signal'), btn('📈 History', 'cmd:history:0'), btn('🔙 Menu', 'cmd:main')],
]);

// Arena hub (matches Arena screenshot layout — clean 2-col category grid):
//   📊 Signal Now     👁 Watchlist      ← "New chat" / "Photo Styles" slots
//   🚀 Premium        ⚡ Quick actions  ← Premium / Quick actions
//   📈 History        ⚙️ Settings       ← Chat history / Settings
const mainKb = u => kb([
  [btn('📊 Signal Now', 'cmd:signal'),    btn('👁 Watchlist', 'cmd:watchlist')],
  [btn('🚀 Premium',    'cmd:premium'),   btn('⚡ Quick actions', 'cmd:quick')],
  [btn('📈 History',    'cmd:history:0'), btn('⚙️ Settings', 'cmd:settings')],
]);

// ⚡ Quick actions submenu — primary actions + explore analytics
const quickKb = u => kb([
  [btn('📊 Signal Now', 'cmd:signal'), btn(u.autoEnabled ? '🔕 Stop Auto' : '🔄 Start Auto', 'cmd:toggle_auto')],
  [btn('🔍 Scan All',   'cmd:scanall'), btn('📋 Status', 'cmd:status')],
  [btn('📅 Today', 'cmd:today'), btn('📊 Weekly', 'cmd:weekly'), btn('🔥 Best', 'cmd:best')],
  [btn('📉 Risk',  'cmd:risk'),  btn('🕐 Heatmap', 'cmd:heatmap'), btn('📒 Journal', 'cmd:journal')],
  [btn('🏆 Stats', 'cmd:stats'), btn('📋 Summary', 'cmd:summary')],
  [btn('🔙 Back', 'cmd:main')],
]);

// Unified Arena-style settings: Signal · Auto · Data (mode prominent on top)
const settingsKb = u => {
  const modeLbl = u.fxMode === 'fx' ? 'FX ✅' : u.fxMode === 'both' ? 'BOTH 🔄' : 'FTT';
  return kb([
    // ── Signal ──────────────────────────────────────────────────────────────
    [btn(`💹 Mode: ${modeLbl}`, 'cmd:fxmode')],
    [btn(`🎯 Grade: ${u.gradeFilter || 'ALL'}`, 'cmd:gradefilter'), btn(`📊 Conf: ${u.minConfidence || 0}%+`, 'cmd:conffilter')],
    [btn(`⏱ Interval: ${u.interval}min`, 'cmd:intervals'), btn(`💱 Pair: ${disp(u.pair)}`, 'pairpage:0')],
    // ── Auto ────────────────────────────────────────────────────────────────
    [btn(`🤖 AI Only: ${u.aiOnlyMode ? 'ON ✅' : 'OFF'}`, 'cmd:aionly'), btn(`📰 News Block: ${u.blockNews !== false ? 'ON ✅' : 'OFF'}`, 'cmd:blocknews')],
    [btn('🔔 Alerts', 'cmd:alerts'), btn('🔁 Replay', 'cmd:replayhelp')],
    [btn(`📅 Summary: ${u.dailySummary ? 'ON' : 'OFF'}`, 'cmd:togglesummary'), btn(`🕐 ${u.summaryHour ?? 20}:00 UTC`, 'cmd:summarytime')],
    // ── Data ────────────────────────────────────────────────────────────────
    [btn(`📡 Channel: ${u.channelId ? '✅ Set' : 'None'}`, 'cmd:channelinfo'), btn('⬇ Export', 'cmd:exportinfo')],
    [btn('🔙 Back', 'cmd:main')],
  ]);
};

// Legacy alias — settings2 merged into unified settingsKb (cmd:settings2 still routes here)
const settings2Kb = settingsKb;

// Premium placeholder keyboard
const premiumKb = () => kb([
  [btn('📣 Channel Info', 'cmd:channelinfo')],
  [btn('🔙 Back', 'cmd:main')],
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

// [F09] Alert keyboards
const alertsKb = (alerts) => {
  const rows = Object.entries(alerts).map(([pair, conf]) => [
    btn(`🔔 ${disp(pair)} ≥${conf}%`, `alertpair:${pair}:0`),
    btn('🗑', `alertdel:${pair}:0`),
  ]);
  rows.push([btn('➕ Add/Edit Alert', 'alertpage:0')]);
  rows.push([btn('🔙 Back', 'cmd:settings'), btn('🏠 Menu', 'cmd:main')]);
  return kb(rows);
};

const alertPairsKb = (page, alerts) => {
  page = Math.max(0, Math.min(page, PAIR_PAGES.length - 1));
  const rows = chunk(PAIR_PAGES[page], 2).map(row =>
    row.map(p => {
      const code = norm(p);
      const has  = alerts[code];
      return btn(has ? `🔔 ${p} (${has}%)` : p, `alertpair:${code}:${page}`);
    })
  );
  const nav = [];
  if (page > 0)                     nav.push(btn('◀ Prev', `alertpage:${page - 1}`));
  if (page < PAIR_PAGES.length - 1) nav.push(btn('Next ▶', `alertpage:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('🔙 Back', 'cmd:alerts')]);
  return kb(rows);
};

const alertConfKb = (pair, page) => kb([
  [btn('65%', `alertset:${pair}:65:${page}`), btn('70%', `alertset:${pair}:70:${page}`), btn('75%', `alertset:${pair}:75:${page}`)],
  [btn('80%', `alertset:${pair}:80:${page}`), btn('85%', `alertset:${pair}:85:${page}`), btn('90%', `alertset:${pair}:90:${page}`)],
  [btn('◀ Back', `alertpage:${page}`)],
]);

const intervalKb  = () => kb([
  [btn('⚡ 1min', 'interval:1'), btn('📊 5min', 'interval:5'), btn('🕐 15min', 'interval:15')],
  [btn('🔙 Back', 'cmd:settings')],
]);
const gradeKb     = () => kb([
  [btn('🌐 All', 'gf:ALL'), btn('⭐ A+B', 'gf:AB'), btn('🏆 A only', 'gf:A')],
  [btn('🔙 Back', 'cmd:settings')],
]);
const confKb      = () => kb([
  [btn('Any', 'cf:0'), btn('60%+', 'cf:60'), btn('70%+', 'cf:70')],
  [btn('75%+', 'cf:75'), btn('80%+', 'cf:80'), btn('85%+', 'cf:85')],
  [btn('🔙 Back', 'cmd:settings')],
]);
const summTimeKb  = () => kb([
  [btn('06:00', 'sumhour:6'), btn('12:00', 'sumhour:12'), btn('18:00', 'sumhour:18')],
  [btn('20:00', 'sumhour:20'), btn('22:00', 'sumhour:22'), btn('00:00', 'sumhour:0')],
  [btn('🔙 Back', 'cmd:settings')],
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

// Shared back-row for screens opened from Quick actions
const backQuick = () => [btn('🔙 Back', 'cmd:quick'), btn('🏠 Menu', 'cmd:main')];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// [Bug#2 FIX] disp(null) used to throw (v3 legacy history can hold null pair),
// which crashed /history /stats /best /weekly /journal. Now null-safe.
const disp  = p  => (p ? ((!p.includes('/') && p.length === 6) ? p.slice(0,3) + '/' + p.slice(3) : p) : '?');
const norm  = p  => String(p ?? '').replace('/', '');
const uid   = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const isCr  = p  => CRYPTO.some(b => String(p || '').startsWith(b));
const chunk = (arr, n) => arr.reduce((r, x, i) => (i % n === 0 ? r.push([x]) : r[r.length-1].push(x), r), []);
const fmtPrice = (price, pair) => {
  const v = parseFloat(price);
  if (isNaN(v)) return '?';
  return isCr(pair) ? v.toFixed(2) : v.toFixed(5);
};
const modeLabel = m => m === 'fx' ? 'FX' : m === 'both' ? 'BOTH' : 'FTT';

// Arena hub card (status + 6-button grid below)
function fmtMainMenu(u, cnt, wr, resolvedN) {
  return `FTT Signal Bot v4.4.1\n${SEP}\n` +
    `💱 ${esc(disp(u.pair))} · ${u.interval}min · ${modeLabel(u.fxMode)}\n` +
    `🔄 Auto: ${u.autoEnabled ? 'ON ✅' : 'OFF'}  👁 Watchlist: ${u.watchlist.length} pairs\n` +
    `🎯 Grade: ${esc(u.gradeFilter || 'ALL')}  🤖 AI Only: ${u.aiOnlyMode ? 'ON' : 'OFF'}\n` +
    `📰 News Block: ${u.blockNews !== false ? 'ON' : 'OFF'}\n` +
    `${SEP}\n` +
    `📊 Signals: ${cnt}  📈 Win Rate: ${wr}% (${resolvedN} resolved)\n` +
    `${SEP}\n` +
    `💡 <i>Tap a button below</i>`;
}

// Quick actions hub card
function fmtQuickMenu(u) {
  return `⚡ Quick actions\n${SEP}\n` +
    `💱 ${esc(disp(u.pair))} · ${u.interval}min · ${modeLabel(u.fxMode)}\n` +
    `🔄 Auto: <b>${u.autoEnabled ? 'ON ✅' : 'OFF'}</b>\n` +
    `${SEP}\n` +
    `<b>Primary</b> — Signal · Auto · Scan · Status\n` +
    `<b>Explore</b> — Today · Weekly · Best · Risk · Heatmap · Journal · Stats`;
}

// Arena-style grouped settings card (Mode prominent)
function fmtSettings(u) {
  const mode = u.fxMode === 'fx'
    ? 'FX ✅ — Entry/SL/TP (spot)'
    : u.fxMode === 'both'
      ? 'BOTH 🔄 — SL/TP + expiry'
      : 'FTT — fixed-time';
  return `⚙️ Settings\n${SEP}\n` +
    `<b>Signal</b>\n` +
    `💹 Mode: <b>${mode}</b>\n` +
    `<i>Tap Mode to cycle: FTT → FX → BOTH</i>\n` +
    `🎯 Grade: <b>${esc(u.gradeFilter || 'ALL')}</b>  📊 Conf: <b>${u.minConfidence || 0}%+</b>\n` +
    `⏱ Interval: <b>${u.interval}min</b>  💱 Pair: <b>${esc(disp(u.pair))}</b>\n` +
    `${SEP}\n` +
    `<b>Auto</b>\n` +
    `🤖 AI Only: <b>${u.aiOnlyMode ? 'ON ✅' : 'OFF'}</b>\n` +
    `📰 News Block: <b>${u.blockNews !== false ? 'ON ✅' : 'OFF'}</b>\n` +
    `📅 Summary: <b>${u.dailySummary ? `ON (${u.summaryHour ?? 20}:00 UTC)` : 'OFF'}</b>\n` +
    `${SEP}\n` +
    `<b>Data</b>\n` +
    `📡 Channel: <b>${u.channelId ? esc(String(u.channelId)) : 'None'}</b>\n` +
    `⬇ Export: use /export via admin endpoint`;
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

function fmtSignal(data, pair, interval, no, opts = {}) {
  const sig = data.signal;
  const m   = normMode(opts.mode);
  const tf  = (sig?.bestTimeframe?.timeframe) || `${interval || 5}min`;
  const modeBadge = m === 'both' ? '🔄 <b>BOTH</b>' : (m === 'fx' || sig?.mode === 'fx') ? '💹 <b>FX</b>' : '⏱ <b>FTT</b>';
  const header = `📊 <b>${esc(disp(pair))}</b> | ${esc(tf)} | ${modeBadge}`;

  // ── Empty states (clean, not dingy) ──────────────────────────────────────
  if (data.marketStatus === 'CLOSED')
    return `${header}\n${SEP}\n🔴 <b>Forex Market CLOSED</b>\n💡 Try <b>BTC/USD</b> (24/7)`;
  if (!sig)
    return `${header}\n${SEP}\n⚪ <b>No signal data</b>\n💡 Try again at the next candle close.`;

  const dir    = sig.finalSignal || 'NO_TRADE';
  const conf   = sig.confidence  || '0%';
  const grade  = sig.grade ? `${sig.grade.grade} ${sig.grade.label}` : '';
  const htf    = sig.higherTFTrend || 'NEUTRAL';
  const reason = sig.entryReason   || '';
  const best   = sig.bestTimeframe;
  const expiry = best?.expiry?.humanReadable || null;
  const cd     = best?.expiry?.countdown?.label || null;
  const price  = sig.recommendations?.['1min']?.entry?.price
              || sig.recommendations?.['5min']?.entry?.price
              || sig.recommendations?.['15min']?.entry?.price || null;
  const dE = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
  const hE = htf === 'BUY' ? '📈' : htf === 'SELL' ? '📉' : '➡️';
  const regimeE = { TRENDING:'🔵', RANGING:'🟡', BREAKOUT:'🟠', VOLATILE:'🔴' };

  let msg = '';
  if (opts.replay) msg += `🔄 <i>REPLAY — not logged</i>\n`;
  if (no)          msg += `📌 Signal No. <b>${no}</b>\n`;
  msg += header + '\n' + SEP + '\n';

  if (dir === 'BUY' || dir === 'SELL') {
    // ── Signal line: direction + confidence + grade in one row ─────────────
    const confNum = parseInt(String(conf).replace('%', '')) || 0;
    const confDot = confNum >= 85 ? '🟢' : confNum >= 70 ? '🟡' : '🔴';
    msg += `${dE} <b>${dir}</b> ${confDot} ${esc(conf)}${grade ? `  [${esc(grade)}]` : ''}\n`;
    msg += SEP + '\n';

    // ── Levels block: Entry + SL/TP (FX/BOTH) or Expiry (FTT) + fill status ─
    if (price) msg += `💰 Entry: <code>${esc(fmtPrice(price, pair))}</code>\n`;
    const hasFx = sig.mode === 'fx' && sig.fxLevels && sig.fxLevels.sl && sig.fxLevels.tp;
    if (hasFx) {
      msg += `🛑 SL: <code>${esc(fmtPrice(sig.fxLevels.sl, pair))}</code>\n`;
      msg += `🎯 TP: <code>${esc(fmtPrice(sig.fxLevels.tp, pair))}</code>  (1:${esc(sig.fxLevels.rr || '2.5')})\n`;
    }
    if (m !== 'fx') {
      if (expiry) msg += `⏰ Expiry: <b>${esc(expiry)}</b>\n`;
      if (cd)     msg += `🕐 Candle closes: <code>${esc(cd)}</code>\n`;
    }
    // [UX2] Fill status ALWAYS shown — default INSTANT when worker omits it
    const fill = sig.fillStatus || 'INSTANT';
    if (fill === 'PENDING_ENTRY' || fill === 'PENDING') {
      const dist = sig.entryDistancePct != null ? ` (${esc(String(sig.entryDistancePct))}%)` : '';
      msg += `⏳ <b>PENDING</b> — price away from entry${dist}, wait for fill\n`;
    } else {
      msg += `⚡ <b>INSTANT</b> — take now\n`;
    }
    if (m === 'fx' && !hasFx)
      msg += `💹 <i>FX mode — worker sent no SL/TP levels yet</i>\n`;
    msg += SEP + '\n';

    // ── Context block: HTF · Regime · Structure ────────────────────────────
    const regime = sig.marketRegime;
    let ctx = `${hE} HTF: <b>${esc(htf)}</b>`;
    if (regime) ctx += ` · ${regimeE[regime] || '⚪'} Regime: <b>${esc(regime)}</b>`;
    msg += ctx + '\n';

    const sv = sig.structureVerdict;
    if (sv && sv.overall && sv.overall !== 'N/A') {
      const sE = sv.overall === 'ALIGNED' ? '✅' : sv.overall === 'AGAINST' ? '⚠️' : sv.overall === 'MIXED' ? '🔀' : '➡️';
      let s = `${sE} Structure: <b>${esc(sv.overall)}</b>`;
      if (sv.direction && sv.direction !== 'NEUTRAL')
        s += ` (${esc(sv.direction)}${sv.strength ? ' ' + esc(sv.strength) : ''})`;
      msg += s + '\n';
    }
    if (sig.regimeAdvice) msg += `💡 <i>${esc(sig.regimeAdvice)}</i>\n`;
    msg += SEP + '\n';

    // ── Reason block ───────────────────────────────────────────────────────
    if (reason) msg += `📝 <i>${esc(reason)}</i>\n`;

    // ── AI block (compact, leveled status) ─────────────────────────────────
    // v4.4.1 INTEGRATION FIX: worker now returns dual-combiner { cerebras, groq, combined, combinedAgreed, agrees }
    // for standard engine, and { status, agrees } for OTC. Extract from combined fallback so AI block still shows.
    const aiRaw = sig.aiValidation;
    if (aiRaw) {
      const aiStatus = aiRaw.status || (aiRaw.combined && aiRaw.combined.status);
      if (aiStatus === 'OK') {
        const aiAgrees = aiRaw.agrees !== undefined ? aiRaw.agrees : aiRaw.combinedAgreed;
        const aiSignal = aiRaw.signal || (aiRaw.combined && aiRaw.combined.signal);
        const aiConf   = aiRaw.confidence ?? (aiRaw.combined && aiRaw.combined.confidence);
        const aiReason = aiRaw.reason || (aiRaw.combined && aiRaw.combined.reason);
        const aiConcerns = aiRaw.concerns || (aiRaw.combined && aiRaw.combined.concerns);
        const st = aiAgrees === true
          ? '✅ <b>AGREE</b>'
          : (aiAgrees === false && aiSignal !== 'NO_TRADE')
            ? '⚠️ <b>DISAGREE</b>'
            : '🤔 <b>UNCERTAIN</b>';
        const aiSig = (aiAgrees === true || (aiAgrees === false && aiSignal !== 'NO_TRADE'))
          ? `<b>${esc(aiSignal)}</b>` : '<b>NO_TRADE</b>';
        msg += `🤖 AI: ${st} — ${aiSig} (${esc(aiConf)}%)\n`;
        if (aiReason)   msg += `💬 <i>${esc(aiReason)}</i>\n`;
        if (aiConcerns) msg += `🔍 <i>${esc(aiConcerns)}</i>\n`;
      }
    }

    // ── Blocked filters (D2 transparency, badge style) ─────────────────────
    const filters = sig.filtersApplied || [];
    const d2 = filters.filter(f => f.includes('D2_') || f.includes('BLOCK'));
    if (d2.length) msg += `🚫 <b>Blocked:</b> ${d2.map(f => `<code>${esc(f)}</code>`).join(' ')}\n`;

    // v4.4.1: use aiRaw for sep check (dual-combiner)
    const aiForSep = aiRaw ? (aiRaw.status || (aiRaw.combined && aiRaw.combined.status)) : null;
    if (reason || aiForSep === 'OK') msg += SEP + '\n';

    // ── Warnings block (news / correlation) ────────────────────────────────
    if (opts.newsAlert) {
      const n = Math.abs(opts.newsAlert.minsAway);
      const when = opts.newsAlert.minsAway >= 0 ? `in ${n}min` : `${n}min ago`;
      msg += `⚠️ <b>High-impact news ${when}</b>\n📰 ${esc(opts.newsAlert.title)} (${esc(opts.newsAlert.currency)})\n`;
    }
    if (opts.correlated && opts.correlated.length) {
      msg += `⚠️ <b>Correlated open:</b> ${esc(opts.correlated.join(', '))}\n`;
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    msg += opts.replay
      ? `🔄 <i>Replay only — result not tracked</i>`
      : `⏳ <i>Result tracked automatically</i>`;
  } else {
    // ── NO_TRADE empty state (clean, informative) ─────────────────────────
    const filters = sig.filtersApplied || [];
    msg += `⚪ <b>NO TRADE</b>\n`;
    msg += filters.length
      ? `🔕 <b>Filters:</b> ${filters.map(f => `<code>${esc(f)}</code>`).join(' ')}\n`
      : `🔕 <i>${sig.alignment === 'MIXED' ? 'Timeframes mixed — no clear setup' : 'Setup not clear yet'}</i>\n`;
    msg += `💡 Next check at the next ${esc(tf)} candle close`;
  }
  return msg;
}

function fmtHist(hist, page = 0) {
  const per = 10, slice = hist.slice(page * per, page * per + per);
  if (!hist.length) return `📈 History\n${SEP}\nNo signals yet.\n\n💡 Tap 📊 Signal Now to get your first signal.`;
  if (!slice.length) return `📈 History\n${SEP}\nNo more signals on this page.`;
  let msg = `📈 History (${page * per + 1}-${page * per + slice.length} of ${hist.length})\n${SEP}\n`;
  for (const h of slice) {
    const dE = h.direction === 'BUY' ? '🟢' : '🔴';
    const rE = h.result === 'WIN' ? '✅' : h.result === 'LOSS' ? '❌' : h.result === 'SKIP' ? '⏭' : h.result === 'CANCEL' ? '🗑' : '⏳';
    const g  = h.grade  ? ` [${esc(h.grade.split(' ')[0])}]` : '';
    const p  = h.pips != null ? ` ${h.pips > 0 ? '+' : ''}${h.pips}` : '';
    // [UX3] pending rows show live countdown instead of the timestamp
    const timeStr = (!h.result && h.expiryAt)
      ? `⏳ ${msToHuman(h.expiryAt - Date.now())} left`
      : new Date(h.timestamp).toUTCString().slice(5, 17);
    msg += `${rE} #${String(h.no || '?').padStart(3)} ${dE} ${disp(h.pair).padEnd(8)} ${esc(h.confidence || '').padStart(4)}${g}${p.padStart(6)}  ${timeStr}\n`;
  }
  return msg;
}

// [F07] Drawdown calculation
function calcDrawdown(resolved) {
  let balance = 0, peak = 0, maxDd = 0, curLoss = 0, maxLoss = 0;
  for (const h of [...resolved].reverse()) {
    if (h.result === 'WIN') { balance++; curLoss = 0; }
    else                    { balance--; curLoss++; }
    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDd)   maxDd   = dd;
    if (curLoss > maxLoss) maxLoss = curLoss;
  }
  return { maxDd, maxLoss };
}

function fmtStats(hist, regimeStats, sessionStats) {
  const trades   = hist.filter(h => h.direction === 'BUY' || h.direction === 'SELL');
  const resolved = trades.filter(h => h.result === 'WIN' || h.result === 'LOSS');
  const wins     = resolved.filter(h => h.result === 'WIN').length;
  const losses   = resolved.length - wins;
  const wr       = resolved.length > 0 ? Math.round(wins / resolved.length * 100) : 0;
  const pending  = trades.filter(h => !h.result).length;
  let streak = 0, sT = '';
  for (const h of resolved) {
    if (!sT)               { sT = h.result; streak = 1; }
    else if (h.result === sT) streak++;
    else break;
  }

  // [F07] Drawdown
  const { maxDd, maxLoss } = calcDrawdown(resolved);

  let msg = `🏆 Win/Loss Stats\n${SEP}\n`;
  msg += `✅ Wins: ${wins}  ❌ Losses: ${losses}\n`;
  msg += `📊 Win Rate: ${wr}% (${resolved.length} trades)\n`;
  msg += `⏳ Pending: ${pending}`;
  if (streak >= 2) msg += `\n🔥 Streak: ${streak} ${sT}s`;
  if (maxLoss > 0) msg += `\n📉 Max Losing Streak: ${maxLoss}  Max Drawdown: ${maxDd} trades`;

  if (regimeStats) {
    const regimes = Object.entries(regimeStats).filter(([, s]) => s.w + s.l > 0);
    if (regimes.length) {
      msg += `\n\n📊 By Regime:\n`;
      const rE = { TRENDING:'🔵', RANGING:'🟡', BREAKOUT:'🟠', VOLATILE:'🔴' };
      for (const [r, s] of regimes) {
        const t = s.w + s.l;
        const pct = Math.round(s.w / t * 100);
        msg += `  ${rE[r]||'⚪'} ${r}: ${s.w}W/${s.l}L (${pct}%) ${pct>=55?'✅':pct>=45?'⚠️':'❌'}\n`;
      }
    }
  }
  if (sessionStats) {
    const sessions = Object.entries(sessionStats).filter(([, s]) => s.w + s.l > 0);
    if (sessions.length) {
      msg += `\n⏰ By Session:\n`;
      for (const [s, v] of sessions) {
        const t = v.w + v.l;
        const pct = Math.round(v.w / t * 100);
        msg += `  ${s}: ${v.w}W/${v.l}L (${pct}%) ${pct>=55?'✅':pct>=45?'⚠️':'❌'}\n`;
      }
    }
  }
  const pm = {}, gm = {};
  for (const h of resolved) {
    if (!pm[h.pair]) pm[h.pair] = { w:0, l:0 };
    h.result === 'WIN' ? pm[h.pair].w++ : pm[h.pair].l++;
    const g = (h.grade || '?').split(' ')[0];
    if (!gm[g]) gm[g] = { w:0, l:0 };
    h.result === 'WIN' ? gm[g].w++ : gm[g].l++;
  }
  if (Object.keys(gm).length) {
    msg += `\nGrade:\n`;
    for (const [g, s] of Object.entries(gm)) {
      const t = s.w + s.l;
      msg += `  ${esc(g)}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`;
    }
  }
  if (Object.keys(pm).length) {
    msg += `\nTop Pairs:\n`;
    Object.entries(pm).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l)).slice(0,5)
      .forEach(([p,s]) => { const t=s.w+s.l; msg += `  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`; });
  }
  return msg;
}

function fmtJournal(hist, date) {
  const today = date || new Date().toISOString().slice(0, 10);
  const th = hist.filter(x => x.timestamp?.startsWith(today));
  if (!th.length) return `📒 Journal — ${today}\n${SEP}\nNo signals today.`;
  const res  = th.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const wins = res.filter(x => x.result === 'WIN').length;
  const wr   = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
  let msg = `📒 Trade Journal — ${today}\n${SEP}\n`;
  msg += `📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L  📈 ${wr}%\n\n`;
  for (const x of th.slice(0, 10)) {
    const dE = x.direction === 'BUY' ? '🟢' : '🔴';
    const rE = x.result === 'WIN' ? '✅' : x.result === 'LOSS' ? '❌' : x.result === 'CANCEL' ? '🗑' : '⏳';
    const rg = x.regime ? ` [${esc(x.regime.slice(0,3))}]` : '';
    const sk = x.sessionKey ? ` ${esc(x.sessionKey.replace('_','-'))}` : '';
    msg += `${rE} #${x.no} ${dE} ${disp(x.pair)} ${esc(x.confidence || '')}${rg}${sk}\n`;
  }
  if (th.length > 10) msg += `...+${th.length - 10} more\n`;
  const regToday = {};
  for (const x of res) {
    if (!x.regime) continue;
    if (!regToday[x.regime]) regToday[x.regime] = { w:0, l:0 };
    x.result === 'WIN' ? regToday[x.regime].w++ : regToday[x.regime].l++;
  }
  if (Object.keys(regToday).length) {
    msg += `\nToday's Regimes:\n`;
    const rE = { TRENDING:'🔵', RANGING:'🟡', BREAKOUT:'🟠', VOLATILE:'🔴' };
    for (const [r, s] of Object.entries(regToday)) {
      const t = s.w + s.l;
      msg += `  ${rE[r]||'⚪'} ${r}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`;
    }
  }
  return msg;
}

function fmtWeekly(hist, weekLabel) {
  const now = new Date();
  const day = now.getUTCDay(), diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - diff);
  const weekStart = mon.toISOString().slice(0, 10);
  const label = weekLabel || `Week of ${weekStart}`;
  const wh  = hist.filter(x => x.timestamp >= weekStart);
  const res = wh.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const wins = res.filter(x => x.result === 'WIN').length;
  const wr = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
  let msg = `📅 Weekly Report — ${label}\n${SEP}\n`;
  msg += `📊 ${wh.length} signals  ✅ ${wins}W ❌ ${res.length-wins}L\n📈 Win Rate: ${wr}%\n`;
  const rm = {};
  for (const x of res) {
    if (!x.regime) continue;
    if (!rm[x.regime]) rm[x.regime] = { w:0, l:0 };
    x.result === 'WIN' ? rm[x.regime].w++ : rm[x.regime].l++;
  }
  if (Object.keys(rm).length) {
    const sorted = Object.entries(rm).map(([r,s])=>{ const t=s.w+s.l; return { r, w:s.w, l:s.l, pct:t>0?Math.round(s.w/t*100):0 }; }).sort((a,b)=>b.pct-a.pct);
    const rIcon = { TRENDING:'🔵', RANGING:'🟡', BREAKOUT:'🟠', VOLATILE:'🔴' };
    msg += `\nRegimes this week:\n`;
    for (const x of sorted) {
      const t = x.w + x.l;
      msg += `  ${rIcon[x.r]||'⚪'} ${x.r}: ${x.w}W/${x.l}L (${x.pct}%) ${x.pct>=55?'✅':x.pct>=45?'⚠️':'❌'}\n`;
    }
    if (sorted.length) {
      msg += `\n💡 Best: ${sorted[0].r} (${sorted[0].pct}%)\n`;
      if (sorted[sorted.length-1].pct < 45) msg += `⚠️ Avoid: ${sorted[sorted.length-1].r} (${sorted[sorted.length-1].pct}%)\n`;
    }
  }
  const pm = {};
  for (const x of res) {
    if (!pm[x.pair]) pm[x.pair] = { w:0, l:0 };
    x.result === 'WIN' ? pm[x.pair].w++ : pm[x.pair].l++;
  }
  const topPairs = Object.entries(pm).map(([p,s])=>{ const t=s.w+s.l; return { p,w:s.w,l:s.l,pct:t>0?Math.round(s.w/t*100):0 }; }).sort((a,b)=>b.pct-a.pct).slice(0,3);
  if (topPairs.length) {
    msg += `\nTop Pairs:\n`;
    for (const x of topPairs) msg += `  ${disp(x.p)}: ${x.w}W/${x.l}L (${x.pct}%)\n`;
  }
  msg += `\n🔄 Keep trading the best regimes next week!`;
  return msg;
}

// [F04] Risk Dashboard
function fmtRisk(hist) {
  // [Bug#2 FIX] filter out entries with null pair to avoid getCurrencyExposure crash
  const pending = hist.filter(x => !x.result && (x.direction === 'BUY' || x.direction === 'SELL') && x.pair);
  if (!pending.length) return `📉 Open Risk Dashboard\n${SEP}\nNo open trades — nice and clean. ✅`;
  const now = Date.now();
  let msg = `📉 Open Risk Dashboard\n${SEP}\n${pending.length} open trade(s)\n`;
  const exposure = {};
  for (const t of pending) {
    const exp = getCurrencyExposure(t.pair, t.direction);
    for (const [cur, side] of Object.entries(exp)) {
      if (!exposure[cur]) exposure[cur] = { long:0, short:0 };
      exposure[cur][side]++;
    }
  }
  for (const t of pending) {
    const dE      = t.direction === 'BUY' ? '🟢' : '🔴';
    const g       = t.grade ? ` [${esc(t.grade.split(' ')[0])}]` : '';
    const rem     = t.expiryAt ? msToHuman(t.expiryAt - now) : '?';
    const expired = t.expiryAt && t.expiryAt < now;
    msg += `${dE} #${t.no} ${t.direction} ${disp(t.pair)}${g} ${esc(t.confidence || '')}\n`;
    msg += `   Entry: ${t.entryPrice ? fmtPrice(t.entryPrice, t.pair) : '?'}  ${expired ? '⏳ Result pending' : `⏱ ${rem} left`}\n`;
  }
  const multi = Object.entries(exposure).filter(([, v]) => (v.long + v.short) > 1 && v.long > 0 && v.short === 0);
  if (multi.length) msg += `\nConcentrated exposure: ${multi.map(([c,v]) => `${c} x${v.long}`).join(', ')}`;
  return msg;
}

// [F05] Hourly Heatmap
function fmtHeatmap(hist) {
  const resolved = hist.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  if (!resolved.length) return `🕐 Hourly Heatmap\n${SEP}\nNo resolved trades yet.`;
  const hmap = {};
  for (const h of resolved) {
    // [Bug#2 FIX] skip entries with invalid timestamps (legacy data)
    const ts = new Date(h.timestamp).getTime();
    if (isNaN(ts)) continue;
    const hour = new Date(ts).getUTCHours();
    if (!hmap[hour]) hmap[hour] = { w:0, l:0 };
    h.result === 'WIN' ? hmap[hour].w++ : hmap[hour].l++;
  }
  const entries = Object.entries(hmap).map(([hr, s]) => {
    const t = s.w + s.l;
    return { hr: parseInt(hr), w:s.w, l:s.l, t, pct: Math.round(s.w/t*100) };
  }).sort((a,b) => a.hr - b.hr);

  let msg = `🕐 Win Rate by Hour (UTC)\n${SEP}\n`;
  for (const e of entries) {
    const bar   = '█'.repeat(Math.round(e.pct / 10)) + '░'.repeat(10 - Math.round(e.pct / 10));
    const icon  = e.pct >= 60 ? '✅' : e.pct >= 45 ? '⚠️' : '❌';
    const label = String(e.hr).padStart(2,'0') + ':00';
    msg += `${label}  ${bar}  ${e.pct}%  (${e.w}W/${e.l}L) ${icon}\n`;
  }
  const best  = [...entries].sort((a,b)=>b.pct-a.pct)[0];
  const worst = [...entries].sort((a,b)=>a.pct-b.pct)[0];
  if (best)  msg += `\n🏆 Best:  ${String(best.hr).padStart(2,'0')}:00 UTC (${best.pct}%)`;
  if (worst) msg += `\n⚠️ Worst: ${String(worst.hr).padStart(2,'0')}:00 UTC (${worst.pct}%)`;
  return msg;
}

// [F06] Best Pairs Leaderboard
function fmtBest(hist) {
  const resolved = hist.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  if (!resolved.length) return `🔥 Best Pairs\n${SEP}\nNo resolved trades yet.`;
  const pm = {};
  for (const h of resolved) {
    if (!h.pair) continue;
    if (!pm[h.pair]) pm[h.pair] = { w:0, l:0 };
    h.result === 'WIN' ? pm[h.pair].w++ : pm[h.pair].l++;
  }
  const ranked = Object.entries(pm)
    .map(([p,s]) => { const t=s.w+s.l; return { p, w:s.w, l:s.l, t, pct: Math.round(s.w/t*100) }; })
    .filter(x => x.t >= 3)
    .sort((a,b) => b.pct - a.pct || b.t - a.t);

  if (!ranked.length) return `🔥 Best Pairs\n${SEP}\nNeed at least 3 trades per pair.`;

  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  let msg = `🔥 Best Pairs Leaderboard\n${SEP}\n`;
  ranked.slice(0, 7).forEach((x, i) => {
    const bar  = '█'.repeat(Math.round(x.pct/10)) + '░'.repeat(10-Math.round(x.pct/10));
    const icon = x.pct >= 60 ? '✅' : x.pct >= 45 ? '⚠️' : '❌';
    msg += `${medals[i]||'  '} ${disp(x.p).padEnd(8)} ${bar} ${x.pct}% (${x.w}W/${x.l}L) ${icon}\n`;
  });
  if (ranked.length > 7) msg += `...+${ranked.length - 7} more pairs\n`;
  msg += `\n💡 Tip: Add top pairs to your Watchlist for auto scanning`;
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

  if (text.startsWith('/start'))     return R(`👋 <b>Welcome to FTT Signal Bot</b>\n\n📊 <b>Professional Trading Signals</b>\n🤖 AI-validated · Multi-timeframe · Real-time\n\n${SEP}\n💱 Pair: <b>${esc(disp(u.pair))}</b> · ${u.interval}min\n💹 Mode: <b>${modeLabel(u.fxMode)}</b>\n🔄 Auto: <b>${u.autoEnabled ? 'ON ✅' : 'OFF'}</b>\n🎯 Grade: <b>${esc(u.gradeFilter || 'ALL')}</b> · Conf: <b>${u.minConfidence || 0}%+</b>\n${SEP}\n\n📊 <b>Signal Now</b> — instant signal\n⚡ <b>Quick actions</b> — Auto · Scan · Explore\n📈 <b>History</b> · ⚙️ <b>Settings</b> · 🚀 <b>Premium</b>\n\n💡 <i>Tap a button below</i>`, mainKb(u));
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
  if (text.startsWith('/journal'))   return doJournal(cid, null, env);
  if (text.startsWith('/weekly'))    return doWeekly(cid, null, env);
  if (text.startsWith('/analyze'))   return doAnalyze(cid, null, text.slice(8).trim() || null, env);
  if (text.startsWith('/risk'))      return doRisk(cid, null, env);
  if (text.startsWith('/heatmap'))   return doHeatmap(cid, null, env);
  if (text.startsWith('/best'))      return doBest(cid, null, env);
  if (text.startsWith('/alerts'))    return doAlerts(cid, null, env);
  if (text.startsWith('/replay'))    return doReplay(cid, null, text.slice(7).trim() || null, env);

  // [F10] Channel commands
  if (text.startsWith('/setchannel ')) {
    const chanId = text.slice(12).trim();
    if (!chanId) return R('❌ Usage: /setchannel @channelname  or  /setchannel -100123456789', mainKb(u));
    u.channelId = chanId;
    await saveUser(cid, u, env);
    return R(`✅ Channel set to ${chanId}\n\nMake sure the bot is an admin of that channel.`, mainKb(u));
  }
  if (text.startsWith('/clearchannel')) {
    u.channelId = null;
    await saveUser(cid, u, env);
    return R('✅ Channel removed.', mainKb(u));
  }

  // Manual WIN/LOSS
  if (text.startsWith('/win ') || text.startsWith('/loss ')) {
    const parts  = text.split(' ');
    const result = text.startsWith('/win') ? 'WIN' : 'LOSS';
    const no     = parseInt(parts[1], 10);
    if (isNaN(no)) return R(`❌ Usage: /win 5  or  /loss 5`, mainKb(u));
    return doManualResult(cid, null, no, result, env);
  }
  if (text.startsWith('/pair ')) {
    const raw = text.slice(6).trim().toUpperCase().replace(/[\s/]/g, '');
    u.pair = raw; await saveUser(cid, u, env);
    return R(`✅ Pair set to ${disp(raw)}`, mainKb(u));
  }
  if (text.startsWith('/interval ')) {
    const m = parseInt(text.slice(10).trim(), 10);
    if ([1,5,15].includes(m)) { u.interval = m; await saveUser(cid, u, env); return R(`✅ Interval: ${m}min`, mainKb(u)); }
    return R('❌ Use: 1, 5, or 15', mainKb(u));
  }
  if (text.startsWith('/help'))
    return R(`<b>FTT Signal Bot — Commands</b>\n\n📊 <b>Core:</b>\n/signal — get signal\n/scan — scan all pairs\n/auto — toggle auto scan\n\n📈 <b>Analytics:</b>\n/history — trade history\n/stats — win rate stats\n/today — today's performance\n/summary — daily summary\n/best — best pairs leaderboard\n/risk — risk dashboard\n/heatmap — win rate by hour\n\n⚙️ <b>Settings:</b>\n/pair EURUSD — set pair\n/interval 5 — set interval\n/watchlist — manage watchlist\n/alerts — custom pair alerts\n/replay EURUSD — analyze without logging\n/setchannel — mirror to channel\n/cancelall — cancel pending\n/win <no> /loss <no> — manual override\n\n💡 <i>Just type a pair name to scan instantly</i>`, mainKb(u));

  // Auto pair detect
  const rawPair = text.toUpperCase().replace(/[\s\/\-_.]/g, '');
  if (rawPair.length >= 6) {
    const allPairs = PAIR_PAGES.flat().map(p => norm(p));
    const matched  = allPairs.find(p => p === rawPair);
    const fuzzy    = matched || allPairs.find(p => rawPair.startsWith(p.slice(0,3)) && rawPair.endsWith(p.slice(3)));
    if (fuzzy) return doQuickSignal(cid, null, fuzzy, env);
  }
  return R('Use the buttons below 👇', mainKb(u));
}

// ─── CALLBACK HANDLER ─────────────────────────────────────────────────────────

async function onCb(cb, env) {
  const cid  = cb.message.chat.id;
  const mid  = cb.message.message_id;
  const data = cb.data;
  await answerCb(cb.id, env, '');
  const u = await getUser(cid, env);

  // [Bug#1 FIX] Global try/catch: every button handler is now wrapped.
  // Previously, if doRisk/doBest/doHeatmap/doAlerts threw (e.g. from a
  // null pair in history), dispatch() caught it silently. User saw
  // "button does nothing". Now they always get an error message + working menu.
  try {
    await _handleCb(cid, mid, data, u, env);
  } catch (e) {
    console.error('onCb [' + data + ']:', e.message);
    try {
      await editMsg(cid, mid, `⚠️ Error: ${esc(e.message.slice(0, 100))}\n\nTap menu to continue.`, env, { reply_markup: mainKb(u) });
    } catch {
      await sendMsg(cid, `⚠️ Something went wrong. Use /start to reset.`, env, { reply_markup: mainKb(u) });
    }
  }
}

async function _handleCb(cid, mid, data, u, env) {
  const R = (text, kboard) => reply(cid, mid, text, env, kboard);

  if (data === 'cmd:main') {
    const h   = await getHist(cid, env);
    const res = h.filter(x => x.result === 'WIN' || x.result === 'LOSS');
    const wr  = res.length > 0 ? Math.round(res.filter(x => x.result === 'WIN').length / res.length * 100) : 0;
    const cnt = await getCounter(cid, env);
    return R(fmtMainMenu(u, cnt, wr, res.length), mainKb(u));
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
  if (data === 'cmd:settings2')   return doSettings(cid, mid, env); // legacy → unified settings
  if (data === 'cmd:quick')       return doQuick(cid, mid, env);
  if (data === 'cmd:journal')     return doJournal(cid, mid, env);
  if (data === 'cmd:weekly')      return doWeekly(cid, mid, env);
  if (data === 'cmd:risk')        return doRisk(cid, mid, env);
  if (data === 'cmd:heatmap')     return doHeatmap(cid, mid, env);
  if (data === 'cmd:best')        return doBest(cid, mid, env);
  if (data === 'cmd:alerts')      return doAlerts(cid, mid, env);
  if (data === 'cmd:premium')     return doPremium(cid, mid, env);
  if (data === 'cmd:exportinfo')  return doExportInfo(cid, mid, env);
  if (data === 'cmd:replayhelp')  return R(`🔄 Signal Replay\n${SEP}\nType <code>/replay EURUSD</code> to get a live signal without logging it.\n\nGreat for analysis before committing to a trade.`, settingsKb(u));
  if (data.startsWith('cmd:history:')) return doHist(cid, mid, parseInt(data.split(':')[2]) || 0, env);

  // Settings
  if (data === 'cmd:intervals')     return R('⏱ Select Interval:', intervalKb());
  if (data === 'cmd:gradefilter')   return R('🎯 Grade Filter:', gradeKb());
  if (data === 'cmd:conffilter')    return R('📊 Min Confidence:', confKb());
  if (data === 'cmd:summarytime')   return R('🕐 Daily Summary Time (UTC):', summTimeKb());
  if (data === 'cmd:togglesummary') {
    u.dailySummary = !u.dailySummary;
    await saveUser(cid, u, env);
    if (u.dailySummary) await addSummaryUser(cid, env);
    else                await removeSummaryUser(cid, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  if (data === 'cmd:aionly') {
    u.aiOnlyMode = !u.aiOnlyMode;
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  if (data === 'cmd:blocknews') {
    u.blockNews = !(u.blockNews !== false);
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  if (data === 'cmd:fxmode') {
    const cycle = { ftt: 'fx', fx: 'both', both: 'ftt' };
    u.fxMode = cycle[normMode(u.fxMode)] || 'ftt';
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  // [F10] Channel info
  if (data === 'cmd:channelinfo') {
    const chanInfo = u.channelId
      ? `📡 Channel Mode\n${SEP}\nChannel: <code>${esc(u.channelId)}</code>\n\nSignals are auto-posted there.\n\nTo change: /setchannel &lt;id&gt;\nTo remove: /clearchannel`
      : `📡 Channel Mode\n${SEP}\nNo channel set.\n\nTo enable:\n1. Add bot as admin to your channel\n2. Send /setchannel @yourchannel\n   or /setchannel -100123456789`;
    return R(chanInfo, settingsKb(u));
  }

  // [Bug#3 FIX] All settings changes now use the locally-updated `u` directly
  // instead of calling doSettings(cid, mid, env) which re-reads from KV and
  // may return stale data (eventual consistency), making it look like the
  // change didn't take effect.

  if (data.startsWith('interval:')) {
    u.interval = parseInt(data.split(':')[1], 10);
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  if (data.startsWith('sumhour:')) {
    u.summaryHour = parseInt(data.split(':')[1], 10);
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  if (data.startsWith('gf:')) {
    u.gradeFilter = data.slice(3);
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }
  if (data.startsWith('cf:')) {
    u.minConfidence = parseInt(data.split(':')[1], 10);
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }

  if (data.startsWith('pairpage:')) return R('💱 Select default pair:', pairsKb(parseInt(data.split(':')[1], 10)));
  if (data.startsWith('pair:')) {
    u.pair = norm(data.slice(5));
    await saveUser(cid, u, env);
    return R(fmtSettings(u), settingsKb(u));
  }

  if (data.startsWith('wlpage:'))   return R(`👁 Add to Watchlist (${u.watchlist.length}/${MAX_WL}):`, wlAddKb(parseInt(data.split(':')[1], 10), u.watchlist));
  if (data.startsWith('wl:rm:'))    { u.watchlist = u.watchlist.filter(p => p !== data.slice(6)); await saveUser(cid, u, env); return doWatchlist(cid, mid, env); }
  if (data.startsWith('wl:addpage:')) {
    const parts = data.split(':'), pair = parts[2], page = parseInt(parts[3]||'0', 10);
    if (!u.watchlist.includes(pair) && u.watchlist.length < MAX_WL) { u.watchlist = [...u.watchlist, pair]; await saveUser(cid, u, env); }
    return R(`👁 Add to Watchlist (${u.watchlist.length}/${MAX_WL}):`, wlAddKb(page, u.watchlist));
  }
  if (data.startsWith('wl:rmpage:')) {
    const parts = data.split(':'), pair = parts[2], page = parseInt(parts[3]||'0', 10);
    u.watchlist = u.watchlist.filter(p => p !== pair); await saveUser(cid, u, env);
    return R(`👁 Add to Watchlist (${u.watchlist.length}/${MAX_WL}):`, wlAddKb(page, u.watchlist));
  }

  // [F09] Alert callbacks
  if (data.startsWith('alertpage:')) {
    const page    = parseInt(data.split(':')[1], 10);
    const alerts  = await getAlerts(cid, env);
    return R(`🔔 Select pair for alert:`, alertPairsKb(page, alerts));
  }
  if (data.startsWith('alertpair:')) {
    const parts = data.split(':'), pair = parts[1], page = parseInt(parts[2]||'0', 10);
    return R(`🔔 Alert for ${disp(pair)}\nSet min confidence threshold:`, alertConfKb(pair, page));
  }
  if (data.startsWith('alertset:')) {
    const parts = data.split(':'), pair = parts[1], conf = parseInt(parts[2], 10), page = parseInt(parts[3]||'0', 10);
    await setAlert(cid, pair, conf, env);
    const alerts = await getAlerts(cid, env);
    return R(`✅ Alert set: ${disp(pair)} ≥${conf}%\n\nYou'll be notified when this pair hits ${conf}%+ confidence.`, alertPairsKb(page, alerts));
  }
  if (data.startsWith('alertdel:')) {
    const parts = data.split(':'), pair = parts[1], page = parseInt(parts[2]||'0', 10);
    await delAlert(cid, pair, env);
    const alerts = await getAlerts(cid, env);
    return R(`🗑 Alert removed for ${disp(pair)}`, alertPairsKb(page, alerts));
  }

  // [Bug#2 FIX] cmd:cancelall was used in Risk Dashboard button but had no handler
  if (data === 'cmd:cancelall')   return doCancelAll(cid, mid, env);

  if (data.startsWith('qs:')) return doQuickSignal(cid, mid, data.slice(3), env);
  if (data.startsWith('res:win:'))  return doManualResult(cid, mid, parseInt(data.split(':')[2], 10), 'WIN', env);
  if (data.startsWith('res:loss:')) return doManualResult(cid, mid, parseInt(data.split(':')[2], 10), 'LOSS', env);
}

// ─── ACTION FUNCTIONS ─────────────────────────────────────────────────────────

// Shared helper: restore original message with main menu after sending a signal card
async function restoreMainMsg(cid, mid, u, env) {
  if (!mid) return;
  const h   = await getHist(cid, env);
  const res = h.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const wr  = res.length > 0 ? Math.round(res.filter(x => x.result === 'WIN').length / res.length * 100) : 0;
  const cnt = await getCounter(cid, env);
  await editMsg(cid, mid, fmtMainMenu(u, cnt, wr, res.length), env, { reply_markup: mainKb(u) });
}

async function doSignal(cid, mid, env) {
  const u = await getUser(cid, env);
  let loadingMid = mid;
  if (mid) {
    await editMsg(cid, mid, `⏳ Fetching ${disp(u.pair)}...`, env, {});
  } else {
    // Text command: send loading msg, capture its id so we can delete it later
    const r = await sendMsg(cid, `⏳ Fetching ${disp(u.pair)}...`, env, {});
    try { const j = await r?.json(); loadingMid = j?.result?.message_id || null; } catch {}
  }
  try {
    const [data, newsAlert] = await Promise.all([
      fetchSig(u.pair, env, { mode: normMode(u.fxMode) }),
      hasHighImpactNews(env).catch(() => null),
    ]);
    const sig = data.signal;
    const dir = sig?.finalSignal;
    let no = null, corrWarnings = [];
    if (dir === 'BUY' || dir === 'SELL') {
      corrWarnings = await checkCorrelated(cid, u.pair, dir, env);
      no = await logAndSchedule(cid, u.pair, sig, env);
    }
    const useKb  = (dir === 'BUY' || dir === 'SELL') ? signalKb(no) : afterKb();
    await sendMsg(cid, fmtSignal(data, u.pair, u.interval, no, { newsAlert, correlated: corrWarnings, mode: normMode(u.fxMode) }), env, { reply_markup: useKb });
    // Restore button message (button flow) or delete loading msg (text command flow)
    if (mid) {
      await restoreMainMsg(cid, mid, u, env);
    } else if (loadingMid) {
      await deleteMsg(cid, loadingMid, env);
    }
    if ((dir === 'BUY' || dir === 'SELL') && sig?.confidence) {
      const ct = await updateConfTrend(cid, sig.confidence, env);
      if (ct.alert)
        await sendMsg(cid, `📉 Confidence Dropping — last 3: ${ct.vals[2]}% → ${ct.vals[1]}% → ${ct.vals[0]}%\n\nConsider waiting for a stronger setup.`, env, { reply_markup: kb([[btn('🏆 Stats', 'cmd:stats'), btn('🔙 Menu', 'cmd:main')]]) });
    }
  } catch (e) {
    // [Bug#1 FIX] esc() the error text — worker HTTP errors may contain < > &
    const err = `❌ Signal fetch failed\n\n${SEP}\n⚠️ ${esc(e.message.slice(0, 150))}\n${SEP}\n\n💡 Try again in a few seconds.`;
    if (mid) await editMsg(cid, mid, err, env, { reply_markup: mainKb(u) });
    else {
      if (loadingMid) await deleteMsg(cid, loadingMid, env);
      await sendMsg(cid, err, env, { reply_markup: mainKb(u) });
    }
  }
}

async function doQuickSignal(cid, mid, pair, env) {
  const u = await getUser(cid, env);
  let loadingMid = mid;
  if (mid) {
    await editMsg(cid, mid, `⏳ Fetching ${disp(pair)}...`, env, {});
  } else {
    const r = await sendMsg(cid, `⏳ Fetching ${disp(pair)}...`, env, {});
    try { const j = await r?.json(); loadingMid = j?.result?.message_id || null; } catch {}
  }
  try {
    const [data, newsAlert] = await Promise.all([
      fetchSig(pair, env, { mode: normMode(u.fxMode) }),
      hasHighImpactNews(env).catch(() => null),
    ]);
    const sig = data.signal;
    const dir = sig?.finalSignal;
    let no = null, corrWarnings = [];
    if (dir === 'BUY' || dir === 'SELL') {
      corrWarnings = await checkCorrelated(cid, pair, dir, env);
      no = await logAndSchedule(cid, pair, sig, env);
    }
    const useKb  = (dir === 'BUY' || dir === 'SELL') ? signalKb(no) : afterKb();
    await sendMsg(cid, fmtSignal(data, pair, u.interval, no, { newsAlert, correlated: corrWarnings, mode: normMode(u.fxMode) }), env, { reply_markup: useKb });
    if (mid) {
      await restoreMainMsg(cid, mid, u, env);
    } else if (loadingMid) {
      await deleteMsg(cid, loadingMid, env);
    }
    if ((dir === 'BUY' || dir === 'SELL') && sig?.confidence) {
      const ct = await updateConfTrend(cid, sig.confidence, env);
      if (ct.alert)
        await sendMsg(cid, `📉 Confidence Dropping — last 3: ${ct.vals[2]}% → ${ct.vals[1]}% → ${ct.vals[0]}%\n\nConsider waiting for a stronger setup.`, env, { reply_markup: kb([[btn('🏆 Stats', 'cmd:stats'), btn('🔙 Menu', 'cmd:main')]]) });
    }
  } catch (e) {
    const err = `❌ Failed: ${esc(e.message.slice(0, 150))}`;
    if (mid) await editMsg(cid, mid, err, env, { reply_markup: mainKb(u) });
    else {
      if (loadingMid) await deleteMsg(cid, loadingMid, env);
      await sendMsg(cid, err, env, { reply_markup: mainKb(u) });
    }
  }
}

async function doScanAll(cid, mid, env) {
  const u    = await getUser(cid, env);
  const list = [u.pair, ...u.watchlist].filter((p,i,a) => a.indexOf(p) === i);
  let loadingMid = mid;
  if (mid) {
    await editMsg(cid, mid, `🔍 Scanning ${list.length} pairs...`, env, {});
  } else {
    const r = await sendMsg(cid, `🔍 Scanning ${list.length} pairs...`, env, {});
    try { const j = await r?.json(); loadingMid = j?.result?.message_id || null; } catch {}
  }
  let found = 0;
  for (const pair of list) {
    try {
      // [Bug#3 FIX] pass mode so FX/BOTH users get SL/TP levels in Scan All too
      const data = await fetchSig(pair, env, { mode: normMode(u.fxMode) });
      const sig  = data.signal;
      const dir  = sig?.finalSignal;
      if ((dir === 'BUY' || dir === 'SELL') && passGrade(sig, u.gradeFilter) && passConf(sig, u.minConfidence) && passAI(sig, u.aiOnlyMode)) {
        const corrWarnings = await checkCorrelated(cid, pair, dir, env);
        const no = await logAndSchedule(cid, pair, sig, env);
        await sendMsg(cid, fmtSignal(data, pair, u.interval, no, { correlated: corrWarnings, mode: normMode(u.fxMode) }), env, { reply_markup: signalKb(no) });
        found++;
      }
    } catch (e) { console.error(`scan ${pair}:`, e.message); }
  }
  const summary = found > 0 ? `✅ ${found} signal(s) found across ${list.length} pairs` : `⚪ No signals across ${list.length} pairs`;
  if (mid) {
    await restoreMainMsg(cid, mid, u, env);
    await sendMsg(cid, summary, env, { reply_markup: afterKb() });
  } else {
    if (loadingMid) await deleteMsg(cid, loadingMid, env);
    await sendMsg(cid, summary, env, { reply_markup: mainKb(u) });
  }
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
    await kdel(`lc:${cid}`, env);
    await kput(`errcnt:${cid}`, 0, env);
  }
  const wl = u.watchlist.map(disp).join(', ');
  const t  = u.autoEnabled
    ? `🔄 Auto Scan ON\n${SEP}\n${esc(disp(u.pair))}${wl ? '\nWatchlist: ' + esc(wl) : ''}\nInterval: ${u.interval}min  Grade: ${esc(u.gradeFilter || 'ALL')}\nAI Only: ${u.aiOnlyMode ? 'ON' : 'OFF'}  News Block: ${u.blockNews !== false ? 'ON' : 'OFF'}\n⏰ Next scan: ${nextCandleIn(u.interval)}`
    : `🔕 Auto Scan OFF\n${SEP}\nAuto scanning stopped.`;
  // Stay on Quick actions hub so user can keep acting
  return reply(cid, mid, t, env, quickKb(u));
}

async function doQuick(cid, mid, env) {
  const u = await getUser(cid, env);
  return reply(cid, mid, fmtQuickMenu(u), env, quickKb(u));
}

async function doSettings(cid, mid, env) {
  const u = await getUser(cid, env);
  return reply(cid, mid, fmtSettings(u), env, settingsKb(u));
}

// Legacy — settings2 merged into unified settings
async function doSettings2(cid, mid, env) {
  return doSettings(cid, mid, env);
}

// [v4.4] Premium placeholder — informational only, no payment
async function doPremium(cid, mid, env) {
  const t =
    `🚀 Premium\n${SEP}\n` +
    `<b>Coming soon — future features</b>\n\n` +
    `🚀 Signal priority (faster delivery)\n` +
    `📈 More pairs & custom watchlists\n` +
    `🎯 Advanced grade filters\n` +
    `📊 Extended history & CSV export\n` +
    `🔔 Multi-channel alerts\n` +
    `🤖 Higher AI confidence gates\n` +
    `${SEP}\n` +
    `💡 <i>This is informational only — no payment, no unlock yet.</i>\n` +
    `All current features are free for every user.`;
  return reply(cid, mid, t, env, premiumKb());
}

// [v4.4] Export info (admin endpoint pointer)
async function doExportInfo(cid, mid, env) {
  const t =
    `⬇ Export History\n${SEP}\n` +
    `CSV export is available via the admin endpoint:\n\n` +
    `<code>/export?secret=…&amp;chat=${cid}</code>\n\n` +
    `Columns: No, Pair, Dir, Grade, Conf, Entry, Exit, Pips, Result, Expiry, Time, ResolvedAt\n\n` +
    `💡 Ask your bot admin if you need a dump.`;
  return reply(cid, mid, t, env, settingsKb(await getUser(cid, env)));
}

async function doStatus(cid, mid, env) {
  const u   = await getUser(cid, env);
  const cnt = await getCounter(cid, env);
  const h   = await getHist(cid, env);
  const pen = h.filter(x => !x.result && x.direction).length;
  const nextScan = u.autoEnabled ? `\n⏰ Next scan: ${nextCandleIn(u.interval)}` : '';
  const t = `📋 Status\n${SEP}\nPair: ${esc(disp(u.pair))}\nWatchlist: ${u.watchlist.map(disp).join(', ') || 'None'}\nInterval: ${u.interval}min\nAuto: ${u.autoEnabled ? 'ON' : 'OFF'}${nextScan}\nGrade: ${esc(u.gradeFilter || 'ALL')}\nMin Conf: ${u.minConfidence || 0}%\nAI Only: ${u.aiOnlyMode ? 'ON' : 'OFF'}\nNews Block: ${u.blockNews !== false ? 'ON' : 'OFF'}\nSummary: ${u.dailySummary ? 'ON' : 'OFF'}\nChannel: ${u.channelId ? esc(String(u.channelId)) : 'None'}\nTotal Signals: ${cnt}  Pending: ${pen}`;
  return reply(cid, mid, t, env, kb([[btn('⚙️ Settings', 'cmd:settings'), btn('📉 Risk', 'cmd:risk')], backQuick()]));
}

async function doHist(cid, mid, page, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtHist(h, page), env, histNavKb(page, h.length));
}

async function doStats(cid, mid, env) {
  const h  = await getHist(cid, env);
  const rs = await getRegimeStats(cid, env);
  const ss = await getSessionStats(cid, env);
  return reply(cid, mid, fmtStats(h, rs, ss), env, kb([[btn('📈 History', 'cmd:history:0'), btn('📒 Journal', 'cmd:journal'), btn('🔥 Best', 'cmd:best')], backQuick()]));
}

async function doJournal(cid, mid, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtJournal(h), env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
}

async function doWeekly(cid, mid, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtWeekly(h), env, kb([[btn('🏆 Stats', 'cmd:stats'), btn('📒 Journal', 'cmd:journal')], backQuick()]));
}

// [F04] Risk Dashboard
async function doRisk(cid, mid, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtRisk(h), env, kb([[btn('🗑 Cancel All', 'cmd:cancelall'), btn('📈 History', 'cmd:history:0')], backQuick()]));
}

// [F05] Heatmap
async function doHeatmap(cid, mid, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtHeatmap(h), env, kb([[btn('🏆 Stats', 'cmd:stats'), btn('🔥 Best Pairs', 'cmd:best')], backQuick()]));
}

// [F06] Best Pairs
async function doBest(cid, mid, env) {
  const h = await getHist(cid, env);
  return reply(cid, mid, fmtBest(h), env, kb([[btn('🕐 Heatmap', 'cmd:heatmap'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
}

// [F09] Custom Alerts menu
async function doAlerts(cid, mid, env) {
  const alerts = await getAlerts(cid, env);
  const count  = Object.keys(alerts).length;
  const t = count
    ? `🔔 Custom Alerts (${count})\n${SEP}\nYou get notified when these pairs hit your threshold, even if they'd normally be filtered.\n`
    : `🔔 Custom Alerts\n${SEP}\nNo alerts set.\n\nAdd a pair + confidence threshold to get notified.`;
  return reply(cid, mid, t, env, alertsKb(alerts));
}

// [F08] Signal Replay
async function doReplay(cid, mid, pairRaw, env) {
  const u = await getUser(cid, env);
  const pair = pairRaw ? pairRaw.toUpperCase().replace(/[\s\/\-_.]/g, '') : norm(u.pair);
  if (mid) await editMsg(cid, mid, `🔄 Replaying ${disp(pair)} (not logged)...`, env, {});
  else     await sendMsg(cid, `🔄 Replaying ${disp(pair)} (not logged)...`, env, {});
  try {
    const data = await fetchSig(pair, env, { mode: normMode(u.fxMode) });
    const sig  = data?.signal;
    if (!sig) return sendMsg(cid, `❌ No data for ${disp(pair)}`, env, { reply_markup: mainKb(u) });
    const msg = fmtSignal(data, pair, u.interval, null, { replay: true, mode: normMode(u.fxMode) });
    await sendMsg(cid, msg, env, { reply_markup: kb([
      [btn('📊 Get Signal (log it)', `qs:${norm(pair)}`), btn('🔙 Menu', 'cmd:main')],
    ]) });
    await restoreMainMsg(cid, mid, u, env);
  } catch (e) {
    await sendMsg(cid, `❌ Replay failed: ${esc(e.message)}`, env, { reply_markup: mainKb(u) });
  }
}

async function doAnalyze(cid, mid, pairRaw, env) {
  const u = await getUser(cid, env);
  const pair = pairRaw ? pairRaw.toUpperCase().replace(/[\s\/\-_.]/g, '') : norm(u.pair);
  await reply(cid, mid, `🔍 Analyzing ${disp(pair)}...`, env);
  try {
    const data = await fetchSig(pair, env, { mode: normMode(u.fxMode) });
    const sig  = data?.signal;
    if (!sig) return sendMsg(cid, `❌ No data for ${disp(pair)}`, env, { reply_markup: mainKb(u) });
    const dir   = sig.finalSignal || 'NO_TRADE';
    const conf  = sig.confidence  || '0%';
    const dE    = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
    const rg    = sig.marketRegime || 'UNKNOWN';
    const rIcon = { TRENDING:'🔵', RANGING:'🟡', BREAKOUT:'🟠', VOLATILE:'🔴' };
    // [Bug#1 FIX] every dynamic value escaped (HTML parse_mode is on)
    let msg = `🔍 Analysis: ${esc(disp(pair))}\n${SEP}\n`;
    msg += `${dE} <b>${esc(dir)}</b>  ${esc(conf)}  ${sig.grade?.grade ? `[${esc(sig.grade.grade)} ${esc(sig.grade.label || '')}]` : ''}\n`;
    msg += `${rIcon[rg]||'⚪'} Regime: <b>${esc(rg)}</b>\n`;
    msg += `📈 HTF: <b>${esc(sig.higherTFTrend||'NEUTRAL')}</b>\n`;
    msg += `🔗 Alignment: <b>${esc(sig.alignment||'MIXED')}</b>\n${SEP}\n`;
    for (const tf of ['1min','5min','15min']) {
      const r = sig.recommendations?.[tf];
      if (!r) continue;
      const td = r.direction === 'BUY' ? '🟢' : r.direction === 'SELL' ? '🔴' : '⚪';
      msg += `${td} ${tf}: <b>${esc(r.direction)}</b> ${r.score?.diff?.toFixed(1)||0} diff (${esc(r.confluence || '')})\n`;
    }
    if (sig.entryReason)  msg += `\n📝 <i>${esc(sig.entryReason)}</i>\n`;
    if (sig.regimeAdvice) msg += `💡 <i>${esc(sig.regimeAdvice)}</i>\n`;
    // v4.4.1 INTEGRATION FIX: dual-combiner support for doAnalyze too
    const aiA = sig.aiValidation;
    if (aiA) {
      const aiAStatus = aiA.status || (aiA.combined && aiA.combined.status);
      if (aiAStatus === 'OK') {
        const aiASig = aiA.signal || (aiA.combined && aiA.combined.signal);
        const aiAConf = aiA.confidence ?? (aiA.combined && aiA.combined.confidence);
        const aiAConc = aiA.concerns || (aiA.combined && aiA.combined.concerns);
        msg += `\n🤖 AI: <b>${esc(aiASig)}</b> ${esc(aiAConf)}%`;
        if (aiAConc) msg += ` ⚠️ ${esc(aiAConc)}`;
        msg += '\n';
      }
    }
    await sendMsg(cid, msg, env, { reply_markup: kb([[btn('📊 Get Signal', `qs:${norm(pair)}`), btn('🔄 Replay', `cmd:replayhelp`), btn('🔙 Menu', 'cmd:main')]]) });
  } catch (e) {
    await sendMsg(cid, `❌ Analysis failed: ${esc(e.message)}`, env, { reply_markup: mainKb(u) });
  }
}

async function doWatchlist(cid, mid, env) {
  const u = await getUser(cid, env);
  const t = `👁 Watchlist (${u.watchlist.length}/${MAX_WL})\n\n${u.watchlist.length ? u.watchlist.map(disp).join(', ') : 'Empty'}\n\n📊 = Quick signal  ❌ = Remove`;
  return reply(cid, mid, t, env, wlKb(u.watchlist));
}

async function doToday(cid, mid, env) {
  const h     = await getHist(cid, env);
  const today = new Date().toISOString().slice(0, 10);
  const th    = h.filter(x => x.timestamp?.startsWith(today));
  if (!th.length) return reply(cid, mid, `📅 Today (${today})\n${SEP}\nNo signals yet.`, env, kb([backQuick()]));
  const res  = th.filter(x => x.result === 'WIN' || x.result === 'LOSS');
  const wins = res.filter(x => x.result === 'WIN').length;
  const wr   = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
  let t = `📅 Today — ${today}\n${SEP}\n📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n\n`;
  for (const x of th.slice(0, 8)) {
    const dE = x.direction === 'BUY' ? '🟢' : '🔴';
    const rE = x.result === 'WIN' ? '✅' : x.result === 'LOSS' ? '❌' : x.result === 'CANCEL' ? '🗑' : '⏳';
    t += `${rE} #${x.no} ${dE} ${disp(x.pair)}${x.grade ? ' [' + esc(x.grade.split(' ')[0]) + ']' : ''} ${esc(x.confidence || '')}\n`;
  }
  return reply(cid, mid, t, env, kb([[btn('📈 History', 'cmd:history:0'), btn('📉 Risk', 'cmd:risk')], backQuick()]));
}

async function doSummary(cid, mid, env) {
  const h     = await getHist(cid, env);
  const today = new Date().toISOString().slice(0, 10);
  const th    = h.filter(x => x.timestamp?.startsWith(today));
  if (!th.length) return reply(cid, mid, `No signals today yet.`, env, kb([backQuick()]));
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
  let t = `📅 Daily Summary — ${today}\n${SEP}\n📊 ${th.length} signals  Resolved: ${res.length}\n✅ ${wins}W  ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n`;
  if (Object.keys(gm).length) {
    t += `\nGrades:\n`;
    for (const [g, s] of Object.entries(gm)) {
      const tt = s.w + s.l;
      t += `  ${esc(g)}: ${s.w}W/${s.l}L (${Math.round(s.w / tt * 100)}%)\n`;
    }
  }
  t += `\n${trend} (all-time: ${allWR}%)`;
  return reply(cid, mid, t, env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
}

async function doCancelAll(cid, mid, env) {
  const u    = await getUser(cid, env);
  const h    = await getHist(cid, env);
  const pend = h.filter(x => !x.result && x.direction);
  if (!pend.length) return reply(cid, mid, `ℹ️ No pending trades to cancel.`, env, mainKb(u));
  const allIds = await getPendingIds(env);
  const myTids = pend.map(x => x.id);
  for (const trade of pend) {
    await setResult(cid, trade.id, 'CANCEL', null, null, env);
    await clearLock(cid, trade.pair, env);
    await kdel(`pt:${trade.id}`, env);
    // [Bug#4 FIX] drop the stale "expires in ~30s" reminder for cancelled trades
    await delReminder(trade.id, env);
  }
  await savePendingIds(allIds.filter(id => !myTids.includes(id)), env);
  return reply(cid, mid, `🗑 Cancelled ${pend.length} pending trade(s).`, env, mainKb(u));
}

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
  // [Bug#4 FIX] drop the stale "expires in ~30s" reminder for resolved trades
  await delReminder(trade.id, env);
  const ids = await getPendingIds(env);
  await savePendingIds(ids.filter(id => id !== trade.id), env);
  const dE = trade.direction === 'BUY' ? '🟢' : '🔴';
  const rE = result === 'WIN' ? '✅ WIN' : '❌ LOSS';
  return reply(cid, mid,
    `${rE} — manually set\n${SEP}\n${dE} #${no} ${trade.direction} ${disp(trade.pair)}${trade.grade ? ` [${esc(trade.grade)}]` : ''}`,
    env, afterKb());
}

// ─── SIGNAL FETCH ─────────────────────────────────────────────────────────────

// [Fix#4] Service Binding now has timeout via Promise.race
// map user fxMode ('ftt'|'fx'|'both') to worker ?mode= param
// - 'fx'  → mode=fx (SL/TP only)
// - 'both'→ fetch FX payload (SL/TP); bot shows both expiry + levels
const workerModeParam = (m) => (m === 'fx' || m === 'both' || m === true) ? '&mode=fx' : '';
const normMode = (m) => { if (m === 'fx' || m === 'both') return m; return 'ftt'; };   // legacy bool/undefined → ftt

async function fetchSig(pair, env, opts = {}) {
  const WORKER_URL = 'https://fttotcv6.umuhammadiswa.workers.dev';
  const mode = workerModeParam(opts.mode);
  const url  = `${WORKER_URL}/api/signal?pair=${pair}${mode}`;
  // [Bug#6 FIX] the 20s race now covers fetch AND res.json(), so a slow or
  // hanging response body can never leave the user's message stuck on
  // "⏳ Fetching…" — the caller always gets a rejection to render.
  const withTimeout = async (p, label) => {
    let timer;
    const timeoutP = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(label)), 20000); });
    try { return await Promise.race([p, timeoutP]); }
    finally {
      clearTimeout(timer);
      p.catch(() => {}); // swallow late rejection of the losing promise
    }
  };
  const res = env.SIGNAL_WORKER
    ? await withTimeout(env.SIGNAL_WORKER.fetch(new Request(url, { headers: { Accept: 'application/json' } })), 'Service binding timeout 20s')
    : await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
  return withTimeout(res.json(), 'Signal worker response timeout 20s');
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

// Lite cron: signal generation disabled (Worker Push / Phase 10 handles auto signals).
// Bot cron only tracks: result resolution (bot analytics), reminders, summaries.
async function cronLite(env) {
  const logs = [];
  const log = m => { console.log(m); logs.push(String(m)); };
  log(`CronLite ${new Date().toISOString()}`);
  if (!env?.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing'); return; }
  if (!env?.BOT_KV)    { log('ERROR: BOT_KV missing');    return; }
  // AutoScan re-enabled (2026-08-05): worker push alone was not delivering
  // reliably for all users; the bot's own scan uses the same gates and also
  // honors each user's fxMode (FX/BOTH get SL/TP levels).
  await autoScan(env, log).catch(e => log('ScanErr: ' + e.message));
  await resultCheck(env, log).catch(e => log('ResultErr: ' + e.message));
  await expiryReminder(env, log).catch(e => log('ReminderErr: ' + e.message));
  await dailySummary(env, log).catch(e => log('SummaryErr: ' + e.message));
  await weeklyReport(env, log).catch(e => log('WeeklyErr: ' + e.message));
  log('Done');
}

// Full cron (kept for /runcron debug — includes autoScan if ever needed)
async function cron(env, logs = [], force = false) {
  const log = m => { console.log(m); logs.push(String(m)); };
  log(`Cron ${new Date().toISOString()}`);
  if (!env?.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing'); return; }
  if (!env?.BOT_KV)    { log('ERROR: BOT_KV missing');    return; }
  await autoScan(env, log).catch(e => log('ScanErr: ' + e.message));
  await resultCheck(env, log).catch(e => log('ResultErr: ' + e.message));
  await expiryReminder(env, log).catch(e => log('ReminderErr: ' + e.message));
  await dailySummary(env, log).catch(e => log('SummaryErr: ' + e.message));
  await weeklyReport(env, log).catch(e => log('WeeklyErr: ' + e.message));
  log('Done');
}

async function autoScan(env, log) {
  const users = await getAutoUsers(env);
  log(`Scan: ${users.length} users`);
  const now = Date.now();

  // [F03] Fetch news once per cron run (shared across all users)
  let newsAlert = null;
  try { newsAlert = await hasHighImpactNews(env); } catch {}
  if (newsAlert) log(`News alert: ${newsAlert.title} (${newsAlert.currency}) in ${newsAlert.minsAway}min`);

  for (const cid of users) {
    try {
      const u = await getUser(cid, env);
      if (!u.autoEnabled) continue;

      // Candle-close gate
      const intervalMin   = u.interval || 5;
      const intervalMs    = intervalMin * 60 * 1000;
      const currentCandle = Math.floor(now / intervalMs) * intervalMs;
      const lastCandle    = (await kget(`lc:${cid}`, env)) || 0;
      if (currentCandle <= lastCandle) { log(`Skip ${cid} — same candle`); continue; }
      await kput(`lc:${cid}`, currentCandle, env, { expirationTtl: intervalMin * 60 * 2 });

      // [F03] Skip auto scan during high-impact news window
      if (u.blockNews !== false && newsAlert) {
        log(`News skip for ${cid}: ${newsAlert.title}`);
        // Only notify once (when the event starts, minsAway close to 0)
        if (Math.abs(newsAlert.minsAway) <= intervalMin) {
          const sign = newsAlert.minsAway >= 0 ? 'in' : 'ago';
          await sendMsg(cid, `🚫 Auto scan paused\n${SEP}\n⚠️ ${esc(newsAlert.title)} (${esc(newsAlert.currency)}) ${sign} ${Math.abs(newsAlert.minsAway)}min\n${SEP}\n\nSignals resume after the news window.`, env);
        }
        continue;
      }

      const list = [u.pair, ...u.watchlist].filter((p,i,a) => a.indexOf(p) === i);
      let anySignalSent = false, pairErrors = 0;

      // [F09] Fetch custom alerts for this user
      const userAlerts = await getAlerts(cid, env);

      for (const pair of list) {
        try {
          // Same-candle dedup
          const scKey = `sc:${cid}:${norm(pair)}`;
          const lastPairCandle = (await kget(scKey, env)) || 0;
          if (lastPairCandle >= currentCandle) { log(`Dedup ${pair}`); continue; }

          const data = await fetchSig(pair, env, { mode: normMode(u.fxMode) });
          const sig  = data.signal;
          const dir  = sig?.finalSignal;

          if (dir === 'BUY' || dir === 'SELL') {
            const normPair = norm(pair);
            const alertConf = userAlerts[normPair];

            // Check if passes main filters OR custom alert threshold
            const passesMain  = passGrade(sig, u.gradeFilter) && passConf(sig, u.minConfidence) && passAI(sig, u.aiOnlyMode);
            const passesAlert = alertConf && parseInt((sig.confidence||'0%').replace('%',''), 10) >= alertConf;

            if (!passesMain && !passesAlert) { log(`Filtered ${pair}`); continue; }

            const lock = await getLock(cid, pair, env);
            if (lock?.direction === dir && lock?.expiryAt > now) { log(`Locked ${pair}`); continue; }

            const corrWarnings = await checkCorrelated(cid, pair, dir, env);
            const no = await logAndSchedule(cid, pair, sig, env);

            // Build message options
            const msgOpts = { correlated: corrWarnings, mode: normMode(u.fxMode) };
            if (passesAlert && !passesMain) {
              // Alert-triggered signal (bypassed normal filter)
              await sendMsg(cid,
                `🔔 Custom Alert: ${esc(disp(pair))} hit ${esc(sig.confidence)}% (your threshold: ${alertConf}%)\n\n` +
                fmtSignal(data, pair, intervalMin, no, msgOpts),
                env, { reply_markup: signalKb(no) });
            } else {
              await sendMsg(cid, fmtSignal(data, pair, intervalMin, no, msgOpts), env, { reply_markup: signalKb(no) });
            }

            // [F10] Mirror to channel
            if (u.channelId) {
              await sendMsg(u.channelId, fmtSignal(data, pair, intervalMin, no, { mode: normMode(u.fxMode) }), env, { reply_markup: channelKb() })
                .catch(e => log(`Channel ${u.channelId}: ${e.message}`));
            }

            await kput(scKey, currentCandle, env, { expirationTtl: intervalMin * 60 + 60 });
            log(`Sent #${no} ${pair} ${dir}`);
            anySignalSent = true;

            // [Fix#2] Confidence trend alert
            if (sig.confidence) {
              const ct = await updateConfTrend(cid, sig.confidence, env);
              if (ct.alert)
                await sendMsg(cid, `📉 Confidence Dropping — last 3: ${ct.vals[2]}% → ${ct.vals[1]}% → ${ct.vals[0]}%\n\nConsider waiting for a stronger setup.`, env, { reply_markup: kb([[btn('🏆 Stats', 'cmd:stats'), btn('🔙 Menu', 'cmd:main')]]) });
            }
          }
        } catch (e) {
          log(`Pair ${pair}: ${e.message}`);
          pairErrors++;
        }
      }

      // Worker error auto-pause
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
          await sendMsg(cid, `⚠️ Auto Scan paused\n\nSignal worker unreachable — ${MAX_ERRORS} consecutive failures.\nFix the worker then tap 🔄 Start Auto to resume.`, env, { reply_markup: mainKb(u) });
          log(`Auto paused for ${cid}`);
        }
      } else if (pairErrors === 0 && list.length > 0) {
        await kput(`errcnt:${cid}`, 0, env);
      }

      if (!anySignalSent) {
        u.noTradeStreak = (u.noTradeStreak || 0) + 1;
        if (u.noTradeStreak >= 12) {
          // [Fix#5] Added 🔙 Menu button
          await sendMsg(cid, `⚪ No setup for ${u.noTradeStreak} scans across ${list.length} pair(s).`, env,
            { reply_markup: kb([[btn('🔕 Stop Auto', 'cmd:toggle_auto'), btn('🔙 Menu', 'cmd:main')]]) });
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

  // Is this a fill-pending trade? (entry hit/miss only matters for these)
  const isPendingFill = t => ['PENDING_ENTRY', 'PENDING'].includes(t.fillStatus);
  // Has price touched the entry level since logging?
  const touchedEntry = (t, current) => {
    const entry = parseFloat(t.entryPrice);
    if (isNaN(entry) || isNaN(current)) return false;
    return t.direction === 'BUY' ? current <= entry : current >= entry;
  };
  // Record the observation on the pending trade (survives until resolution)
  const noteEntryTouch = async (t, tid, current) => {
    if (!isPendingFill(t) || t.entryHit === true || !touchedEntry(t, current)) return false;
    t.entryHit = true;
    await kput(`pt:${tid}`, t, env, { expirationTtl: 7200 });
    return true;
  };

  // Premium result card + risk/milestone bookkeeping
  const finish = async (t, tid, current, result, hitNote, lateMin) => {
    const entry = parseFloat(t.entryPrice);
    const diff  = current - entry;
    const pips  = isCr(t.pair) ? Math.round(Math.abs(diff) * 100) / 100 : Math.round(Math.abs(diff) * 10000 * 10) / 10;
    const moveS = isCr(t.pair)
      ? `${diff > 0 ? '+' : ''}$${pips}`
      : `${diff > 0 ? '+' : ''}${pips} pips`;
    const pct   = !isNaN(entry) && entry !== 0 ? ((diff / entry) * 100) : 0;
    await setResult(t.chatId, tid, result, current, pips, env);
    await clearLock(t.chatId, t.pair, env);
    await kdel(`pt:${tid}`, env);
    await delReminder(tid, env);
    const dE       = t.direction === 'BUY' ? '🟢' : '🔴';
    const rE       = result === 'WIN' ? '✅ <b>WIN</b>' : '❌ <b>LOSS</b>';
    const gS       = t.grade ? ` [${esc(t.grade)}]` : '';
    const notes    = [`#${t.signalNo || tid}`];
    if (hitNote) notes.push(hitNote);
    if (lateMin > 1) notes.push(`+${lateMin}min`);
    // [v4.3] entry hit/miss — INSTANT fills always hit; PENDING_ENTRY judged
    // by whether price touched entry during the tracking window
    const entryHit = t.entryHit === true || !isPendingFill(t);
    const hitLine  = entryHit
      ? `⚡ Entry hit ✓ — price reached entry`
      : `⚠️ Entry miss — price never reached entry (result may be misleading)`;
    await sendMsg(t.chatId,
      `📌 Signal ${notes.join(' · ')}\n` +
      `${rE} — ${dE} ${esc(disp(t.pair))}${gS}\n` +
      `${SEP}\n` +
      `💰 Entry: <code>${esc(fmtPrice(entry, t.pair))}</code> → Exit: <code>${esc(fmtPrice(current, t.pair))}</code>\n` +
      `🎯 Result: <b>${result}</b> ${moveS} (${diff > 0 ? '+' : ''}${pct.toFixed(2)}%)\n` +
      `${SEP}\n` +
      `${hitLine}`,
      env, { reply_markup: afterKb() });
    // Risk alert
    const risk = await updateRisk(t.chatId, result, env);
    if (risk.type === 'LOSS' && risk.streak >= 3) {
      await sendMsg(t.chatId,
        `⚠️ Risk Alert — ${risk.streak} Consecutive Losses\n\nConsider taking a break or reducing trade size.`,
        env, { reply_markup: kb([[btn('🏆 Check Stats', 'cmd:stats'), btn('🔕 Stop Auto', 'cmd:toggle_auto')],[btn('🔙 Continue', 'cmd:main')]]) });
    }
    await checkMilestone(t.chatId, env);
  };

  const skipTrade = async (t, tid, reason) => {
    await setResult(t.chatId, tid, 'SKIP', null, null, env);
    await clearLock(t.chatId, t.pair, env);
    await kdel(`pt:${tid}`, env);
    await delReminder(tid, env);
    await sendMsg(t.chatId, `⏭ Tracking #${t.signalNo || tid} — ${reason}`, env, { reply_markup: afterKb() });
  };

  for (const tid of ids) {
    try {
      const t = await kget(`pt:${tid}`, env);
      if (!t) continue;
      const isFx = !!(t.sl && t.tp);

      // [Bug#5 FIX] FX trade inside its 60min horizon: resolve only on SL/TP hit
      if (t.expiryAt > now) {
        if (isFx) {
          const cur = await fetchPrice(t.pair, env);
          if (!cur) { keep.push(tid); continue; }
          const current = parseFloat(cur);
          // [v4.3] observe whether price ever reached the (pending) entry
          await noteEntryTouch(t, tid, current);
          const sl = parseFloat(t.sl), tp = parseFloat(t.tp);
          if (isNaN(current) || isNaN(sl) || isNaN(tp)) { keep.push(tid); continue; }
          const hitTp = t.direction === 'BUY' ? current >= tp : current <= tp;
          const hitSl = t.direction === 'BUY' ? current <= sl : current >= sl;
          if (hitTp)      await finish(t, tid, current, 'WIN',  '🎯 TP hit', 0);
          else if (hitSl) await finish(t, tid, current, 'LOSS', '🛑 SL hit', 0);
          else            keep.push(tid);
        } else if (isPendingFill(t)) {
          // [v4.3] FTT pending-entry: watch for the entry level during the window
          const cur = await fetchPrice(t.pair, env);
          if (cur) await noteEntryTouch(t, tid, parseFloat(cur));
          keep.push(tid);
        } else {
          keep.push(tid);
        }
        continue;
      }

      // Horizon expired → resolve by price direction (FTT) / fallback (FX)
      const cur = await fetchPrice(t.pair, env);
      if (!cur || !t.entryPrice) { await skipTrade(t, tid, 'price unavailable'); continue; }
      const entry   = parseFloat(t.entryPrice);
      const current = parseFloat(cur);
      if (isNaN(entry) || isNaN(current)) { await skipTrade(t, tid, 'invalid price data'); continue; }
      // [v4.3] last chance to observe the entry level before judging hit/miss
      await noteEntryTouch(t, tid, current);
      const diff   = current - entry;
      const result = t.direction === 'BUY' ? (diff > 0 ? 'WIN' : 'LOSS') : (diff < 0 ? 'WIN' : 'LOSS');
      const late   = Math.round((now - t.expiryAt) / 60000);
      await finish(t, tid, current, result, isFx ? '⏰ 60min horizon' : null, late);
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
      const gm = {};
      for (const x of res) {
        const g = (x.grade || '?').split(' ')[0];
        if (!gm[g]) gm[g] = { w:0, l:0 };
        x.result === 'WIN' ? gm[g].w++ : gm[g].l++;
      }
      let sumT = `📅 Daily Summary — ${today}\n${SEP}\n📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n⏳ Pending: ${th.filter(x => !x.result).length}`;
      if (Object.keys(gm).length) {
        sumT += `\n${SEP}\nGrades:\n`;
        for (const [g, s] of Object.entries(gm)) {
          const tt = s.w + s.l;
          sumT += `  ${esc(g)}: ${s.w}W/${s.l}L (${Math.round(s.w / tt * 100)}%)\n`;
        }
      }
      await sendMsg(cid, sumT, env, { reply_markup: kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')]]) });
      await kput(`ds:${cid}`, Date.now(), env);
      log(`Summary sent to ${cid}`);
    } catch (e) { log(`Summary ${cid}: ${e.message}`); }
  }
}

async function expiryReminder(env, log) {
  const ids = await getPendingReminders(env);
  if (!ids.length) return;
  const now = Date.now(), remaining = [];
  for (const tid of ids) {
    try {
      const r = await kget(`rem:${tid}`, env);
      if (!r) continue;
      if (r.remAt > now) { remaining.push(tid); continue; }
      const dE = r.direction === 'BUY' ? '🟢' : '🔴';
      await sendMsg(r.chatId, `⏰ Signal #${r.signalNo} expires in ~30s\n${SEP}\n${dE} <b>${esc(r.direction)}</b> ${esc(disp(r.pair))}`, env);
      await kdel(`rem:${tid}`, env);
      log(`Reminder sent #${r.signalNo}`);
    } catch (e) { log(`Reminder ${tid}: ${e.message}`); remaining.push(tid); }
  }
  await kput('remind_ids', remaining, env);
}

async function weeklyReport(env, log) {
  const now  = new Date();
  const day  = now.getUTCDay(), hour = now.getUTCHours();
  if (day !== 1 || hour !== 8) return;
  const users = await getAutoUsers(env);
  log(`Weekly: ${users.length} users`);
  for (const cid of users) {
    try {
      const lastKey = `wr:${cid}`;
      const last    = (await kget(lastKey, env)) || 0;
      if (Date.now() - last < 6 * 24 * 60 * 60 * 1000) continue;
      const h   = await getHist(cid, env);
      await sendMsg(cid, fmtWeekly(h), env, { reply_markup: kb([[btn('🏆 Stats', 'cmd:stats'), btn('📒 Journal', 'cmd:journal')],[btn('🔥 Best Pairs', 'cmd:best'), btn('🔙 Menu', 'cmd:main')]]) });
      await kput(lastKey, Date.now(), env);
      log(`Weekly sent to ${cid}`);
    } catch (e) { log(`Weekly ${cid}: ${e.message}`); }
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
    let t = `🏁 ${MILESTONE}-Signal Report (#${batch[batch.length-1]?.no||'?'} to #${batch[0]?.no||'?'})\n${SEP}\n✅ ${wins}W  ❌ ${batch.length - wins}L\n📊 Win Rate: ${wr}%\n\nGrades:\n`;
    for (const [g,s] of Object.entries(gm)) { const tt=s.w+s.l; t += `  ${esc(g)}: ${s.w}W/${s.l}L (${Math.round(s.w/tt*100)}%)\n`; }
    t += `\nTop Pairs:\n`;
    Object.entries(pm).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l)).slice(0,4)
      .forEach(([p,s]) => { const tt=s.w+s.l; t += `  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w/tt*100)}%)\n`; });
    t += `\n🔄 Next ${MILESTONE} signals tracking starts now.`;
    await sendMsg(cid, t, env, { reply_markup: kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats'), btn('🔥 Best Pairs', 'cmd:best')]]) });
    await kput(mk, { lastCount: res.length }, env);
  } catch (e) { console.error('milestone:', e.message); }
}
