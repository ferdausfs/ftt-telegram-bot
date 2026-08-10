# Restore Auto Signal Push — Worker Fix (F3-21) — Evidence Report

> **Delivered by:** Arena worker session (branch `arena/019feb2d-ftt-telegram-bot`)
> **Target repo:** `ferdausfs/Ftt-Otc-v6` — **branch `fix/restore-auto-signal-push`**, commit `e0c51ab` (off `main` = `bad7140`)
> **Date:** 2026-08-10

---

## ⚠️ Blocker — could not push to `Ftt-Otc-v6`

The GitHub App installed in this sandbox (`arena-ai-coding-agent[bot]`) is
**scoped to `ferdausfs/ftt-telegram-bot` only**. Pushing the branch to
`ferdausfs/Ftt-Otc-v6` was denied:

```
remote: Permission to ferdausfs/Ftt-Otc-v6.git denied to arena-ai-coding-agent[bot].
fatal: unable to access ... 403
```

Everything below is therefore delivered as:
1. **`restore-auto-signal-push.patch`** — the full fix diff (3 files, +136/−12),
   verified to apply cleanly against current `Ftt-Otc-v6` main
   (`git apply --check` passed on a fresh clone).
2. This report with the complete PR body draft, dedup verification and test matrix.

**To land it:** `cd Ftt-Otc-v6 && git checkout main && git checkout -b fix/restore-auto-signal-push && git apply restore-auto-signal-push.patch`, run the suites below, then push + open the PR with the body at the bottom of this file. Alternatively grant the arena app write access to `Ftt-Otc-v6` and I can push the existing branch `fix/restore-auto-signal-push` (commit `e0c51ab`) directly.

---

## 1. Root cause (from code, verified)

- The `*/5` scanner (`scheduledScan.js` `scanOnePair`) called
  `handleSignalRaw(pair, env, ctx, { noPush: true })` — added as F3-14 to stop
  scanner-push duplication **when the BOT still had its own autoScan**.
- Bot v4.5.0 removed `autoScan` entirely (bot = thin client; worker = single
  source of truth), so **nothing** triggers or sends automatic signals anymore.
- `pushSignalToSubscribers` therefore had exactly **one** call site
  (`signal.js:99`, `if (!noPush)`), reachable only from **manual** HTTP calls to
  `/api/signal` without `nopush`. The scanner saved signals to history but never
  pushed. **Auto signals were never delivered to Telegram subscribers.**

Manual flow kept working (bot `/signal` → worker `/api/signal` without `nopush`
→ push to all subscribers + bot displays).

## 2. The fix — Option B (chosen), and why not A

**Option B (chosen):** drop `noPush` at the scanner's call site:

```js
// OLD
const result = await handleSignalRaw(pair, env, ctx, { noPush: true, ...opts });
// NEW
const result = await handleSignalRaw(pair, env, ctx, opts);
```

`handleSignalRaw → saveAndPush` already chains the push behind
`saveSignalToHistory`'s 30-min dedup (`{deduped:true}` → return early, no push),
so **a push fires exactly when a genuinely new row lands in history** — the
"new + tradeable" gate already exists on the single source of truth (the
ledger). No new code path, no duplicated dedup logic, `pushSignalToSubscribers`
keeps its single call site.

**Why not Option A** (call `pushSignalToSubscribers` from the scanner): its
premise — "the scanner already skips duplicates via history dedup" — does not
hold in the current code. `scanOnePair` never sees the save verdict:
`saveAndPush` runs inside `ctx.waitUntil()` in `handleSignalRaw`, so the scanner
cannot know whether the row was deduped. Implementing A faithfully would require
plumbing a save verdict out of the shared `/api/signal` path (a bigger, riskier
refactor touching every caller) — or pushing on every BUY/SELL re-poll with
lock-only dedup. B reuses the existing, tested save+push chain unchanged.

`scanOnePair` was also **exported** (was module-private) so the new T27 test can
drive it directly.

## 3. Dedup verification (lock / pushLog / history)

| Scenario | Guard that stops the duplicate | Result |
|---|---|---|
| Scanner pushes fresh setup | history row is new → push fires | 1 message ✓ |
| Next `*/5` tick re-polls the same setup (30-min window) | `saveSignalToHistory` dedup (pair+direction+entry, 30 min) | 0 extra messages, 0 extra rows ✓ |
| Manual `/signal` right after scanner push (fresh `sig_` id, same pair+direction) | `claimPushLock(chatId, pair, dir)` — 30-min TTL, aligned with history window | 0 extra messages (`skipped:'locked'`) ✓ |
| Manual `/signal` first, scanner tick inside window | history dedup (same setup) **and** lock (if entry moved) | 0 extra messages ✓ |
| `*/2` result checker | reads `pushLog:<signalId>` — only subscribers who got the signal are notified; log deleted after result | exactly 1 result push ✓ |

