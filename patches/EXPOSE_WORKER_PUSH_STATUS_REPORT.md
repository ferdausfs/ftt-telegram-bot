# 🛠️ EXPOSE WORKER PUSH STATUS REPORT — PATCH + DIAGNOSTICS

## 1. EVIDENCE CHAIN & DIAGNOSTIC FINDINGS

### Symptom Analysis:
1. **The Bug:** The app showed the full stream of generated tradeable signals (38 decided today), but the Telegram bot received only ~3 signals/day (instead of 200+).
2. **Worker Health state:** The worker's `/health` endpoint showed `pushesLast24h: 0` while `subscriberCount: 1`.
3. **The `BOT_TOKEN` Check:** 
   - The worker (`fttotcv6`) and the bot (`ftt-telegram-bot`) are completely separate Cloudflare workers.
   - For the push notification chain to work, the worker itself must have the `BOT_TOKEN` configured as a secret. If it is only set on the bot, the worker's `pushSignalToSubscribers` handler will evaluate:
     ```javascript
     if (!env || !env.BOT_TOKEN) {
       return { pushed: 0, skipped: 'no-token' };
     }
     ```
     This bypasses the push entirely and silently returns `{ pushed: 0, skipped: 'no-token' }`.
   - Since the worker doesn't throw an error (it silently skips to avoid spamming logs when push is not configured), this remains silent at runtime.
   - The ~3 signals/day that the bot received were **not** auto-pushes, but were triggered by manual user commands (such as clicking `📊 Signal Now` or scanning pairs) which query the worker `/api/signal` via service binding, returning the signal to the bot directly in the response.

### Conclusion:
The root cause is that **`BOT_TOKEN` is missing on the worker (`fttotcv6`) secret list**.

---

## 2. THE PROPOSED FIX

To prevent this issue from being silent and hard to debug in the future, we have implemented an improvement to the worker's `/health` endpoint:
- **Health status exposure:** Added a `push` block inside the worker's `getPushStats` stats object (returned inside `phase10` in `/health` payload).
- **Structure:**
  ```json
  "push": {
    "enabled": false,
    "noTokenReason": "BOT_TOKEN-missing"
  }
  ```
- **Error reasons:**
  - `BOT_TOKEN-missing`: If `BOT_TOKEN` is absent in worker secrets.
  - `env-undefined`: If the runtime `env` context is missing.
  - `null`: When `BOT_TOKEN` is present and push is fully enabled.

---

## 3. TEST MATRIX

All worker and bot test suites were executed and are fully green.

### Worker Tests Run:
| Suite | Passed / Failed | Notes |
|---|---|---|
| `fix_tests.mjs` | **281 / 0** | Core engine, OTC, calibration, and edge features |
| `phase10_integration.mjs` | **19 / 0** | Phase 10 integration, push mechanism, and tracker |
| `phase10_smoke.mjs` | **67 / 0** | **6 new tests added** pinning `stats.push` structure and `noTokenReason` |
| `phase7_integration.mjs` | **36 / 0** | Cache scanning and warming |
| `phase7_smoke.mjs` | **68 / 0** | Freshness calculations and health caching |
| `d2_tests.mjs` | **39 / 0** | Store isolation and circuit breaker |
| `probe_tests.mjs` | **34 / 0** | Forex sell probe and admission gates |
| `entry_hit_tests.mjs` | **7 / 0** | Corrected entry-hit logic |
| `fx_mode_tests.mjs` | **20 / 0** | SL/TP level computation |
| `r71_tests.mjs` | **117 / 0** | R7.1 structural shadow audit |

### Bot Tests Run:
| Suite | Passed / Failed | Notes |
|---|---|---|
| `menu-test.mjs` | **74 / 0** | Menu and navigation keyboard layout |
| `round2-bugfix-test.mjs` | **60 / 0** | A+ grade filtering and dual-combiner AI check |
| `single-source-test.mjs` | **72 / 0** | Single-source worker history and stats fetching |

---

## 4. HOW TO DEPLOY

1. **Set `BOT_TOKEN` on the worker (`fttotcv6`):**
   ```bash
   wrangler secret put BOT_TOKEN --name fttotcv6
   ```
2. **Apply the patch to the worker codebase:**
   ```bash
   git apply patches/expose-worker-push-status.patch
   ```
3. **Re-build and re-deploy the worker bundle:**
   Refer to `MASTER_RUNBOOK_2026-08-08.md` §6 for manual bundle deployment steps.
