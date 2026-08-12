# Telegram auto-push still silent after v6.10 — evidence + v6.10.1 fix

**Target repo:** `ferdausfs/Ftt-Otc-v6` (worker). Bot v4.5.0 is **untouched**.
**Blocker:** this session's GitHub App cannot push to `Ftt-Otc-v6` (HTTP 403,
same as PRs #8/#9). Fix is delivered here as:

- `patches/v6101-push-silent-death.patch` — `git apply --check` clean on
  current worker `main` (`3df5f1a`). Apply with:

  ```bash
  cd Ftt-Otc-v6
  git checkout -b arena/019ff4b8-ftt-otc-v6
  git apply patches/v6101-push-silent-death.patch   # or this file
  ```

  Local worker commit already exists: `951324e` on branch
  `arena/019ff4b8-ftt-otc-v6` (push denied). Grant the Arena app write
  access and the real PR opens immediately.

---

## 0. Live evidence (2026-08-12 ~06:47 UTC)

`GET https://fttotcv6.umuhammadiswa.workers.dev/health`:

```json
"version": "6.10.0",
"scanCache": {
  "lastGenerationId": "gen_1786517123943_w0346m",
  "cachedPairCount": 14,
  "oldestCachedAge": 104,
  "newestCachedAge": 97
},
"phase10": {
  "pushEnabled": true,
  "botKvBound": true,
  "pushesLast24h": 0,
  "subscriberCount": 1
}
```

| Claim | Verdict |
|---|---|
| BOT_TOKEN missing on the worker | **FALSE.** `pushEnabled: true`. Candidate 1 from the prompt is ruled out as "secret unset". The secret can still be the *wrong* bot — `/health` never called `getMe`. |
| BOT_KV unbound / wrong namespace | **FALSE.** `botKvBound: true`, `subscriberCount: 1` (same `auto_users` the bot writes). |
| Scanner not running / not saving | **FALSE.** 14 pairs cached in ~7s. ADA/USD history has pending `sig_1786517126427_n1xn9` SELL 85% B at `2026-08-12T06:45:26.427Z` (26s after the `*/5` cron). EUR/USD also saved a SELL today at 02:20. |
| `pushesLast24h: 0` means zero Telegram sends ever | **INCOMPLETE.** Result-push **deletes** `pushLog:<id>`. A full day of successful push+resolve would also show 0. The **pending** ADA row is the exception that proves the real failure: if that SELL had been delivered, its pushLog would still be open and the counter would be ≥1. |
| User gets ~3/day | Matches bot `Signal Now` (`/api/signal` → bot `sendMsg`). Worker push is a *second* message. They get one card, not two → worker send is not landing. |

App (`Ftt-app-002`) calls `/api/signal?pair=` **without** `nopush`. Every App view is also a fetch-path `saveAndPush`. Those 38 decided rows went through the push function. Zero surviving pushLogs on a *pending* row means the function returned without a successful send.

---

## 1. Root causes (code, with a runtime trigger)

### A. Lock claimed before send (definite code bug)

```js
// BEFORE (v6.10.0)
if (await claimPushLock(sub.chatId, signal, env)) eligible.push(sub);
// ...
await sendTelegramMessage(sub.chatId, message, env);
// pushLog written only if delivered.length > 0
```

A 401/403 (wrong worker `BOT_TOKEN`, chat the token cannot write, or a
transient Telegram error) threw, `Promise.allSettled` marked rejected,
`delivered = []`, **no pushLog**, **lock held 30 min**. Next scanner tick
returned `skipped: 'locked'`. Forever 0 DMs, forever 0 logs.

This is the pattern that matches the live symptom exactly, including why
a later pending ADA SELL (06:45, same pair+direction as the 06:25 WIN)
would also have no pushLog.

### B. `/health.pushesLast24h` counted the wrong thing

`getPushStats` listed `pushLog:*` keys. `pushResultToSubscribers` deletes
that key after the result DM. The counter the reviewer treated as "proof
of zero pushes" is zero for every *resolved* signal even when push worked.

### C. Nested `waitUntil` on the `*/5` scheduled handler

```js
// BEFORE
async scheduled(event, env, ctx) {
  if (cron === '*/5 * * * *') {
    ctx.waitUntil(scheduledScan(env, ctx));  // outer
    return;                                   // handler done
  }
}
// handleSignalRaw → ctx.waitUntil(saveAndPush)   // inner, after handler returned
```

