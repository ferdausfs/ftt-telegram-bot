# CHANGES — v4.4 Arena-style Menu Redesign (+ v4.3 Premium UX)

PR: `arena/019fd350-ftt-telegram-bot` → `main` (reviewer must approve before merge; no direct push to main).

---

## 0. v4.4 — Arena hub menu (matches Arena screenshot)

Main menu is a **clean 2×3 category grid** like Arena's attachment menu — not a long list of every feature.

### Main hub (`mainKb`) — Arena layout

```
📊 Signal Now          👁 Watchlist
🚀 Premium             ⚡ Quick actions
📈 History             ⚙️ Settings
```

Maps to Arena slots:
| Arena | FTT Bot |
|-------|---------|
| New chat | 📊 Signal Now |
| Photo Styles | 👁 Watchlist |
| Premium | 🚀 Premium |
| Quick actions | ⚡ Quick actions |
| Chat history | 📈 History |
| Settings | ⚙️ Settings |

### ⚡ Quick actions submenu (`quickKb`)

```
📊 Signal Now     🔄 Start Auto / 🔕 Stop Auto
🔍 Scan All       📋 Status
📅 Today   📊 Weekly   🔥 Best
📉 Risk    🕐 Heatmap  📒 Journal
🏆 Stats   📋 Summary
🔙 Back → main hub
```

- Auto toggle stays on Quick actions
- Explore screens Back → Quick actions + 🏠 Menu

### Settings — unified + Mode prominent

Mode full-width cycle · Grade/Conf/Interval/Pair · AI Only/News/Alerts/Replay/Summary · Channel/Export · Back

### 🚀 Premium placeholder

Future features list. **Honesty:** informational only — no payment.

### No regression

All cmds intact. New: `cmd:quick`, `cmd:premium`, `cmd:exportinfo`.

### Verification

```
$ node --check src/index.js     → SYNTAX OK
$ node menu-test.mjs            → 🎉 ALL MENU TESTS PASSED
```


## 0b. v4.3 — Result/History premium + entryHit (final polish)

### Premium result card
```
📌 Signal #12 · 🎯 TP hit · +3min
✅ WIN — 🟢 EUR/USD [A+ EXCELLENT]
━━━━━━━━━━━━━━━━━
💰 Entry: 1.08000 → Exit: 1.08550
🎯 Result: WIN +55 pips (+0.51%)
━━━━━━━━━━━━━━━━━
⚡ Entry hit ✓ — price reached entry
```
- WIN ✅ / LOSS ❌ colored, direction + grade on the header line
- Entry → Exit + pips/percent (`+$186.04` crypto, `+55 pips` FX)
- Notes line: signal # + hit note (`🎯 TP hit` / `🛑 SL hit` / `⏰ 60min horizon`) + late minutes
- **Entry hit/miss line** (worker-এর entryHit-এর bot-side equivalent):
  - `⚡ Entry hit ✓ — price reached entry` (INSTANT fills always hit)
  - `⚠️ Entry miss — price never reached entry (result may be misleading)` — PENDING_ENTRY fills যেটা entry-তে পৌঁছায়নি → "ভুয়া WIN/LOSS" চেনার উপায়
- Implementation: `logAndSchedule` now stores `fillStatus`; `resultCheck` observes the entry level on every in-window poll (`noteEntryTouch`, stored on the pending trade) — FX already polls, FTT pending-fills now poll too.

### History / summaries
- `fmtHist` pending rows show live countdown (`⏳ 3m 41s left`), resolved rows keep date + pips
- Cron `dailySummary` now includes the grades breakdown (matches interactive /summary)
- `fmtSignal` AI block leveled: `🤖 AI: ✅ AGREE — BUY (88%)` / `⚠️ DISAGREE` / `🤔 UNCERTAIN`
- D2 filters as code badges: `🚫 Blocked: <code>D2_CONF_55</code> <code>BLOCK_NEWS</code>`
- News warning clean 2-line block: `⚠️ High-impact news in 8min` / `📰 US CPI (USD)` (or `3min ago`)

### Verification (v4.3)
```
$ node --check src/index.js          → SYNTAX OK
$ node render-test.mjs               → 🎉 ALL TESTS PASSED (39 checks)
$ node logic-test.mjs                → 🎉 ALL LOGIC TESTS PASSED (28 checks:
                                        entry hit/miss, FX TP/SL, pending-fill
                                        touch tracking, FTT path, SKIP, countdown)
```

