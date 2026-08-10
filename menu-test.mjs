/**
 * v4.4 Arena hub menu — structural tests (matches Arena screenshot pattern)
 * Run: node menu-test.mjs
 */
import { readFileSync } from 'fs';

const src = readFileSync('./src/index.js', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('\n═══ Arena Hub Menu Tests ═══\n');

// ── mainKb = 2×3 Arena hub ───────────────────────────────────────────────────
const mainKbMatch = src.match(/const mainKb = u => kb\(\[([\s\S]*?)\]\);/);
ok('mainKb defined', !!mainKbMatch);
const mainBody = mainKbMatch ? mainKbMatch[1] : '';

ok('Hub: Signal Now', mainBody.includes('cmd:signal') && mainBody.includes('Signal Now'));
ok('Hub: Watchlist', mainBody.includes('cmd:watchlist'));
ok('Hub: Premium 🚀', mainBody.includes('cmd:premium') && mainBody.includes('Premium'));
ok('Hub: Quick actions ⚡', mainBody.includes('cmd:quick') && /Quick actions/i.test(mainBody));
ok('Hub: History', mainBody.includes('cmd:history:0'));
ok('Hub: Settings', mainBody.includes('cmd:settings'));

// Exactly 6 hub buttons (3 rows × 2) — no clutter of every explore item on main
const mainBtnCount = (mainBody.match(/btn\(/g) || []).length;
ok('Hub has 6 buttons (2×3)', mainBtnCount === 6, `got ${mainBtnCount}`);

// Signal is first (top-left like Arena "New chat")
const sigPos = mainBody.indexOf('cmd:signal');
const quickPos = mainBody.indexOf('cmd:quick');
const histPos = mainBody.indexOf('cmd:history:0');
const setPos = mainBody.indexOf('cmd:settings');
ok('Signal before Quick actions', sigPos >= 0 && quickPos > sigPos);
ok('Quick before History/Settings row', quickPos >= 0 && histPos > quickPos && setPos > quickPos);

// ── quickKb submenu ──────────────────────────────────────────────────────────
const quickMatch = src.match(/const quickKb = u => kb\(\[([\s\S]*?)\]\);/);
ok('quickKb defined', !!quickMatch);
const qBody = quickMatch ? quickMatch[1] : '';
ok('Quick: Signal', qBody.includes('cmd:signal'));
ok('Quick: Auto toggle', qBody.includes('cmd:toggle_auto'));
ok('Quick: Scan', qBody.includes('cmd:scanall'));
ok('Quick: Status', qBody.includes('cmd:status'));
ok('Quick: Today', qBody.includes('cmd:today'));
ok('Quick: Weekly', qBody.includes('cmd:weekly'));
ok('Quick: Best', qBody.includes('cmd:best'));
ok('Quick: Risk', qBody.includes('cmd:risk'));
ok('Quick: Heatmap', qBody.includes('cmd:heatmap'));
ok('Quick: Journal', qBody.includes('cmd:journal'));
ok('Quick: Stats', qBody.includes('cmd:stats'));
ok('Quick: Summary', qBody.includes('cmd:summary'));
ok('Quick: Back → main', qBody.includes("cmd:main"));

// ── settingsKb ───────────────────────────────────────────────────────────────
const setMatch = src.match(/const settingsKb = u => \{([\s\S]*?)\n\};/);
ok('settingsKb unified function', !!setMatch);
const setBody = setMatch ? setMatch[1] : '';
ok('Settings: Mode prominent', setBody.includes('cmd:fxmode'));
ok('Settings: Grade', setBody.includes('cmd:gradefilter'));
ok('Settings: Conf', setBody.includes('cmd:conffilter'));
ok('Settings: Interval', setBody.includes('cmd:intervals'));
ok('Settings: Pair', setBody.includes('pairpage:0'));
ok('Settings: AI Only', setBody.includes('cmd:aionly'));
ok('Settings: News Block', setBody.includes('cmd:blocknews'));
ok('Settings: Alerts removed (F09 dead UI dropped in BUG-B3)', !setBody.includes('cmd:alerts'));
ok('Settings: Replay', setBody.includes('cmd:replayhelp'));
ok('Settings: Channel', setBody.includes('cmd:channelinfo'));
ok('Settings: Export', setBody.includes('cmd:exportinfo'));
ok('Settings: Back → main', setBody.includes("cmd:main"));
const modePos = setBody.indexOf('cmd:fxmode');
const gradePos = setBody.indexOf('cmd:gradefilter');
ok('Mode before Grade', modePos >= 0 && gradePos > modePos);

// Handlers
ok('cmd:quick handler', /cmd:quick/.test(src) && /doQuick/.test(src));
ok('doQuick defined', /async function doQuick/.test(src));
ok('doPremium defined', /async function doPremium/.test(src));
ok('premiumKb defined', /const premiumKb/.test(src));
ok('Premium honesty', /no payment/i.test(src));
ok('doExportInfo defined', /async function doExportInfo/.test(src));
ok('fmtMainMenu', /function fmtMainMenu/.test(src));
ok('fmtQuickMenu', /function fmtQuickMenu/.test(src));
ok('fmtSettings', /function fmtSettings/.test(src));
ok('backQuick helper', /const backQuick/.test(src));
ok('settings2Kb alias', /const settings2Kb = settingsKb/.test(src));

// Core handlers intact
const core = [
  'cmd:signal', 'cmd:toggle_auto', 'cmd:scanall', 'cmd:status', 'cmd:stats',
  'cmd:watchlist', 'cmd:today', 'cmd:summary', 'cmd:settings', 'cmd:journal',
  'cmd:weekly', 'cmd:risk', 'cmd:heatmap', 'cmd:best',
  'cmd:cancelall', 'cmd:premium', 'cmd:exportinfo', 'cmd:quick',
];
for (const c of core) ok(`handler: ${c}`, src.includes(`'${c}'`));
// F09 removed under BUG-B3 — no dead alerts callback may remain
ok('no alert callback handlers remain (F09 dropped)', !src.includes("'alertpage:") && !src.includes("'alertset:") && !src.includes("'alertdel:"));

// Auto toggle returns to quickKb (not main clutter)
ok('doToggle uses quickKb', /async function doToggle[\s\S]{0,2000}quickKb\(u\)/.test(src));

// Explore backs go to quick
ok('doStats backQuick', /async function doStats[\s\S]{0,400}backQuick/.test(src));
ok('doRisk backQuick', /async function doRisk[\s\S]{0,400}backQuick/.test(src));
ok('doToday backQuick', /async function doToday[\s\S]{0,800}backQuick/.test(src));

ok('v5.0 thin-client header', /v5\.0/.test(src.slice(0, 900)) || /v4\.4/.test(src.slice(0, 900)));
ok('v5.0 main card', /FTT Signal Bot v5\.0/.test(src) || /FTT Signal Bot v4\.4/.test(src));

console.log(`\n═══ Result: ${pass} passed, ${fail} failed ═══\n`);
if (fail > 0) process.exit(1);
console.log('🎉 ALL MENU TESTS PASSED\n');
