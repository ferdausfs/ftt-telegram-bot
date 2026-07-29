# AGENT_LOG

## 2026-07-29 — Phase 9: background scans read the unified worker cache (NOT deployed)

### Scope
Bot-only. Base `c383af2`. 2 files: `src/index.js` modified, `scripts/phase9_smoke.mjs`
added. 300 insertions / 8 deletions. `wrangler.toml` untouched.

### Spec assumption was wrong: the Bot never used /api/batch
§B.3 said to replace `SIGNAL_WORKER.fetch('/api/batch?pairs=...')`. That string does
not exist in the repo. The Bot has exactly one worker call point — `fetchSig(pair,
env)` hitting `/api/signal?pair=X`, one pair at a time.

More importantly, that single function is shared by **seven** callers: five
user-initiated (`doSignal`, `doQuickSignal`, `doScanAll`, `doReplay`, `doAnalyze`)
and two background (`autoScan`, `resultCheck` via `fetchPrice`). Changing `fetchSig`
itself would have moved every user command onto the cache, directly violating the
§B.2 "keep untouched" list. So a separate `fetchSigCached()` was added and only the
two background callers were switched.

### Changes
- `workerFetch(path, env, {allow404})` — one shared transport (service binding with
  the existing 20s Promise.race timeout, plain fetch fallback). Previously that
  logic was inline in `fetchSig`; two endpoints now need it, so it is written once.
- `fetchSig()` — unchanged semantics, still a fresh engine run. Used by all five
  user commands.
- `fetchSigCached()` — reads `/api/signals/latest?pair=X`; falls back to a fresh run
  on 404 (pair outside SCAN_PAIRS or expired), on any cache error, or on a 200 that
  carries no signal. Watchlist coverage therefore never shrinks.
- `autoScan` and `fetchPrice` now use it. `fetchPrice` was not in the spec, but it
  was running a full engine pass (candles + Cerebras + Groq) purely to read one
  price during result checking — the exact waste Phase 7 exists to remove.
- `fmtFreshness()` adds "🕐 Cached 2m ago" / "⚡ Freshly generated" to notifications,
  and emits nothing when the payload has no cache metadata (old shape unaffected).
- `/refresh <pair>` — explicit force-refresh wording, same behaviour as `/signal`.

### Verification — 42/42
The Bot is a single 1900-line Worker module with no exports, so the smoke suite
extracts `workerFetch`/`fetchSig`/`fetchSigCached`/`fmtFreshness` from the real
source by brace matching and executes them in a `vm` sandbox against a mocked
`SIGNAL_WORKER`. That runs the actually-shipped code rather than grepping it:
cache hit makes one request and never touches `/api/signal`; 404 and 500 both fall
back and still return a signal; `fetchSig` never reads the cache. A structural pass
then maps every call site to its enclosing function and asserts the 2-background /
5-user split. Plus: `/history`, user state, `resultCheck`, manual `/win /loss`, cron
`*/5`, and the `fttotcv6` service binding all unchanged.

Two of my own test-harness bugs were fixed along the way (the extractor dropped the
`async` keyword, then mistook `{ allow404 = false }` in the parameter list for the
function body) — neither was a fault in the shipped code.

### Open
- `resultCheck` now decides WIN/LOSS from a price up to 5 minutes old. That is a
  real accuracy trade-off against quota, and it is a one-line revert
  (`fetchSigCached` -> `fetchSig` inside `fetchPrice`) if it is not wanted.
- `/scan` still runs a fresh generation for every watchlist pair. It is
  user-initiated so §B.2 says leave it, but it is the Bot's most expensive command.

---

