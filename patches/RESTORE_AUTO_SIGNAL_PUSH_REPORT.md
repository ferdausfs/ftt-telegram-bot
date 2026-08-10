# RESTORE AUTO SIGNAL PUSH — worker fix (delivery artifact)

**Status:** implemented + fully verified locally on `Ftt-Otc-v6` (branch
`arena/019feb31-ftt-otc-v6`, commit `1fa8240`, base `bad7140c` = current main).

**Blocker for direct PR:** this session's GitHub App token has **no write
access to `ferdausfs/Ftt-Otc-v6`** (push → `403 Permission denied`). The fix is
therefore shipped here as `git format-patch` (apply with
`git am < restore-auto-signal-push-worker.patch` on top of current `main`),
plus this report. The local clone `/home/user/ftt-otc-v6` is ready to push the
branch + open the PR the moment the app is granted access (see end).

---

## 0. The bug

Auto Telegram signals stopped. Root cause — a design gap left by two earlier
changes:

1. **Worker F3-14 (BUG-028):** the `*/5` scanner calls
   `handleSignalRaw(pair, env, ctx, { noPush: true })` — added to stop
   scanner-push duplication while the BOT still had its own `autoScan`.
2. **Bot v4.5.0:** removed `autoScan` entirely (worker = single source of
   truth; bot = thin client). Nothing generates/sends automatically anymore.
3. **Result:** `pushSignalToSubscribers` had exactly ONE call site
   (`signal.js` `saveAndPush`, `if (!noPush)`) — only the manual HTTP
   `/api/signal` path (no `nopush`) fired it. The `*/5` scanner saved history
   rows but NEVER delivered them → **auto signals never reached subscribers.**

Manual behavior still worked (bot `/signal` → worker `/api/signal` → push to
all subscribers + bot displays) — manual-trigger only, not auto.

## 1. The fix — Option B (chosen)

`src/handlers/scheduledScan.js` `scanOnePair`:

```js
// OLD (F3-14)
const result = await handleSignalRaw(pair, env, ctx, { noPush: true, ...opts });
// NEW (v6.10)
const result = await handleSignalRaw(pair, env, ctx, opts);
```