---

## 1. v4.2 — Premium message design

## 1. Premium message design

### 1a. Signal message (`fmtSignal`) — rewritten as a leveled premium card

```
📌 Signal No. 42
📊 BTC/USD | 5min | 💹 FX
━━━━━━━━━━━━━━━━━
🟢 BUY 🟢 92%  [A+ EXCELLENT]
━━━━━━━━━━━━━━━━━
💰 Entry: 63813.96
🛑 SL: 63900.00
🎯 TP: 63500.00  (1:2.5)
⚡ INSTANT — take now
━━━━━━━━━━━━━━━━━
📈 HTF: BUY · 🟡 Regime: RANGING
✅ Structure: ALIGNED (BUY STRONG)
💡 Range edges — fade extremes.
━━━━━━━━━━━━━━━━━
📝 EMA trend favors BUY · RSI bullish (61)
🤖 AI: ✅ Agrees — BUY (88%)
━━━━━━━━━━━━━━━━━
⏳ Result tracked automatically
```

- **Separators**: single `SEP` constant (19× `━`) divides sections → clear hierarchy. All cards use the same separator.
- **Signal line**: direction + confidence + grade in one row — `🟢 BUY 🟢 92% [A+ EXCELLENT]` (BUY green / SELL red, confidence dot 🟢≥85 / 🟡≥70 / 🔴<70).
- **FX mode**: SL/TP prominent with RR `(1:2.5)`; FTT mode shows Expiry + candle countdown; BOTH shows both.
- **Fill status always shown** — `⚡ INSTANT — take now` / `⏳ PENDING — price away from entry (x%), wait for fill`. Defaults to INSTANT when the worker omits `fillStatus`.
- **HTF · Regime · Structure** on compact rows; regime advice as 💡 line.
- **AI validation compact**: `🤖 AI: ✅ Agrees — BUY (88%)` (+ 💬 reason / 🔍 concerns).
- **NO_TRADE / CLOSED / no-data states**: clean empty-state cards with a hint (`💡 Next check at the next 5min candle close`), not bare text.
- **No MarkdownV2 anywhere** — `parse_mode:'HTML'` with every dynamic value passed through `esc()`.

### 1b. Other messages

- **`fmtHist`** — aligned columns (`#`/pair/conf/grade/pips/time), premium separator, friendly empty state.
- **Result push card** (`resultCheck`) — `📊 Result — Signal #12 (🎯 TP hit)` + WIN/LOSS block + Entry/Exit/Move lines.
- **Manual result** (`doManualResult`) — compact premium card with grade.
- **`/risk`, `/stats`, `/today`, `/summary`, `/alerts`, `/weekly`, heatmap, best-pairs, milestone report, expiry reminder, daily summary** — consistent `SEP` separators + escaping.
- **Main menu** (`/start`, menu restore) — shows Mode (FTT/FX/BOTH), Auto, Grade, AI Only, News Block in a clean card.

---

## 2. Bug fixes (found → fixed)