Both layers share the 30-minute window, so there is no gap where one expires
while the other still suppresses. Residual race (documented in code): KV has no
atomic compare-and-set, so two *concurrent* first-callers could both claim —
worst case one duplicate, versus the dozens prevented.

## 4. Test matrix — all green

| Suite | Baseline | After fix |
|---|---|---|
| `fix_tests` | 266/0 | **277/0** (T27 rewritten, +11 assertions) |
| `phase10_integration` | 19/19 | **19/19** |
| `phase7_integration` | 36/36 | **36/36** |
| `phase7_smoke` | 68/68 | **68/68** |
| `d2_tests` | 39/39 | **39/39** |
| `probe_tests` | 34/34 | **34/34** |
| `entry_hit_tests` | 7/7 | **7/7** |
| `fx_mode_tests` | 20/20 | **20/20** |
| `r71_tests` | 117P/0F | **117P/0F** |

**New T27 (fix_tests)** — drives the real `scanOnePair` → engine →
`saveAndPush` → Telegram with only the network stubbed:
- fresh tradeable signal → exactly **1** message to the matching subscriber,
  `pushLog:<id>` written, history row written, `latest:` cache warmed;
- re-scan of the same setup (within lock window) → **0** extra messages,
  **0** extra history rows (history dedup);
- manual re-push with a fresh id, same pair+direction → suppressed by
  `claimPushLock` (`skipped:'locked'`), total stays 1.

**E2E through the real `scheduledScan()` entry point** (all 14 pairs, subscriber
watching BTC/USD):

```
[1] scan ok=14 failed=0 skipped=0
[1] telegram messages after FIRST scan: 1 (chat 111)
[1] BTC/USD history rows: 1
[1] latest:BTC_USD written: true (id sig_...)
[1] pushLog keys: pushLog:sig_...
[2] telegram messages after SECOND scan: 1 (expect still 1)
[2] BTC/USD history rows: 1 (expect 1)
[3] manual /signal -> id sig_... signal BUY
[3] telegram messages after manual /signal: 1 (expect still 1)
E2E CHECK PASSED
```

R4 satisfied: **bot (`ftt-telegram-bot`) untouched** — v4.5.0 thin client is
correct. Worker-only change.

## 5. Files changed (Ftt-Otc-v6)

- `src/handlers/scheduledScan.js` — call site `noPush:true` removed; header +
  call-site comments updated; `scanOnePair` exported. **No engine change.**
- `scripts/fix_tests.mjs` — T27 rewritten (source pin + 3 behavioral blocks).
- `AGENT_LOG.md` — entry added (repo convention).

`pushSignalToSubscribers` still has exactly **one** call site (`signal.js:99`).

## 6. Deploy note (after merge)

Manual bundle deploy: rebuild `worker.js` → run `bash redeploy.sh` (filename
check!) → live-verify: a fresh auto signal arrives with no button pressed, and
exactly once.

---

## PR body draft (for `ferdausfs/Ftt-Otc-v6`)

```markdown
## Restore auto signal push in the */5 scanner (F3-21)

**Bug:** Telegram auto signals stopped. F3-14 added `noPush:true` to the
scanner's `handleSignalRaw` call to stop scanner-push duplication while the BOT
still had its own autoScan. Bot v4.5.0 removed autoScan (bot = thin client),
leaving `pushSignalToSubscribers` with exactly ONE call site — manual
`/api/signal` without `nopush`. The scanner saved signals but never pushed:
**auto signals were never delivered.**

**Fix (Option B):** drop `noPush` at the scanner's call site. The push stays
chained behind `saveSignalToHistory`'s 30-min dedup inside `saveAndPush`, so a
push fires exactly when a NEW row lands in history — no re-implemented dedup.
Option A rejected: its premise (scanner sees the history-dedup verdict) is
false — `saveAndPush` runs inside `ctx.waitUntil`, so gating on "new" would need
a save verdict plumbed out of the shared `/api/signal` path.

**Dedup (R2):** `claimPushLock` (per chat+pair+direction, 30-min TTL aligned
with the history window) stops scanner↔manual double pushes in both orders;
`pushLog:<signalId>` keeps the */2 result push targeted. Verified: fresh scan →
1 message; re-scan → 0 extra; manual /signal after scan → 0 extra.

**Test matrix:** fix_tests 277/0 (T27 rewritten: scanner pushes once, re-scan
dedup, lock-layer re-push lockout) · phase10 19/19 · phase7 36/36 + 68/68 · d2
39/39 · probe 34/34 · entry_hit 7/7 · fx_mode 20/20 · r71 117P/0F. E2E through
real scheduledScan(): 1 message on first scan, 0 additional on re-scan and on
manual /signal. Bot repo untouched (R4).
```
