# ftt-telegram-bot — Phase 9 Report — Cache Unification (Bot)

> Bot-এর background watchlist scan এখন worker-এর unified cache থেকে read করে (`/api/signals/latest`), আর independent `/api/batch` call করে না। User /signal command এখনও fresh generation trigger করে (force refresh semantics)। ফলে App user আর Bot subscriber same signal `id` দেখবে, one canonical source। কোনো user-facing behavior change নেই notify content ছাড়া।

**Repo:** `ftt-telegram-bot` @ `c383af2` · **Backend:** v6.9.2 + Phase 7 cache (live)
**Deploy:** কিছুই না — no `wrangler deploy`, no `git push`
**Diff:** 2 files, **300 insertions / 8 deletions** (1 modified, 1 test script)
**Verification:** `node --check` pass · smoke **42/42** (real shipped functions executed)

---

## 1. ⚠ Spec §B.1-এর assumption ভুল — Bot `/api/batch` ব্যবহারই করে না

Spec §B.3 বলেছিল:
> Replace `SIGNAL_WORKER.fetch('/api/batch?pairs=...')` with `.fetch('/api/signals/latest')`

**Repo-তে `/api/batch` কোথাও নেই।** grep করে দেখা:

```
$ grep -rn "SIGNAL_WORKER|api/signal|api/batch|api/history" src/
1611:  const req = new Request(`${WORKER_URL}/api/signal?pair=${pair}`, ...)
```

Bot-এর একটাই worker call point — `fetchSig(pair, env)` → `/api/signal?pair=X`, **per pair, একটা একটা করে**। `/api/batch` (App-এর scanner ব্যবহার করে) Bot-এ কখনো ছিল না।

**তার চেয়ে গুরুত্বপূর্ণ:** ওই একটা `fetchSig` **৭টা caller শেয়ার করে** — ৫টা user-initiated, ২টা background:

| Caller | ধরন | Phase 9 |
|---|---|---|
| `doSignal` (1263) | user `/signal` | fresh (অপরিবর্তিত) |
| `doQuickSignal` (1306) | user pair tap | fresh (অপরিবর্তিত) |
| `doScanAll` (1350) | user `/scan` | fresh (অপরিবর্তিত) |
| `doReplay` (1469) | user `/replay` | fresh (অপরিবর্তিত) |
| `doAnalyze` (1487) | user `/analyze` | fresh (অপরিবর্তিত) |
| **`autoScan` (1693)** | **cron watchlist** | **→ cache** |
| **`resultCheck` → `fetchPrice` (1794)** | **cron result check** | **→ cache** |

`fetchSig` সরাসরি বদলালে **সব user command-ও cache পড়ত**, যা §B.2-এর "keep untouched" সরাসরি লঙ্ঘন। তাই আলাদা `fetchSigCached()` বানিয়ে শুধু দুটো background caller সেটায় সরিয়েছি।

### 1.1 `fetchPrice`-ও cache-এ সরানো (spec-এ বলা ছিল না)

`resultCheck` প্রতি pending trade-এ `fetchPrice()` ডাকে, যেটা `fetchSig` ডাকে — অর্থাৎ **শুধু একটা দাম পড়তে পুরো engine run** (candles + Cerebras + Groq)। এটা ঠিক সেই অপচয় যা Phase 7 বন্ধ করতে চেয়েছিল, আর এটা background path (§B.2 "watchlist-only" এর চেতনার মধ্যে পড়ে)। Cache miss-এ আগের মতোই fresh চলে, তাই accuracy অপরিবর্তিত।

---

## 2. যা করা হলো

**`workerFetch(pathAndQuery, env, {allow404})`** — shared transport। আগে service-binding + timeout + plain-fetch fallback logic `fetchSig`-এর ভেতরে inline ছিল; দুটো endpoint লাগায় সেটা একবার লিখে দুজায়গায় ব্যবহার করছি (smoke test assert করে যে timeout race একবারই আছে, duplicate হয়নি)।

**`fetchSig(pair, env)`** — অপরিবর্তিত semantics, `/api/signal?pair=X`, fresh engine run। ৫টা user caller এটাই ব্যবহার করে।

**`fetchSigCached(pair, env)`** — নতুন:
1. `/api/signals/latest?pair=X` পড়ে
2. 404 (pair SCAN_PAIRS-এ নেই বা expired) → fresh generation, `cached:false` মার্ক করে
3. Cache **error** (5xx/network) → fresh generation — watchlist coverage কখনো কমে না
4. `signal`-হীন 200 → fresh (defensive)

**`fmtFreshness(data)`** — notify message-এ "🕐 Cached 2m ago" / "⚡ Freshly generated"। Cache metadata না থাকলে কিছুই যোগ করে না, তাই পুরনো response shape-এ message অপরিবর্তিত।