| # | Bug | Where it was | Fix |
|---|-----|--------------|-----|
| 1 | **HTML-escape gaps → Telegram 400** | `doAnalyze` sent `entryReason`, `confluence`, `ai.concerns`, `ai.signal` raw; all catch-path messages sent `e.message` raw; `onCb` error path; autoScan news-pause message; custom-alert prefix; channel-info — all with `parse_mode:'HTML'` | Every dynamic value now goes through `esc()` (16 call sites). Header comments corrected (they claimed "no parse_mode", but code used HTML). |
| 2 | **`disp(null)` crash → /history /stats /best /weekly /journal dead** | v3 legacy history entries can have `pair: null`; `disp(p)` did `p.includes(...)` → TypeError killed whole formatter | `disp()` null-safe (`'?'`), `norm()`/`isCr()` hardened, `fmtPrice()` NaN-safe, `fmtHeatmap` skips invalid timestamps, `fmtBest` skips null-pair rows |
| 3 | **Scan All ignored FX mode** | `doScanAll` called `fetchSig(pair, env)` without `mode` → FX/BOTH users got FTT payload, no SL/TP levels | `fetchSig(pair, env, { mode: normMode(u.fxMode) })` |
| 4 | **Stale expiry reminders after resolution** | `doManualResult` + `doCancelAll` deleted `pt:*`/lock but not `rem:*`/`remind_ids` → "⏰ Signal #X expires in ~30s" fired after the trade was already resolved/cancelled | `delReminder(trade.id)` added in both, plus in the new `skipTrade` path of `resultCheck` |
| 5 | **FX trades force-resolved at 5min** | FX payload has no `bestTimeframe.expiry` → `logAndSchedule` fell back to 5min; spot trades (hold until SL/TP) got a meaningless 5min result | FX trades: 60min tracking horizon, `sl`/`tp` stored on the trade, `resultCheck` resolves on SL/TP hit (`🎯 TP hit`/`🛑 SL hit`), keeps tracking otherwise; no misleading "expires in ~30s" reminder for FX |
| 6 | **fetchSig timeout race didn't cover body parse** | `Promise.race` covered only the fetch; a slow `res.json()` could still hang the "⏳ Fetching…" message | 20s race now wraps `fetch` **and** `res.json()`; late rejection of the losing promise swallowed |
| 7 | **MarkdownV2 (checklist #1)** | Already fixed in v4.1 — code uses `parse_mode:'HTML'` only; verified zero MarkdownV2 remnants | (verified, no change needed) + escape-gap fixes above |
| 8 | **AutoScan dedup (checklist #3)** | Per-user candle gate (`lc:*`) + per-pair `sc:*` + direction lock (`lock:*`) | (verified correct — no duplicate messages within a candle; a filtered/errored pair is retried next candle by design) |
| 9 | **Mode cycle (checklist #4)** | `cmd:fxmode` cycles FTT→FX→BOTH→FTT and persists to KV; `normMode()` handles legacy values | (verified correct) |
| 10 | **News blackout (checklist #6)** | ±15min `hasHighImpactNews` gate in autoScan, single notification at event start, concurrent with `fetchSig` in manual flow | (verified correct) + message now premium/escaped |
| 11 | **Custom alerts (checklist #7)** | threshold check in autoScan (`passesAlert` bypasses normal filters, `🔔 Custom Alert` prefix) | (verified correct) |
| 12 | **Result push (checklist #8)** | bot-side `resultCheck` sends premium result cards; SKIP paths cleaned up reminders | fixed (see #4/#5) |
| 13 | **History / risk (checklist #9)** | `/history`, `/risk` etc. | null-pair crash fixed (see #2) |
| 14 | **Channel mirror (checklist #10)** | `autoScan` mirrors signals to `u.channelId` when set | (verified correct) |

---

## 3. Verification (done before PR)

```
$ node --check src/index.js
SYNTAX OK

$ node render-test.mjs   (fmtSignal/fmtHist/fmtRisk/fmtStats/... with sample data)
🎉 ALL TESTS PASSED      (39 checks: FX/FTT/BOTH cards, NO_TRADE, CLOSED, fill
                          default, escaping, null-pair history, news/correlated)

$ node logic-test.mjs    (resultCheck with mocked KV/worker/Telegram)
🎉 ALL LOGIC TESTS PASSED (18 checks: FX TP/SL hit → WIN/LOSS, no-hit keeps
                          pending, SELL direction, horizon fallback, FTT path,
                          SKIP path, reminder cleanup, premium card content)
```

Sample render (FX card):

```
📊 BTC/USD | 5min | 💹 FX
━━━━━━━━━━━━━━━━━
🟢 BUY 🟢 92%  [A+ EXCELLENT]
━━━━━━━━━━━━━━━━━
💰 Entry: 63813.96
🛑 SL: 63900.00
🎯 TP: 63500.00  (1:2.5)
⚡ INSTANT — take now
━━━━━━━━━━━━━━━━━
📈 HTF: BUY · 🟡 Regime: RANGING
✅ Structure: ALIGNED (BUY STRONG)
━━━━━━━━━━━━━━━━━
📝 EMA trend favors BUY · RSI bullish (61)
🤖 AI: ✅ Agrees — BUY (88%)
━━━━━━━━━━━━━━━━━
⏳ Result tracked automatically
```

---

## 4. Reviewer checklist

1. `node --check src/index.js` → pass
2. `fmtSignal` — separators / emoji / grade+confidence / fill status / NO_TRADE state ✓
3. Bug fixes 1–6 above present in code
4. No regression: autoScan / mode cycle / history / risk / custom alerts / channel mirror untouched logic-wise
5. PR body detailed
