/**
 * Phase 9 smoke tests — node scripts/phase9_smoke.mjs
 *
 * The Bot is one 1900-line Worker module with no exports, so these tests work
 * two ways:
 *   1. behavioural — the cache-routing and freshness helpers are re-created
 *      from the real source by extracting the functions and evaluating them
 *      against a mocked worker, so the actual shipped logic is executed;
 *   2. structural — asserts on the source that user commands still force fresh
 *      generation and that only background paths were switched to the cache.
 *
 * No network, no Telegram, no KV.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = readFileSync(path.join(root, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (n, c, d) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; failures.push(n); console.log('FAIL  ' + n + (d ? ' — ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));

/** Pull a top-level function's source out of the module by brace matching. */
function extractFn(name) {
  const re = new RegExp('(?:^|\\n)(async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('function not found: ' + name);
  // m[0] may begin with the preceding newline; skip it but KEEP `async`.
  const start = m.index + (src[m.index] === '\n' ? 1 : 0);

  // Skip the PARAMETER LIST before brace-matching the body: a destructured
  // default like `{ allow404 = false } = {}` would otherwise be mistaken for
  // the function body and truncate the extraction.
  let p = src.indexOf('(', m.index), pd = 0;
  for (; p < src.length; p++) {
    if (src[p] === '(') pd++;
    else if (src[p] === ')') { pd--; if (pd === 0) { p++; break; } }
  }

  let i = src.indexOf('{', p), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Build a sandbox containing the REAL fetchSig / fetchSigCached / workerFetch /
// fmtFreshness, with the network faked.
function buildSandbox(routes) {
  const calls = [];
  const ctx = {
    console: { log: () => {} },
    setTimeout, clearTimeout, Promise, Error, JSON, Math, Object, encodeURIComponent,
    AbortSignal: { timeout: () => undefined },
    Request: class { constructor(url) { this.url = url; } },
    fetch: async (url) => { throw new Error('direct fetch should not be used when SIGNAL_WORKER exists: ' + url); },
    __calls: calls,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // module-level constant the extracted functions close over
  const workerUrl = /const WORKER_URL = '([^']+)'/.exec(src);
  vm.runInContext(
    `const WORKER_URL = ${JSON.stringify(workerUrl ? workerUrl[1] : '')};\n` +
    extractFn('workerFetch') + '\n' +
    extractFn('fetchSig') + '\n' +
    extractFn('fetchSigCached') + '\n' +
    extractFn('fmtFreshness') + '\n', ctx);

  const env = {
    SIGNAL_WORKER: {
      fetch: async (req) => {
        calls.push(req.url);
        for (const [match, make] of routes) {
          if (req.url.includes(match)) return make();
        }
        throw new Error('unrouted ' + req.url);
      },
    },
  };
  return { ctx, env, calls };
}

const res = (body, status = 200) => () => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const sigBody = (extra = {}) => ({
  id: 'sig_1', pair: 'BTC/USD', marketStatus: 'OPEN',
  signal: { finalSignal: 'BUY', confidence: '87%' }, ...extra,
});

console.log('── background scan reads the shared cache ─────────────────');
{
  const { ctx, env, calls } = buildSandbox([
    ['/api/signals/latest', res(sigBody({ cached: true, generationAge: 120, generationId: 'gen_a' }))],
  ]);
  const out = await ctx.fetchSigCached('BTCUSD', env);
  eq('one request', calls.length, 1);
  ok('hit the cache endpoint', calls[0].includes('/api/signals/latest?pair=BTCUSD'), calls[0]);
  ok('never ran the engine', !calls.some(c => c.includes('/api/signal?')));
  eq('cached payload returned', out.cached, true);
  eq('generationId preserved (same id the App sees)', out.generationId, 'gen_a');
}

console.log('\n── cache miss falls back to a fresh run ───────────────────');
{
  const { ctx, env, calls } = buildSandbox([
    ['/api/signals/latest', res({ error: true, stale: true }, 404)],
    ['/api/signal?', res(sigBody())],
  ]);
  const out = await ctx.fetchSigCached('USDCHF', env);
  eq('two requests', calls.length, 2);
  ok('cache first', calls[0].includes('/api/signals/latest'));
  ok('then fresh', calls[1].includes('/api/signal?pair=USDCHF'));
  eq('marked not cached', out.cached, false);
  ok('watchlist coverage preserved (still got a signal)', !!out.signal);
}

console.log('\n── cache error also falls back (never skips a pair) ───────');
{
  const { ctx, env, calls } = buildSandbox([
    ['/api/signals/latest', res({}, 500)],
    ['/api/signal?', res(sigBody())],
  ]);
  const out = await ctx.fetchSigCached('BTCUSD', env);
  eq('fell through after the 500', calls.length, 2);
  ok('still returned a signal', !!out.signal);
}

console.log('\n── a 200 without a signal is treated as a miss ────────────');
{
  const { ctx, env, calls } = buildSandbox([
    ['/api/signals/latest', res({ cached: true, pair: 'BTC/USD' })],
    ['/api/signal?', res(sigBody())],
  ]);
  const out = await ctx.fetchSigCached('BTCUSD', env);
  eq('fresh run attempted', calls.length, 2);
  ok('usable signal returned', !!out.signal);
}

console.log('\n── user command path stays fresh ──────────────────────────');
{
  const { ctx, env, calls } = buildSandbox([['/api/signal?', res(sigBody())]]);
  await ctx.fetchSig('EURUSD', env);
  eq('single request', calls.length, 1);
  ok('goes straight to the engine', calls[0].includes('/api/signal?pair=EURUSD'));
  ok('never reads the cache', !calls.some(c => c.includes('/api/signals/latest')));
}

console.log('\n── freshness line (B3) ────────────────────────────────────');
{
  const { ctx } = buildSandbox([]);
  eq('seconds', ctx.fmtFreshness({ cached: true, generationAge: 45 }), '🕐 Cached 45s ago');
  eq('exact minutes', ctx.fmtFreshness({ cached: true, generationAge: 120 }), '🕐 Cached 2m ago');
  eq('minutes + seconds', ctx.fmtFreshness({ cached: true, generationAge: 145 }), '🕐 Cached 2m 25s ago');
  eq('fresh run', ctx.fmtFreshness({ cached: false }), '⚡ Freshly generated');
  eq('no metadata -> nothing', ctx.fmtFreshness({}), null);
  eq('null safe', ctx.fmtFreshness(null), null);
  eq('cached but no age', ctx.fmtFreshness({ cached: true }), '🕐 Cached');
  ok('never emits NaN', !String(ctx.fmtFreshness({ cached: true, generationAge: 'x' })).includes('NaN'));
}

console.log('\n── structural: only background paths switched ─────────────');
{
  const fnOf = (line) => {
    const upto = src.slice(0, line);
    const m = [...upto.matchAll(/\n(?:async )?function ([a-zA-Z0-9_]+)\s*\(/g)].pop();
    return m ? m[1] : '?';
  };
  const callers = [...src.matchAll(/fetchSig(Cached)?\(/g)]
    .map(m => ({ cached: !!m[1], fn: fnOf(m.index) }))
    .filter(c => c.fn !== 'fetchSigCached' && c.fn !== 'fetchPrice' || c.cached);

  const background = ['autoScan', 'fetchPrice'];
  const userFacing = ['doSignal', 'doQuickSignal', 'doScanAll', 'doReplay', 'doAnalyze'];

  for (const fn of background) {
    const hits = callers.filter(c => c.fn === fn);
    ok(`background ${fn}() uses the cache`, hits.length > 0 && hits.every(c => c.cached),
       JSON.stringify(hits));
  }
  for (const fn of userFacing) {
    const hits = callers.filter(c => c.fn === fn);
    ok(`user command ${fn}() stays fresh`, hits.length > 0 && hits.every(c => !c.cached),
       JSON.stringify(hits));
  }
}

console.log('\n── unchanged surfaces (spec §B.2) ─────────────────────────');
{
  ok('/history untouched', src.includes("text.startsWith('/history')"));
  ok('/settings-style state untouched', src.includes('saveUser('));
  ok('result reporting flow intact', src.includes('async function resultCheck'));
  ok('manual /win /loss intact', src.includes("text.startsWith('/win')") || src.includes("'/win'"));
  ok('/refresh command added', src.includes("text.startsWith('/refresh')"));
  ok('help mentions /refresh', src.includes('/refresh EURUSD'));
  ok('cron interval unchanged (5 min)',
     readFileSync(path.join(root, 'wrangler.toml'), 'utf8').includes('crons = ["*/5 * * * *"]'));
  ok('SIGNAL_WORKER binding unchanged',
     readFileSync(path.join(root, 'wrangler.toml'), 'utf8').includes('service = "fttotcv6"'));
  ok('no deploy commands', !/wrangler deploy|git push/.test(src));
  ok('single shared transport (no duplicated fetch logic)',
     (src.match(/new Promise\(\(_, rej\) => setTimeout/g) || []).length === 1);
}

console.log('\n───────────────────────────────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail > 0) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('ALL PHASE 9 SMOKE TESTS PASSED');