**Why Option B over Option A:** removing `noPush:true` makes the scanner ride
the SAME `handleSignalRaw → saveAndPush` chain the manual path uses.
`saveAndPush` already persists via `saveSignalToHistory` and pushes **only when
the row is genuinely NEW** (30-min setup dedup: same pair+direction+nearby
entry → `{deduped:true}` → return, no push). Option A would have required the
scanner to re-derive that dedup decision (it cannot see `saveAndPush`'s result)
or re-check history itself — duplicated logic, more race surface. Option B adds
zero new push code and keeps ONE save+push path for every caller.

Scanner still writes only the `latest:` cache — no double save (the module
header's "Why history is NOT saved here" rationale is unchanged; the scanner
never calls `saveSignalToHistory`).

Also bumped worker version to `v6.10.0` (`src/index.js` header + `/` message,
`src/handlers/health.js`). Engine method strings untouched (persisted output).

## 2. Dedup verification (R2) — scanner ↔ manual cannot double-push

Two independent layers, both 30 minutes:

| Layer | Mechanism | Key | Blocks |
|---|---|---|---|
| History guard | `saveSignalToHistory` 30-min setup dedup (`DEDUP_WINDOW_MS`, entry tolerance 0.05%/0.0001) | per-pair history stream | re-poll of same setup → no row, no push |
| Push lock | `claimPushLock` (pushToSubscribers.js) | `pushLock:<chatId>:<PAIR>:<DIR>` TTL 30 min | any second delivery of same pair+direction per subscriber |

- **Scanner pushes first, then manual `/api/signal` (no nopush):** history
  guard returns `{deduped:true}` → no push. Even if a re-poll slips past the
  entry tolerance, `claimPushLock` sees the held lock → skipped `'locked'`.
- **Manual pushes first, then scanner re-scan:** identical, symmetric.
- **Result push (`*/2` tracker):** untouched — it sends to the `pushLog:<id>`
  recipients only, then consumes the log (single result per signal).
- **Residuals (pre-existing, documented in `pushToSubscribers.js` header):**
  (a) a genuinely NEW same-direction setup inside the 30-min lock window is
  muted by the lock (lock wins over history); (b) KV has no CAS, so a true
  concurrent race can deliver one duplicate. Both bounded; acceptable per the
  Phase 10 design.

## 3. Tests

New behavioral T27 (fix_tests.mjs), replacing the old F3-14 grep contract —
real `scanOnePair` → `handleSignalRaw` → `saveAndPush` → Telegram (network
stubbed, subscriber 111 watches BTCUSD, all filters open):

- `T27a` fresh tradeable signal → **exactly one** push to the matching
  subscriber; pushLog + pushLock written; history exactly one row (no double
  save)
- `T27b` re-scan of the same setup (lock window) → **not re-pushed** (history
  dedup)
- `T27c` manual `/api/signal` after scanner push → **not re-pushed** (R2)
- `T27d` manual first, then scanner → **not re-pushed** (R2, reverse order)
- `T27e` call site no longer forces `noPush:true`

`scanOnePair` exposed test-only via `export const __scanTest = { scanOnePair }`
(repo convention: `__dedupTest`, `__pushTest`).

### Test matrix (all run on the fix branch)

| Suite | Result | Note |
|---|---|---|
| `fix_tests` | **281 PASS / 0 FAIL** | was 266/0; T27 rewritten +15 assertions |
| `phase10_integration` | **19/19** | push path unchanged, still green |
| `phase7_integration` | **36/0** | scanner pipeline (no BOT_TOKEN → push inert) |
| `phase7_smoke` | **68/0** | incl. "no double save" greps |
| `phase10_smoke` | **61/0** | |
| `d2_tests` | **39/39** | |
| `probe_tests` | **34/34** | |
| `entry_hit_tests` | **7/7** | |
| `fx_mode_tests` | **20/20** | |
| `r71_tests` | **117P / 0F** | frozen baseline untouched |

`node --check` on every changed file → pass.

## 4. Files changed (worker repo, 5 files)

| File | Change |
|---|---|
| `src/handlers/scheduledScan.js` | drop `noPush:true`; contract comments; `__scanTest` export |
| `scripts/fix_tests.mjs` | T27 rewritten as behavioral scanner-push test (+15 assertions) |
| `src/index.js` | version v6.10.0 (header + `/` message) |
| `src/handlers/health.js` | version 6.10.0 |
| `AGENT_LOG.md` | round entry (root cause, option B rationale, dedup, matrix) |

Bot repo (`ftt-telegram-bot`) code: **untouched** (R4 — bot v4.5.0 thin client
is correct as-is).

## 5. Deploy note (after merge)

Manual bundle: rebuild `worker.js` from the merged tree → `bash redeploy.sh`
(filename check!) → live-verify: a fresh auto signal arrives from the `*/5`
tick without anyone pressing a button, and arrives **exactly once** (watch
Telegram / `pushLog:<id>` KV).

---

## Blocker: push access to Ftt-Otc-v6

`git push origin arena/019feb31-ftt-otc-v6` →
`remote: Permission to ferdausfs/Ftt-Otc-v6.git denied to arena-ai-coding-agent[bot]` (403).
The token has write access only to `ftt-telegram-bot` (this session's repo).

**To unblock:** install/grant the Arena GitHub App (or add
`arena-ai-coding-agent[bot]` as a collaborator) on `ferdausfs/Ftt-Otc-v6`, or
reconnect GitHub in Arena. The branch `arena/019feb31-ftt-otc-v6` (commit
`1fa8240`) is ready locally and will be pushed + PR'd the moment access exists.