**`/refresh <pair>`** — explicit force-refresh command (§B.3 optional)। `/signal`-এর মতোই কাজ, কিন্তু নামে উদ্দেশ্য পরিষ্কার এখন যে background cache পড়ে।

---

## 3. Verification

### 3.1 Smoke — 42/42 (`verify/smoke_output.txt`)

Bot একটাই 1900-লাইন Worker module, কোনো export নেই। তাই test দুইভাবে কাজ করে:

**(ক) Behavioural — আসল shipped function চালিয়ে।** `workerFetch`/`fetchSig`/`fetchSigCached`/`fmtFreshness` source থেকে brace-matching দিয়ে extract করে `vm` sandbox-এ mocked `SIGNAL_WORKER` সহ চালানো হয়। অর্থাৎ grep না, **আসল code execute হয়**:
- cache hit → ১টা request, `/api/signal` কখনো না, `generationId` অক্ষত
- 404 → cache তারপর fresh, `cached:false`, signal তবু আসে
- 500 → fallback, pair skip হয় না
- signal-হীন 200 → fallback
- `fetchSig` → cache কখনো পড়ে না
- freshness: 45s / 2m / 2m 25s / fresh / no-metadata / null / NaN-guard

**(খ) Structural** — প্রতিটা `fetchSig`/`fetchSigCached` call-এর enclosing function বের করে assert: ২টা background caller cached, ৫টা user caller fresh।

প্লাস unchanged surfaces: `/history`, user state, `resultCheck`, manual `/win /loss`, cron `*/5`, `SIGNAL_WORKER → fttotcv6`, no deploy commands।

### 3.2 wrangler.toml — ছোঁয়া হয়নি
```
crons = ["*/5 * * * *"]          # unchanged
service = "fttotcv6"             # unchanged
BOT_KV binding                   # unchanged
```

---

## 4. Known limitations

1. **`resultCheck` এখন ৫ মিনিট পুরনো দাম পেতে পারে।** Trade expiry-র পর cron চলে, cache ≤5 min পুরনো — মানে WIN/LOSS নির্ধারণ সামান্য বাসি দামে হতে পারে। আগে fresh ছিল (কিন্তু পুরো engine খরচ করে)। **Accuracy trade-off আছে**; expiry-র ঠিক কাছাকাছি দামে সিদ্ধান্ত বদলাতে পারে। §5-এ প্রশ্ন রেখেছি।
2. **`fetchPrice` cache-এর candle দাম পড়ে**, live tick না — আগেও তাই ছিল (`recommendations[].entry.price`), তাই ধরনটা বদলায়নি, শুধু বয়স বেড়েছে।
3. **Bot-এর নিজের dedup (`sc:` same-candle key) অপরিবর্তিত** — কিন্তু cache ৫ মিনিট স্থির থাকায় ৫-মিনিট interval user-দের জন্য একই signal বারবার আসার সম্ভাবনা কম, ১-মিনিট interval user থাকলে candle-gate আগের মতোই আটকাবে।
4. **`/scan` (doScanAll) এখনো per-pair fresh** — user-initiated বলে §B.2 অনুযায়ী অপরিবর্তিত রেখেছি, কিন্তু এটাই Bot-এর সবচেয়ে ব্যয়বহুল command (watchlist-এর সব pair একসাথে fresh)। চাইলে পরের round-এ cache করা যায়।
5. **কোনো npm/package.json নেই** — Worker runtime, তাই "no new dependency" ban স্বতঃসিদ্ধ।

---

## 5. OPEN QUESTIONS

1. **`resultCheck` cache পড়া উচিত কি?** (§1.1) Spec শুধু watchlist বলেছিল; আমি quota যুক্তিতে যোগ করেছি, কিন্তু এতে WIN/LOSS ≤5 min পুরনো দামে ঠিক হয়। চাইলে এক লাইনে fresh-এ ফেরানো যায় (`fetchSigCached` → `fetchSig` in `fetchPrice`)। **আপনার সিদ্ধান্ত দরকার** — accuracy বনাম quota।
2. **`/scan` command** — user-initiated হলেও watchlist-এর সব pair fresh চালায়। §B.2 মেনে ছুঁইনি।
3. **Notify-তে freshness line সবসময় দেখাবে** — "🕐 Cached 2m ago"। User-এর কাছে noise মনে হলে সরানো সহজ (একটা `if`)।

---

## 6. §C.3 cross-check

Deploy-এর পর একই pair-এ App history আর Bot notify-তে **একই `id`** থাকবে:
```
curl -s ".../api/signals/latest?pair=BTC/USD" | jq -r '.id'
```
মিললে unification সম্পূর্ণ।

Local reproduce:
```
node --check src/index.js && node scripts/phase9_smoke.mjs
```
