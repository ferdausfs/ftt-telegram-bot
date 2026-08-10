/**
 * FTT Signal Telegram Bot — v5.0 THIN CLIENT (worker = single source of truth)
 * KV Binding     : BOT_KV
 * Service Binding: SIGNAL_WORKER → fttotcv6.umuhammadiswa.workers.dev
 * Secrets        : BOT_TOKEN, SETUP_SECRET
 *
 * ── v5.0 THIN CLIENT (WORKER = SINGLE SOURCE OF TRUTH) ───────────────────────
 *  Bot is a thin Telegram client over worker endpoints. No parallel ledger.
 *  • /history  → GET /api/history?pair=X&limit=N  (worker, per-pair global stream)
 *  • /stats    → GET /api/stats?pair=X            (worker)
 *  • /best     → aggregate /api/stats per pair + /api/signals/latest
 *  • /heatmap  → aggregate /api/history (worker)
 *  • /win N / /loss N + buttons → POST /api/report?id=<signalId>&result=WIN|LOSS
 *  • Signals (/signal,/scan,watchlist) → fetchSig → fmtSignal → sendMsg (NO logAndSchedule)
 *  • autoScan / resultCheck / expiryReminder REMOVED from cronLite (worker push is single delivery)
 *  • dailySummary / weeklyReport KEEP but computed from worker /api/history + /api/stats
 *  • User settings KV (u:) + menus + premium formatting + filters preserved
 *
 *  Mapping table (bot → worker / removed):
 *   doHistory  → GET /api/history?pair=X&limit=N
 *   doStats    → GET /api/stats?pair=X
 *   doBest     → GET /api/stats per pair (+ /api/signals/latest)
 *   doHeatmap  → GET /api/history (large limit, compute hourly)
 *   doJournal/doToday/doWeekly/doRisk → GET /api/history (filter by time)
 *   doManualResult → POST /api/report?id=<id>&result=WIN|LOSS
 *   logAndSchedule / h: / pt: / rem: / lock: → REMOVED (no parallel ledger)
 *   autoScan → REMOVED from cronLite (worker push only)
 *   resultCheck → REMOVED (worker cron every 2min resolves + Phase 10 pushes)
 *   expiryReminder → REMOVED (worker push covers)
 *   dailySummary/weeklyReport → REWORKED to worker data (not h:)
 *
 *  Override flow: user picks signal from /history (worker short id last 6) → /win <id> or
 *   ✅ WIN button (res:win:<signalId>) → bot POSTs worker /api/report (idempotent, FIX-4 guards double-count)
 *
 *  Per-pair-global note: worker history is per-pair global (pair's full signal stream),
 *   not per-user. This is INTENDED — single source, no duplication. User sees pair's real stream.
 *
 *  R1 no parallel ledger: bot writes NO h:/pt: — grep kput(`h:` / addPending / pt: gone
 *  R2 duplicate gone: worker signal id appears exactly once in /history page (dedup by id)
 *  R3 worker-backed: every trading-data command reads WORKER (not BOT_KV)
 *
 * ── v4.4.2 BUGFIXES (kept) ───────────────────────────────────────────────────
 *  [B3] Duplicate signal pushes eliminated. Worker push (Phase 10, BUG-001 fixed)
 *       is now the SINGLE source of auto signal delivery. (v5 removes remaining bot ledger)
 *  [B4] wrangler.toml now carries compatibility_flags = ["global_fetch_strictly_public"]
 *       so the bot→worker service-binding fetch does not regress with Cloudflare
 *       error 1042 on GitHub-Actions deploys (previously only patched at runtime).
 *
 * ── v4.4.1 BUGFIXES ──────────────────────────────────────────────────────────
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
 *        ⚠ REMOVED in v4.4.2 (BUG-B3): alerts could only fire on bot push, and bot
 *        push is gone (worker push is the single delivery path). The dead /alerts
 *        UI, callback handlers and alert KV helpers were removed. Worker-side
 *        alert thresholds are a separate worker-repo PR.
 *  [F10] Telegram Channel Mode — /setchannel <id>; auto-posts signals to a channel
 *        (bot must be admin). /clearchannel to remove.
 *        ⚠ v4.4.2 (BUG-B3): the autoScan channel mirror was removed with the other
 *        cron-driven signal sends (it would duplicate worker push to the channel).
 *        Channel config UI is kept; channel delivery now rides on worker push.
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
const WORKER_URL   = 'https://fttotcv6.umuhammadiswa.workers.dev';

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
      const user = await getUser(id, env);
      const pair = user.pair || 'EURUSD';
      try {
        const data = await fetchWorkerHistory(pair, 100, env);
        const signals = data.signals || data.history || [];
        if (!signals.length) return new Response('No data', { status: 404 });
        const hdr  = 'id,pair,direction,confidence,grade,result,entryPrice,exitPrice,fillStatus,entryHit,expiryTime,timestamp';
        const rows = signals.map(s => [
          s.id||'', s.pair||pair, s.direction||'', s.confidence||'', (s.grade?.grade||s.grade||''), s.result||'PENDING',
          s.entryPrice||'', s.exitPrice||'', s.fillStatus||'', s.entryHit??'', s.expiryTime||s.expiryAt||'', s.timestamp||s.createdAt||''
        ].join(','));
        const fname = `ftt-${id}-${new Date().toISOString().slice(0,10)}.csv`;
        return new Response([hdr, ...rows].join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="${fname}"`,
          },
        });
      } catch (e) {
        return new Response('Worker fetch failed: '+e.message, { status: 502 });
      }
    }
    return new Response('FTT Signal Bot v5.0 thin-client');
  },

  async scheduled(e, env, ctx) {
    // Worker push (Phase 10) handles all signal delivery + result push.
    // Bot cron only handles user-facing summaries computed from worker.
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

// ─── ANALYTICS KV HELPERS (REMOVED — worker = single source) ───────────────
// Regime/session/risk/conf-trend were bot-side analytics derived from bot h:.
// Now stats come from worker /api/stats — no bot KV writes.

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

// Returns array of warning strings for correlated open trades (thin-client: from worker pending)
async function checkCorrelated(cid, newPair, newDir, env) {
  try {
    const u = await getUser(cid, env);
    const pairs = [u.pair, ...u.watchlist].filter(Boolean);
    const pending = [];
    for (const p of pairs) {
      if (norm(p) === norm(newPair)) continue;
      try {
        const data = await fetchWorkerHistory(p, 20, env);
        const sigs = data.signals || data.history || [];
        for (const s of sigs) {
          if (!s.result || s.result === 'PENDING' || s.result === null) {
            if (s.direction && s.pair) pending.push(s);
          }
        }
      } catch {}
    }
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
    return warnings.slice(0,3);
  } catch { return []; }
}

// ─── EXPIRY REMINDERS (REMOVED — worker push covers delivery) ─────────────────
// getPendingReminders / addReminder / delReminder removed: no bot-side reminders.

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

// ─── HISTORY / PENDING / LOCKS / LOG (REMOVED — worker is single source) ─────
// Bot-side h:, pt:, lock:, rem: removed. Signals exist in worker; bot only displays.
// ─── WORKER FETCH HELPERS (thin client) ─────────────────────────────────────

async function fetchWorkerJson(path, env, opts = {}) {
  const url = `${WORKER_URL}${path}`;
  const method = opts.method || 'GET';
  const headers = opts.headers || { Accept: 'application/json' };
  const withTimeout = async (p, label) => {
    let timer;
    const timeoutP = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(label)), 20000); });
    try { return await Promise.race([p, timeoutP]); }
    finally { clearTimeout(timer); p.catch(()=>{}); }
  };
  const res = env.SIGNAL_WORKER
    ? await withTimeout(env.SIGNAL_WORKER.fetch(new Request(url, { method, headers })), 'Service binding timeout 20s')
    : await fetch(url, { method, headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Worker ${res.status}: ${(await res.text().catch(()=>'' )).slice(0,150)}`);
  return withTimeout(res.json(), 'Worker response timeout 20s');
}
async function fetchWorkerHistory(pair, limit, env) {
  const p = norm(pair);
  return fetchWorkerJson(`/api/history?pair=${p}&limit=${limit}`, env);
}
async function fetchWorkerStats(pair, env) {
  const p = norm(pair);
  return fetchWorkerJson(`/api/stats?pair=${p}`, env);
}
async function fetchWorkerLatest(env) {
  return fetchWorkerJson(`/api/signals/latest`, env);
}
async function postWorkerReport(signalId, result, env) {
  const id = encodeURIComponent(String(signalId));
  const r = encodeURIComponent(String(result));
  const path = `/api/report?id=${id}&result=${r}`;
  const url = `${WORKER_URL}${path}`;
  const withTimeout = async (p, label) => {
    let timer;
    const timeoutP = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(label)), 20000); });
    try { return await Promise.race([p, timeoutP]); }
    finally { clearTimeout(timer); p.catch(()=>{}); }
  };
  const res = env.SIGNAL_WORKER
    ? await withTimeout(env.SIGNAL_WORKER.fetch(new Request(url, { method: 'POST', headers: { Accept: 'application/json' } })), 'Service binding timeout 20s')
    : await fetch(url, { method: 'POST', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`Worker ${res.status}: ${txt.slice(0,200)}`);
  }
  try { return await withTimeout(res.json(), 'Worker response timeout 20s'); } catch { return { ok: true }; }
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

const signalKb = (signalId = null) => {
  const rows = [[{ text: '📈 Trade on Quotex', url: QUOTEX_URL }]];
  if (signalId) {
    const sid = String(signalId);
    rows.push([btn(`✅ WIN ${sid.slice(-6)}`, `res:win:${sid}`), btn(`❌ LOSS ${sid.slice(-6)}`, `res:loss:${sid}`)]);
  }
  rows.push([btn('🔁 New Signal', 'cmd:signal'), btn('📈 History', 'cmd:history:0'), btn('🔙 Menu', 'cmd:main')]);
  return kb(rows);
};

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
    [btn('🔁 Replay', 'cmd:replayhelp')],
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

// Arena hub card (thin-client: stats from worker)
function fmtMainMenu(u, stats) {
  const total = stats?.totalSignals ?? stats?.total ?? 0;
  const wr = stats?.winRate ?? 0;
  const resolved = stats?.decided ?? stats?.wins ?? stats?.totalSignals ?? 0;
  const s = stats ? `📊 Signals: ${total}  📈 Win Rate: ${wr}% (${resolved} resolved)\n` : `📊 Signals: —  worker loading…\n`;
  return `FTT Signal Bot v5.0\n${SEP}\n` +
    `💱 ${esc(disp(u.pair))} · ${u.interval}min · ${modeLabel(u.fxMode)}\n` +
    `🔄 Auto: ${u.autoEnabled ? 'ON ✅' : 'OFF'}  👁 Watchlist: ${u.watchlist.length} pairs\n` +
    `🎯 Grade: ${esc(u.gradeFilter || 'ALL')}  🤖 AI Only: ${u.aiOnlyMode ? 'ON' : 'OFF'}\n` +
    `📰 News Block: ${u.blockNews !== false ? 'ON' : 'OFF'}\n` +
    `${SEP}\n` +
    s +
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
      ? `🔄 <i>Replay only — not tracked</i>`
      : `⏳ <i>Result via worker push</i>`;
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

// ── WORKER-BACKED FORMATTERS (thin client) ──────────────────────────────
function fmtWorkerHist(workerData, page = 0) {
  const signals = workerData.signals || workerData.history || [];
  const total = workerData.total ?? signals.length;
  const per = 10;
  const start = page * per;
  const seen = new Set();
  const deduped = [];
  for (const s of signals) {
    const id = s.id || s.signalId;
    if (!id) { deduped.push(s); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(s);
  }
  if (!deduped.length) return `📈 History\n${SEP}\nNo signals yet for this pair.\n\n💡 Tap 📊 Signal Now to generate one.\n\n<i>Worker = single source · per-pair global</i>`;
  const slice = deduped.slice(start, start + per);
  if (!slice.length) return `📈 History\n${SEP}\nNo more signals on this page.`;
  let msg = `📈 History (${start + 1}-${start + slice.length} of ${total}) · ${esc(disp(workerData.pair||''))}\n${SEP}\n`;
  for (const s of slice) {
    const dir = s.direction || s.finalSignal || '?';
    const dE = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '⚪';
    const result = s.result || 'PENDING';
    const rE = result === 'WIN' ? '✅' : result === 'LOSS' ? '❌' : result === 'SKIP' ? '⏭' : result === 'CANCEL' ? '🗑' : '⏳';
    const conf = s.confidence || '';
    const gradeRaw = s.grade;
    const gradeStr = gradeRaw ? (gradeRaw.grade || gradeRaw || '') : '';
    const g = gradeStr ? ` [${esc(gradeStr)}]` : '';
    const pairDisp = disp(s.pair || workerData.pair || '');
    const id = s.id || s.signalId || '';
    const short = id ? id.slice(-6) : '------';
    const fill = s.fillStatus ? ` ${esc(s.fillStatus)}` : '';
    const entryHit = s.entryHit === true ? ' ✓' : s.entryHit === false ? ' ✗' : '';
    const entry = s.entryPrice ? ` @${fmtPrice(s.entryPrice, s.pair)}` : '';
    const timeStr = s.timestamp || s.createdAt || s.expiryTime || '';
    let timeDisp = '';
    if (timeStr) { try { timeDisp = new Date(timeStr).toUTCString().slice(5, 17); } catch { timeDisp = String(timeStr).slice(0,16); } }
    const resultDisp = result === 'WIN' || result === 'LOSS' ? ` ${result}` : '';
    msg += `${rE} ${dE} ${esc(pairDisp).padEnd(8)} ${esc(conf).padStart(4)}${g}${resultDisp}  ${esc(short)}${fill}${entryHit}${entry}  ${esc(timeDisp)}\n`;
  }
  msg += `\n<i>Tap a row's short id to override: /win &lt;id&gt; /loss &lt;id&gt;</i>`;
  return msg;
}
function fmtWorkerStats(workerStats, pair) {
  const s = workerStats.stats || workerStats;
  const total = s.totalSignals ?? s.total ?? 0;
  const wins = s.wins ?? 0;
  const losses = s.losses ?? 0;
  const wr = s.winRate ?? (total>0?Math.round(wins/total*100):0);
  const sample = s.sampleSize ?? total;
  const pending = s.pending ?? 0;
  let msg = `🏆 Win/Loss Stats · ${esc(disp(pair))}\n${SEP}\n`;
  msg += `✅ Wins: ${wins}  ❌ Losses: ${losses}\n`;
  msg += `📊 Win Rate: ${wr}% (${sample} trades)\n`;
  if (pending) msg += `⏳ Pending: ${pending}\n`;
  if (s.byRegime && Object.keys(s.byRegime).length) {
    msg += `\n📊 By Regime:\n`;
    const rE = { TRENDING:'🔵', RANGING:'🟡', BREAKOUT:'🟠', VOLATILE:'🔴' };
    for (const [r, v] of Object.entries(s.byRegime)) {
      const w = v.w ?? v.wins ?? 0; const l = v.l ?? v.losses ?? 0; const t2 = w+l; if (!t2) continue;
      const pct = Math.round(w/t2*100);
      msg += `  ${rE[r]||'⚪'} ${r}: ${w}W/${l}L (${pct}%) ${pct>=55?'✅':pct>=45?'⚠️':'❌'}\n`;
    }
  }
  if (s.bySession && Object.keys(s.bySession).length) {
    msg += `\n⏰ By Session:\n`;
    for (const [sess, v] of Object.entries(s.bySession)) {
      const w = v.w ?? v.wins ?? 0; const l = v.l ?? v.losses ?? 0; const t2 = w+l; if (!t2) continue;
      const pct = Math.round(w/t2*100);
      msg += `  ${sess}: ${w}W/${l}L (${pct}%) ${pct>=55?'✅':pct>=45?'⚠️':'❌'}\n`;
    }
  }
  msg += `\n<i>Worker = single source</i>`;
  return msg;
}
function fmtWorkerBest(allStats) {
  const ranked = allStats.map(({pair, stats}) => {
    const s = stats.stats || stats;
    const wins = s.wins ?? 0; const losses = s.losses ?? 0; const t2 = wins+losses;
    const pct = t2 ? Math.round(wins/t2*100) : 0;
    return { pair, w:wins, l:losses, t:t2, pct };
  }).filter(x => x.t >= 3).sort((a,b) => b.pct - a.pct || b.t - a.t);
  if (!ranked.length) return `🔥 Best Pairs\n${SEP}\nNeed at least 3 resolved trades per pair (worker).`;
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  let msg = `🔥 Best Pairs Leaderboard (worker)\n${SEP}\n`;
  ranked.slice(0, 7).forEach((x, i) => {
    const bar  = '█'.repeat(Math.round(x.pct/10)) + '░'.repeat(10-Math.round(x.pct/10));
    const icon = x.pct >= 60 ? '✅' : x.pct >= 45 ? '⚠️' : '❌';
    msg += `${medals[i]||'  '} ${disp(x.pair).padEnd(8)} ${bar} ${x.pct}% (${x.w}W/${x.l}L) ${icon}\n`;
  });
  if (ranked.length > 7) msg += `...+${ranked.length - 7} more pairs\n`;
  msg += `\n💡 Tip: Add top pairs to your Watchlist`;
  return msg;
}
function fmtWorkerHeatmap(workerData) {
  const signals = workerData.signals || workerData.history || [];
  const resolved = signals.filter(s => s.result === 'WIN' || s.result === 'LOSS');
  if (!resolved.length) return `🕐 Hourly Heatmap\n${SEP}\nNo resolved trades yet (worker).`;
  const hmap = {};
  for (const s of resolved) {
    const ts = new Date(s.timestamp || s.createdAt || s.expiryTime).getTime();
    if (isNaN(ts)) continue;
    const hour = new Date(ts).getUTCHours();
    if (!hmap[hour]) hmap[hour] = { w:0, l:0 };
    s.result === 'WIN' ? hmap[hour].w++ : hmap[hour].l++;
  }
  const entries = Object.entries(hmap).map(([hr, v]) => {
    const t2 = v.w+v.l;
    return { hr: parseInt(hr), w:v.w, l:v.l, t:t2, pct: Math.round(v.w/t2*100) };
  }).sort((a,b)=>a.hr-b.hr);
  let msg = `🕐 Win Rate by Hour (UTC) · ${esc(disp(workerData.pair||''))}\n${SEP}\n`;
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
  msg += `\n<i>Worker history · per-pair global</i>`;
  return msg;
}
function fmtWorkerRisk(workerData) {
  const signals = workerData.signals || workerData.history || [];
  const pending = signals.filter(s => !s.result || s.result === 'PENDING' || s.result === null);
  if (!pending.length) return `📉 Open Risk Dashboard\n${SEP}\nNo open trades — nice and clean. ✅\n\n<i>Worker pending for ${esc(disp(workerData.pair||''))}</i>`;
  let msg = `📉 Open Risk Dashboard · ${esc(disp(workerData.pair||''))}\n${SEP}\n${pending.length} open trade(s) (worker)\n`;
  const exposure = {};
  for (const s of pending) {
    const exp = getCurrencyExposure(s.pair || workerData.pair, s.direction);
    for (const [cur, side] of Object.entries(exp)) {
      if (!exposure[cur]) exposure[cur] = { long:0, short:0 };
      exposure[cur][side]++;
    }
  }
  for (const s of pending.slice(0, 10)) {
    const dE = s.direction === 'BUY' ? '🟢' : '🔴';
    const short = (s.id||'').slice(-6);
    const conf = s.confidence || '';
    const grade = s.grade ? ` [${esc(s.grade.grade||s.grade)}]` : '';
    msg += `${dE} ${short} ${s.direction} ${esc(disp(s.pair||workerData.pair))}${grade} ${esc(conf)}\n`;
    if (s.entryPrice) msg += `   Entry: ${esc(fmtPrice(s.entryPrice, s.pair||workerData.pair))}\n`;
  }
  if (pending.length > 10) msg += `...+${pending.length-10} more\n`;
  return msg;
}

function fmtHist(hist, page = 0) {function fmtHist(hist, page = 0) {
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

  // Manual WIN/LOSS → worker /api/report (thin client, idempotent)
  if (text.startsWith('/win ') || text.startsWith('/loss ')) {
    const parts  = text.split(/\s+/);
    const result = text.startsWith('/win') ? 'WIN' : 'LOSS';
    const idStr  = parts[1] ? parts[1].trim() : '';
    if (!idStr) return R(`❌ Usage: /win <signalId>  or  /loss <signalId>\n\nTip: use the short 6-char id from /history`, mainKb(u));
    return doManualResult(cid, null, idStr, result, env);
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
    return R(`<b>FTT Signal Bot — Commands (v5 thin-client)</b>\n\n📊 <b>Core:</b>\n/signal — get signal (worker)\n/scan — scan all pairs (worker)\n/auto — toggle auto preference\n\n📈 <b>Analytics (worker):</b>\n/history — trade history (worker)\n/stats — win rate stats (worker)\n/today — today's performance (worker)\n/summary — daily summary (worker)\n/best — best pairs leaderboard (worker)\n/risk — risk dashboard (worker pending)\n/heatmap — win rate by hour (worker)\n\n⚙️ <b>Settings:</b>\n/pair EURUSD — set pair\n/interval 5 — set interval\n/watchlist — manage watchlist\n/replay EURUSD — analyze without logging\n/setchannel — mirror to channel\n/win <id> /loss <id> — manual override via worker /api/report\n\n💡 <i>Worker = single source · per-pair global</i>`, mainKb(u));

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
  // Previously, if doRisk/doBest/doHeatmap threw (e.g. from a
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
    let stats = null;
    try { stats = await fetchWorkerStats(u.pair, env); } catch {}
    const s = stats?.stats || stats;
    return R(fmtMainMenu(u, s), mainKb(u));
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

  // [Bug#2 FIX] cmd:cancelall was used in Risk Dashboard button but had no handler
  if (data === 'cmd:cancelall')   return doCancelAll(cid, mid, env);

  if (data.startsWith('qs:')) return doQuickSignal(cid, mid, data.slice(3), env);
  if (data.startsWith('res:win:'))  return doManualResult(cid, mid, data.slice(8), 'WIN', env);
  if (data.startsWith('res:loss:')) return doManualResult(cid, mid, data.slice(9), 'LOSS', env);
}

// ─── ACTION FUNCTIONS ─────────────────────────────────────────────────────────

// Shared helper: restore original message with main menu after sending a signal card
async function restoreMainMsg(cid, mid, u, env) {
  if (!mid) return;
  let stats = null;
  try { stats = await fetchWorkerStats(u.pair, env); } catch {}
  const s = stats?.stats || stats;
  await editMsg(cid, mid, fmtMainMenu(u, s), env, { reply_markup: mainKb(u) });
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
    const dir = sig?.finalSignal || sig?.direction;
    let corrWarnings = [];
    let signalId = null;
    if (dir === 'BUY' || dir === 'SELL') {
      corrWarnings = await checkCorrelated(cid, u.pair, dir, env);
      signalId = sig.id || sig.signalId || data.id || null;
    }
    const useKb  = (dir === 'BUY' || dir === 'SELL') ? signalKb(signalId) : afterKb();
    await sendMsg(cid, fmtSignal(data, u.pair, u.interval, signalId, { newsAlert, correlated: corrWarnings, mode: normMode(u.fxMode) }), env, { reply_markup: useKb });
    // Restore button message (button flow) or delete loading msg (text command flow)
    if (mid) {
      await restoreMainMsg(cid, mid, u, env);
    } else if (loadingMid) {
      await deleteMsg(cid, loadingMid, env);
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
    const dir = sig?.finalSignal || sig?.direction;
    let corrWarnings = [];
    let signalId = null;
    if (dir === 'BUY' || dir === 'SELL') {
      corrWarnings = await checkCorrelated(cid, pair, dir, env);
      signalId = sig.id || sig.signalId || data.id || null;
    }
    const useKb  = (dir === 'BUY' || dir === 'SELL') ? signalKb(signalId) : afterKb();
    await sendMsg(cid, fmtSignal(data, pair, u.interval, signalId, { newsAlert, correlated: corrWarnings, mode: normMode(u.fxMode) }), env, { reply_markup: useKb });
    if (mid) {
      await restoreMainMsg(cid, mid, u, env);
    } else if (loadingMid) {
      await deleteMsg(cid, loadingMid, env);
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
      const dir  = sig?.finalSignal || sig?.direction;
      if ((dir === 'BUY' || dir === 'SELL') && passGrade(sig, u.gradeFilter) && passConf(sig, u.minConfidence) && passAI(sig, u.aiOnlyMode)) {
        const corrWarnings = await checkCorrelated(cid, pair, dir, env);
        const signalId = sig.id || sig.signalId || data.id || null;
        await sendMsg(cid, fmtSignal(data, pair, u.interval, signalId, { correlated: corrWarnings, mode: normMode(u.fxMode) }), env, { reply_markup: signalKb(signalId) });
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
  await saveUser(cid, u, env);
  if (u.autoEnabled) {
    await addAutoUser(cid, env);
  } else {
    await removeAutoUser(cid, env);
  }
  const wl = u.watchlist.map(disp).join(', ');
  const t  = u.autoEnabled
    ? `🔄 Auto preference ON\n${SEP}\n${esc(disp(u.pair))}${wl ? '\nWatchlist: ' + esc(wl) : ''}\nInterval: ${u.interval}min  Grade: ${esc(u.gradeFilter || 'ALL')}\nAI Only: ${u.aiOnlyMode ? 'ON' : 'OFF'}  News Block: ${u.blockNews !== false ? 'ON' : 'OFF'}\n\n<i>Worker push is the single delivery path — this toggle is a preference for future App sync</i>`
    : `🔕 Auto preference OFF\n${SEP}\nAuto preference stopped. Worker push still delivers if subscribed at worker level.`;
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
  let stats = null;
  try { stats = await fetchWorkerStats(u.pair, env); } catch {}
  const s = stats?.stats || stats;
  const total = s?.totalSignals ?? s?.total ?? '—';
  const wr = s?.winRate ?? '—';
  const pending = s?.pending ?? '—';
  const t = `📋 Status\n${SEP}\nPair: ${esc(disp(u.pair))}\nWatchlist: ${u.watchlist.map(disp).join(', ') || 'None'}\nInterval: ${u.interval}min\nAuto: ${u.autoEnabled ? 'ON' : 'OFF'} (preference)\nGrade: ${esc(u.gradeFilter || 'ALL')}\nMin Conf: ${u.minConfidence || 0}%\nAI Only: ${u.aiOnlyMode ? 'ON' : 'OFF'}\nNews Block: ${u.blockNews !== false ? 'ON' : 'OFF'}\nSummary: ${u.dailySummary ? 'ON' : 'OFF'}\nChannel: ${u.channelId ? esc(String(u.channelId)) : 'None'}\nWorker Total: ${total}  Pending: ${pending}  Win Rate: ${wr}%`;
  return reply(cid, mid, t, env, kb([[btn('⚙️ Settings', 'cmd:settings'), btn('📉 Risk', 'cmd:risk')], backQuick()]));
}

async function doHist(cid, mid, page, env) {
  const u = await getUser(cid, env);
  const limit = page * 10 + 10;
  try {
    const data = await fetchWorkerHistory(u.pair, limit, env);
    return reply(cid, mid, fmtWorkerHist(data, page), env, histNavKb(page, data.total ?? (data.signals||[]).length));
  } catch (e) {
    return reply(cid, mid, `❌ History fetch failed\n\n${SEP}\n⚠️ ${esc(e.message.slice(0,150))}\n\n<i>Worker /api/history?pair=${esc(u.pair)}&limit=${limit}</i>`, env, histNavKb(page, 0));
  }
}

async function doStats(cid, mid, env) {
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerStats(u.pair, env);
    return reply(cid, mid, fmtWorkerStats(data, u.pair), env, kb([[btn('📈 History', 'cmd:history:0'), btn('📒 Journal', 'cmd:journal'), btn('🔥 Best', 'cmd:best')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Stats fetch failed\n\n${SEP}\n⚠️ ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doJournal(cid, mid, env) {
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerHistory(u.pair, 100, env);
    const signals = data.signals || data.history || [];
    const today = new Date().toISOString().slice(0, 10);
    const th = signals.filter(s => (s.timestamp||s.createdAt||'').startsWith(today));
    if (!th.length) return reply(cid, mid, `📒 Journal — ${today}\n${SEP}\nNo signals today for ${esc(disp(u.pair))}.`, env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
    const res  = th.filter(s => s.result === 'WIN' || s.result === 'LOSS');
    const wins = res.filter(s => s.result === 'WIN').length;
    const wr   = res.length ? Math.round(wins/res.length*100) : 0;
    let msg = `📒 Trade Journal — ${today} · ${esc(disp(u.pair))}\n${SEP}\n📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length-wins}L  📈 ${wr}%\n\n`;
    for (const s of th.slice(0,10)) {
      const dE = s.direction === 'BUY' ? '🟢' : '🔴';
      const rE = s.result === 'WIN' ? '✅' : s.result === 'LOSS' ? '❌' : '⏳';
      const short = (s.id||'').slice(-6);
      msg += `${rE} ${dE} ${esc(disp(s.pair||u.pair))} ${esc(s.confidence||'')} [${esc(s.grade?.grade||s.grade||'?')}] ${esc(short)}\n`;
    }
    if (th.length>10) msg += `...+${th.length-10} more\n`;
    return reply(cid, mid, msg, env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Journal failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doWeekly(cid, mid, env) {
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerHistory(u.pair, 100, env);
    const signals = data.signals || data.history || [];
    const now = new Date();
    const day = now.getUTCDay(), diff = day === 0 ? 6 : day - 1;
    const mon = new Date(now);
    mon.setUTCDate(now.getUTCDate() - diff);
    const weekStart = mon.toISOString().slice(0,10);
    const wh = signals.filter(s => (s.timestamp||s.createdAt||'') >= weekStart);
    const res = wh.filter(s => s.result==='WIN'||s.result==='LOSS');
    const wins = res.filter(s=>s.result==='WIN').length;
    const wr = res.length?Math.round(wins/res.length*100):0;
    let msg = `📅 Weekly Report — Week of ${weekStart} · ${esc(disp(u.pair))}\n${SEP}\n📊 ${wh.length} signals  ✅ ${wins}W ❌ ${res.length-wins}L\n📈 Win Rate: ${wr}%\n`;
    if (res.length) {
      const pm = {};
      for (const s of res) {
        const p = s.pair||u.pair;
        if (!pm[p]) pm[p]={w:0,l:0};
        s.result==='WIN'?pm[p].w++:pm[p].l++;
      }
      msg += `\nTop this week:\n`;
      Object.entries(pm).sort((a,b)=> (b[1].w+b[1].l)-(a[1].w+a[1].l)).slice(0,3).forEach(([p,s])=>{
        const t=s.w+s.l; msg+=`  ${disp(p)}: ${s.w}W/${s.l}L (${Math.round(s.w/t*100)}%)\n`;
      });
    }
    msg += `\n🔄 Keep trading the best regimes next week!`;
    return reply(cid, mid, msg, env, kb([[btn('🏆 Stats', 'cmd:stats'), btn('📒 Journal', 'cmd:journal')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Weekly failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doRisk(cid, mid, env) {
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerHistory(u.pair, 50, env);
    return reply(cid, mid, fmtWorkerRisk(data), env, kb([[btn('📈 History', 'cmd:history:0')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Risk fetch failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doHeatmap(cid, mid, env) {
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerHistory(u.pair, 100, env);
    return reply(cid, mid, fmtWorkerHeatmap(data), env, kb([[btn('🏆 Stats', 'cmd:stats'), btn('🔥 Best Pairs', 'cmd:best')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Heatmap failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doBest(cid, mid, env) {
  try {
    const pairs = PAIR_PAGES.flat().map(p=>norm(p));
    const results = await Promise.all(pairs.map(async p=>{
      try {
        const data = await fetchWorkerStats(p, env);
        return { pair: p, stats: data };
      } catch { return null; }
    }));
    const valid = results.filter(Boolean);
    if (valid.length < 3) {
      try {
        const latest = await fetchWorkerLatest(env);
        if (latest.byPair) {
          const alt = Object.entries(latest.byPair).map(([pair, stat])=> ({pair, stats: stat}));
          return reply(cid, mid, fmtWorkerBest(alt), env, kb([[btn('🕐 Heatmap', 'cmd:heatmap'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
        }
      } catch {}
    }
    return reply(cid, mid, fmtWorkerBest(valid), env, kb([[btn('🕐 Heatmap', 'cmd:heatmap'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Best fetch failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

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
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerHistory(u.pair, 100, env);
    const signals = data.signals || data.history || [];
    const today = new Date().toISOString().slice(0, 10);
    const th    = signals.filter(s => (s.timestamp||s.createdAt||'').startsWith(today));
    if (!th.length) return reply(cid, mid, `📅 Today (${today})\n${SEP}\nNo signals yet for ${esc(disp(u.pair))} (worker).`, env, kb([backQuick()]));
    const res  = th.filter(s => s.result === 'WIN' || s.result === 'LOSS');
    const wins = res.filter(s => s.result === 'WIN').length;
    const wr   = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
    let t = `📅 Today — ${today} · ${esc(disp(u.pair))}\n${SEP}\n📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n\n`;
    for (const s of th.slice(0, 8)) {
      const dE = s.direction === 'BUY' ? '🟢' : '🔴';
      const rE = s.result === 'WIN' ? '✅' : s.result === 'LOSS' ? '❌' : '⏳';
      const short = (s.id||'').slice(-6);
      t += `${rE} ${dE} ${esc(disp(s.pair||u.pair))} ${esc(short)} ${esc(s.confidence||'')} [${esc(s.grade?.grade||s.grade||'?')}]\n`;
    }
    return reply(cid, mid, t, env, kb([[btn('📈 History', 'cmd:history:0'), btn('📉 Risk', 'cmd:risk')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Today failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doSummary(cid, mid, env) {
  const u = await getUser(cid, env);
  try {
    const data = await fetchWorkerHistory(u.pair, 100, env);
    const signals = data.signals || data.history || [];
    const today = new Date().toISOString().slice(0, 10);
    const th    = signals.filter(s => (s.timestamp||s.createdAt||'').startsWith(today));
    if (!th.length) return reply(cid, mid, `No signals today yet for ${esc(disp(u.pair))}.`, env, kb([backQuick()]));
    const res   = th.filter(s => s.result === 'WIN' || s.result === 'LOSS');
    const wins  = res.filter(s => s.result === 'WIN').length;
    const wr    = res.length > 0 ? Math.round(wins / res.length * 100) : 0;
    const allRes = signals.filter(s => s.result==='WIN'||s.result==='LOSS');
    const allWins = allRes.filter(s=>s.result==='WIN').length;
    const allWR = allRes.length ? Math.round(allWins/allRes.length*100) : 0;
    const trend = wr > allWR ? '📈 Above avg' : wr < allWR ? '📉 Below avg' : '➡️ On avg';
    let t = `📅 Daily Summary — ${today} · ${esc(disp(u.pair))}\n${SEP}\n📊 ${th.length} signals  Resolved: ${res.length}\n✅ ${wins}W  ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n`;
    const gm = {};
    for (const s of res) {
      const g = (s.grade?.grade||s.grade||'?');
      const key = String(g).split(' ')[0];
      if (!gm[key]) gm[key]={w:0,l:0};
      s.result==='WIN'?gm[key].w++:gm[key].l++;
    }
    if (Object.keys(gm).length) {
      t += `\nGrades:\n`;
      for (const [g, v] of Object.entries(gm)) {
        const tt=v.w+v.l;
        t+=`  ${esc(g)}: ${v.w}W/${v.l}L (${Math.round(v.w/tt*100)}%)\n`;
      }
    }
    t += `\n${trend} (all-time: ${allWR}% worker)`;
    return reply(cid, mid, t, env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Summary failed: ${esc(e.message.slice(0,150))}`, env, kb([backQuick()]));
  }
}

async function doCancelAll(cid, mid, env) {
  const u = await getUser(cid, env);
  return reply(cid, mid, `ℹ️ Cancel not needed — worker handles expiry automatically.\n${SEP}\nBot no longer keeps its own pending ledger (worker = single source).\n\nPending signals resolve via worker */2 cron + Phase 10 push.\n\nUse /risk to see worker pending for ${esc(disp(u.pair))}.`, env, mainKb(u));
}

async function doManualResult(cid, mid, signalId, result, env) {
  const u = await getUser(cid, env);
  const idStr = String(signalId).trim();
  if (!idStr) return reply(cid, mid, `❌ No signal id provided.`, env, mainKb(u));
  let fullId = idStr;
  if (idStr.length <= 7) {
    try {
      const data = await fetchWorkerHistory(u.pair, 50, env);
      const signals = data.signals || data.history || [];
      const found = signals.find(s => (s.id||'').endsWith(idStr) || (s.id||'').slice(-6)===idStr || (s.id||'')===idStr);
      if (found && found.id) fullId = found.id;
    } catch {}
  }
  try {
    await postWorkerReport(fullId, result, env);
    const short = String(fullId).slice(-6);
    const rE = result === 'WIN' ? '✅ WIN' : '❌ LOSS';
    return reply(cid, mid,
      `${rE} — reported to worker\n${SEP}\n📌 Signal <b>${esc(short)}</b> → <b>${result}</b>\n${esc(disp(u.pair))}\n\n<i>Worker /api/report?id=${esc(fullId)}&result=${result} (idempotent)</i>`,
      env, kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')], backQuick()]));
  } catch (e) {
    return reply(cid, mid, `❌ Report failed\n\n${SEP}\n⚠️ ${esc(e.message.slice(0,200))}\n\n<i>Tried POST /api/report?id=${esc(fullId)}&result=${result}</i>`, env, mainKb(u));
  }
}

const workerModeParam = (m) => (m === 'fx' || m === 'both' || m === true) ? '&mode=fx' : '';
const normMode = (m) => { if (m === 'fx' || m === 'both') return m; return 'ftt'; };

async function fetchSig(pair, env, opts = {}) {
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


async function cronLite(env) {
  const logs = [];
  const log = m => { console.log(m); logs.push(String(m)); };
  log(`CronLite ${new Date().toISOString()} — thin client, worker is single source`);
  if (!env?.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing'); return; }
  if (!env?.BOT_KV)    { log('ERROR: BOT_KV missing');    return; }
  await dailySummary(env, log).catch(e => log('SummaryErr: ' + e.message));
  await weeklyReport(env, log).catch(e => log('WeeklyErr: ' + e.message));
  log('Done');
}

// Full cron (thin client — for /runcron debug)
async function cron(env, logs = [], force = false) {
  const log = m => { console.log(m); logs.push(String(m)); };
  log(`Cron ${new Date().toISOString()} — thin client`);
  if (!env?.BOT_TOKEN) { log('ERROR: BOT_TOKEN missing'); return; }
  if (!env?.BOT_KV)    { log('ERROR: BOT_KV missing');    return; }
  await dailySummary(env, log).catch(e => log('SummaryErr: ' + e.message));
  await weeklyReport(env, log).catch(e => log('WeeklyErr: ' + e.message));
  log('Done');
}

// autoScan REMOVED — worker push is single source (thin client)
// Kept as deprecated no-op for backward compat; does not write ledger.
async function autoScan(env, log) {
  log('autoScan deprecated — worker push only (thin client)');
}


// resultCheck REMOVED — worker */2 cron resolves + Phase 10 pushes results.
// Bot no longer resolves pt: trades.
async function resultCheck(env, log) {
  log('resultCheck deprecated — worker handles results');
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
      let data;
      try { data = await fetchWorkerHistory(u.pair, 100, env); } catch (e) { log(`Summary fetch fail ${cid}: ${e.message}`); continue; }
      const signals = data.signals || data.history || [];
      const today = new Date().toISOString().slice(0, 10);
      const th    = signals.filter(s => (s.timestamp||s.createdAt||'').startsWith(today));
      if (!th.length) continue;
      const res  = th.filter(s => s.result === 'WIN' || s.result === 'LOSS');
      const wins = res.filter(s => s.result === 'WIN').length;
      const wr   = res.length ? Math.round(wins / res.length * 100) : 0;
      const gm = {};
      for (const s of res) {
        const g = (s.grade?.grade||s.grade||'?');
        const key = String(g).split(' ')[0];
        if (!gm[key]) gm[key]={w:0,l:0};
        s.result==='WIN'?gm[key].w++:gm[key].l++;
      }
      let sumT = `📅 Daily Summary — ${today} · ${esc(disp(u.pair))}\n${SEP}\n📊 ${th.length} signals  ✅ ${wins}W ❌ ${res.length - wins}L\n📈 Win Rate: ${wr}%\n⏳ Pending: ${th.filter(s=>!s.result||s.result==='PENDING').length}`;
      if (Object.keys(gm).length) {
        sumT += `\n${SEP}\nGrades:\n`;
        for (const [g, v] of Object.entries(gm)) {
          const tt=v.w+v.l;
          sumT+=`  ${esc(g)}: ${v.w}W/${v.l}L (${Math.round(v.w/tt*100)}%)\n`;
        }
      }
      sumT += `\n<i>Worker history · per-pair global</i>`;
      await sendMsg(cid, sumT, env, { reply_markup: kb([[btn('📈 History', 'cmd:history:0'), btn('🏆 Stats', 'cmd:stats')]]) });
      await kput(`ds:${cid}`, Date.now(), env);
      log(`Summary sent to ${cid}`);
    } catch (e) { log(`Summary ${cid}: ${e.message}`); }
  }
}


async function expiryReminder(env, log) {
  log('expiryReminder deprecated — worker covers');
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
      let data;
      try { data = await fetchWorkerHistory((await getUser(cid, env)).pair, 100, env); } catch (e) { log(`Weekly fetch fail ${cid}: ${e.message}`); continue; }
      const signals = data.signals || data.history || [];
      const day2 = now.getUTCDay(), diff = day2 === 0 ? 6 : day2 - 1;
      const mon = new Date(now); mon.setUTCDate(now.getUTCDate() - diff);
      const weekStart = mon.toISOString().slice(0,10);
      const wh = signals.filter(s => (s.timestamp||s.createdAt||'') >= weekStart);
      const res = wh.filter(s=> s.result==='WIN'||s.result==='LOSS');
      const wins = res.filter(s=>s.result==='WIN').length;
      const wr = res.length?Math.round(wins/res.length*100):0;
      let msg = `📅 Weekly Report — Week of ${weekStart}\n${SEP}\n📊 ${wh.length} signals  ✅ ${wins}W ❌ ${res.length-wins}L\n📈 Win Rate: ${wr}%\n<i>Worker · ${esc(disp((await getUser(cid,env)).pair))}</i>`;
      await sendMsg(cid, msg, env, { reply_markup: kb([[btn('🏆 Stats', 'cmd:stats'), btn('📒 Journal', 'cmd:journal')],[btn('🔥 Best Pairs', 'cmd:best'), btn('🔙 Menu', 'cmd:main')]]) });
      await kput(lastKey, Date.now(), env);
      log(`Weekly sent to ${cid}`);
    } catch (e) { log(`Weekly ${cid}: ${e.message}`); }
  }
}


// checkMilestone REMOVED — was based on bot h:; worker stats now single source
async function checkMilestone(cid, env) {
  // no-op thin client
}

