# PUSH_DEBUG_REPORT.md — Auto Telegram Push Not Firing (2026-08-12)

**Bot:** ferdausfs/ftt-telegram-bot v4.5.0 (live) · **Worker:** ferdausfs/Ftt-Otc-v6 v6.10.0 (live)
**Investigation branch:** `arena/019ff4ba-ftt-telegram-bot` (bot repo, this report + patch)
**Fix branch (worker, ready):** `arena/019ff4ba-ftt-otc-v6` @ `8c4969f` — patch included here:
`patches/push-diagnostics-v6.11-worker.patch` (applies cleanly to worker main `3df5f1a`).

---

## 1. Symptom (reviewer-verified, re-confirmed live)

- App shows the worker's full signal stream (worker generates + saves signals fine).
- Bot receives only ~3 signals/day (was 200+).
- Live `/health` (fetched 2026-08-12 06:50 UTC):

```json
"phase10": { "pushEnabled": true, "botKvBound": true, "pushesLast24h": 0, "subscriberCount": 1 }
```

---

## 2. Live evidence chain (every step verified against the LIVE worker)

| # | Check | Result | Rules out |
|---|-------|--------|-----------|
| 1 | `/health` `version` | **6.10.0** — the v6.10.0 scanner-push-restore fix (worker PR #17, commit `8a76c68`, the *only* commit that sets the 6.10.0 string) **is live**. | "scanner still noPush" |
| 2 | `phase10.pushEnabled` | **true** — `BOT_TOKEN` **is set** on `fttotcv6`. | "secret missing" (candidate 1) |
| 3 | `phase10.botKvBound` + `subscriberCount` | **true / 1** — worker's BOT_KV binding (`39653d…`) resolves and `auto_users` parses as a 1-element array. | "KV namespace/shape for the index" (candidate 2) |
| 4 | `scanCache` (`oldestCachedAge ≈ 296s`, 14 pairs) | **scanner alive** — `*/5` cron runs and writes `latest:`. | "scanner dead" |
| 5 | `/api/history` for all 14 scan pairs | **Fresh NON-deduped tradeable rows exist**: XRP/USD SELL 73% B **06:15Z**, EUR/USD SELL 85% A+ 02:20Z, BNB BUY 77% 00:25Z, DOGE BUY 77% 01:20Z, AUD/USD BUY 77% 00:40Z, SOL/GBP/USD/JPY/ETH yesterday. Each new history row ⇒ `saveAndPush` ran ⇒ `pushSignalToSubscribers` ran. | "no signals to push" |
| 6 | `pushesLast24h` | **0** — no `pushLog:` key exists (TTL 24h). Every push attempt in ≥24h ended `pushed: 0` with **no trace anywhere queryable**. | — |

**Where it dies:** inside `pushSignalToSubscribers`, *after* the token check, *before* the
pushLog write. The remaining fork is (a) `getMatchingSubscribers` → `[]` (pair/gate mismatch —
note: both AI providers are currently rate-limited 429 → `aiValidation.combined.status =
BOTH_UNAVAILABLE`, and `passAI` fails CLOSED for `aiOnlyMode` subscribers) or (b)
`sendTelegramMessage` throwing (worker `BOT_TOKEN` present but its *value* stale/invalid —
`/health` cannot validate a secret value). Both produce `pushed:0` with zero visibility:
`'no-token'`/`'no-match'` return silently and send failures only `console.warn`.

**Why 200+/day → ~3/day:** until bot v4.4.1 the BOT's own autoScan pushed via the BOT token.
v4.4.2 silenced autoScan; v4.5.0 (live, confirmed via `https://ftt-telegram-bot.umuhammadiswa.workers.dev/`
→ "FTT Signal Bot v4.5.0") removed it. Delivery now depends 100% on worker push — which has
been failing silently. The ~3/day are the user's own manual bot commands (bot replies work).

## 3. Second finding — deploy pipeline broken (separate ops issue)

GitHub Actions deploys on **both** repos have failed since 2026-08-07 06:06 UTC (wrangler step,
`npx` exit 1; last success 05:22 UTC). Per the workspace drive runbook: the Cloudflare token
`cfut_pTef5…` was **leaked and rotated** — the `CLOUDFLARE_API_TOKEN` secret in both repos is
stale. Live bundles are deployed manually (`redeploy.sh` / `bot_deploy2.sh`), which is why the
live worker is 6.10.0 and the live bot 4.5.0 despite the failed CI runs.
**Action for user:** re-create `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) secrets in both
repos, or accept manual deploys.

## 4. Fix (worker v6.11.0 — "never silent again")

`src/handlers/pushToSubscribers.js` + `health.js` + `index.js`:

1. **Every actionable push attempt writes a diagnostic record** to KV:
   - `pushDiag:last` (overwritten per attempt) and `pushDiag:<signalId>` (48h TTL)
   - content: skip reason (`no-token` / `no-match` / `locked` / `partial-send-failure` /
     `exception` / success), per-subscriber **gate breakdown** (`pair-not-watched`,
     `gate-rejected` with `conf/grade/ai` flags, `auto-off`, `no-u-record`), or the **Telegram
     status + body preview** on a failed send.
2. `/health` → `phase10` gains `lastPushDiag` and `pushDisabledReason`
   (e.g. `"BOT_TOKEN secret not set on this worker"`).
3. `sendTelegramMessage` errors now carry `.status` and `.body` (200-char preview).
4. The silent `no-token` / `no-match` / send-failure paths now `console.warn`
   (rate-limited to once per 15 min per reason).

**How this proves the root cause after deploy:** on the next fresh tradeable signal,
`/health` → `phase10.lastPushDiag` will name the exact reason:
- `skipped: "no-match"` + gate breakdown → subscriber settings issue (e.g. `aiOnlyMode: true`
  while AI providers are 429 — visible as `ai: false`; or pair/watchlist mismatch).
- `skipped: "partial-send-failure"` + `status: 401` → worker `BOT_TOKEN` value is stale —
  re-`wrangler secret put BOT_TOKEN` on `fttotcv6` with the bot's current token.
- `skipped: "no-token"` → set the secret (not the case today).
- `delivered: 1` → chain healthy; earlier zeros were setup-specific.

## 5. Test matrix (all run, all green)

Worker (patched tree = pristine `3df5f1a` + patch):
`fix_tests` **281/281** · `r71_tests` **117/117** · `d2_tests` 39/39 · `probe_tests` 34/34 ·
`fx_mode_tests` 20/20 · `entry_hit_tests` 7/7 · `phase7_integration` 36/36 ·
`phase7_smoke` 68/68 · `phase10_smoke` **61 → 64/64** · `phase10_integration` **19 → 41/41**
(new section pins: success writes pushDiag; no-token records reason + `pushDisabledReason`;
unwatched pair records gate breakdown; aiOnlyMode+BOTH_UNAVAILABLE records `ai:false`;
Telegram 401 records status+body; the REAL `handleSignalRaw` chain leaves a diag trail).

Bot: `node --check src/index.js` ✓ · `round2-bugfix-test.mjs` ✓ · `menu-test.mjs` ✓ ·
`single-source-test.mjs` ✓ (no bot code changed — the fix is worker-side).

## 6. Deploy checklist (after merge)

1. Worker: rebuild bundle (`bash redeploy.sh`, unique filename, verify bytes) — or restore the
   rotated `CLOUDFLARE_API_TOKEN` secret and let CI deploy.
2. Bot: no rebuild needed (no bot code change).
3. Live verify: wait for the next fresh tradeable signal → `/health`:
   - `pushesLast24h` increments and `lastPushDiag.delivered ≥ 1` → fixed.
   - `lastPushDiag` shows a gate/status → act on it per §4.