Save is a fast KV write (history rows exist). Telegram send is slower
(and FX/BOTH users trigger an 8s self-fetch of `/api/signal?mode=fx&nopush=1`
*inside* the push). If the isolate freezes when `scheduledScan` resolves,
history lands and the send dies. Contributes to the same "saved, not
pushed" picture.

### D. Silent skip reasons

`no-token` / `no-match` / `locked` / Telegram 401 were only `console.warn`.
`/health` could not tell them apart. `!!BOT_TOKEN` treated a whitespace
paste or a token for a *different* bot as "enabled".

---

## 2. Fix (v6.10.1) — worker only

| Change | Why |
|---|---|
| Release `pushLock` if `sendMessage` throws | Next tick can retry. Pins the live 401/403 death spiral. |
| Persist `push:lastAttempt` on **every** outcome | `/health.push.lastAttempt` shows `skipped`, `telegramError`, per-user skip reasons (`pair-not-watched`, `ai-only`, `no-user-record`, …). |
| Durable `push:delivered24h` ring | Counter survives result-push deleting `pushLog:*`. |
| `/health.push = {enabled, noTokenReason, tokenValid, tokenUsername, lastAttempt, subscribers}` | Prompt asked for `push: {enabled, noTokenReason}`. `tokenValid` is a cached `getMe` so a wrong secret is visible. `subscribers[]` dumps pair / watchlist / autoEnabled / filters. |
| `await scheduledScan(...)` + scanner `awaitPersist: true` | Scheduled isolate stays alive until save+push finishes. Fetch path still uses `waitUntil` so HTTP is not blocked. |
| `normalizeAutoUsers` + `isAutoEnabled` + `botToken().trim()` | Numbers / `u:<id>` / `{chatId}` objects and a trailing newline on the secret no longer silently match nobody / 401. |

Gates (pair + watchlist + grade/conf/AI) are **unchanged**. If the one
subscriber only watches `EURUSD`, ADA will still not DM — but
`lastAttempt.skips` will now say `pair-not-watched` instead of looking
like a dead pipeline.

---

## 3. Test matrix (run on the patched worker tree)

| Suite | Result |
|---|---|
| `node --check` on all changed files | pass |
| `fix_tests` | **302/0** (was 281; T43 pins lock-release, retry, no-token, whitespace token, durable counter, subscriber snapshot, `await scheduledScan`) |
| `phase10_integration` | 19/19 |
| `phase10_smoke` | **71/0** (was 61; lock-release + shape hardening + health fields) |
| `phase7_smoke` / `phase7_integration` | 68/0 · 36/0 |
| `d2_tests` / `probe_tests` / `entry_hit_tests` / `fx_mode_tests` | 39 · 34 · 7 · 20 |
| `r71_tests` | **117P/0F** |

Bot (this repo, unchanged): `node --check src/index.js` · `round2-bugfix-test.mjs` 60/0 · `menu-test.mjs` 74/0 · `single-source-test.mjs` 72/0.

---

## 4. After merge — deploy + live verify

1. `cd Ftt-Otc-v6 && bash redeploy.sh` (unique bundle filename, check it).
2. Hit `/health`. Expect `version: "6.10.1"` and a `push` object.
3. Read `push.tokenValid`. If `false`, the worker secret is not a live bot
   token — `wrangler secret put BOT_TOKEN --name fttotcv6` with the **same**
   value the `ftt-telegram-bot` worker uses. (Setting it only on the bot
   worker is the classic miss; this `/health` field makes it obvious.)
4. Read `push.subscribers[0]`. Confirm `autoEnabled`, `pair`, `watchlist`.
   Auto only delivers pair+watchlist (max 7). The App shows all 14
   `SCAN_PAIRS`. That is intended, not a bug — but if the watchlist is
   empty and `pair` is `EURUSD`, crypto SELLs will skip with
   `pair-not-watched`.
5. Wait for the next `*/5` tradeable signal on a watched pair, or
   `GET /api/signal?pair=<watched>`. Telegram DM should arrive.
   `push.lastAttempt.pushed >= 1` and `pushesLast24h` increments
   (durable counter, not the open-log count).
6. `pushLogsOpen` is the number of *unresolved* pushed signals (result
   DMs still owed). It is supposed to drop as the `*/2` tracker resolves.

---

## 5. What this is not

- Not a bot change. v4.5.0 thin-client + `doToggle`/`addAutoUser` already
  write `auto_users` + `u:<cid>.autoEnabled` correctly.
- Not "BOT_TOKEN unset". It is set. It may still be *wrong* — that is now
  visible as `push.tokenValid`.
- Not a gate rewrite. Pair/watchlist/grade/conf/AI matching is the same
  contract the old bot `autoScan` used.
