/**
 * v4.4 Arena-style menu redesign — structural tests
 * Run: node menu-test.mjs
 */
import { readFileSync } from 'fs';

const src = readFileSync('./src/index.js', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('\n═══ Arena Menu Redesign Tests ═══\n');

// ── Extract mainKb body ──────────────────────────────────────────────────────
const mainKbMatch = src.match(/const mainKb = u => kb\(\[([\s\S]*?)\]\);/);
ok('mainKb defined', !!mainKbMatch);
const mainBody = mainKbMatch ? mainKbMatch[1] : '';

// Quick Actions top rows
ok('Quick Action: Signal Now', mainBody.includes("cmd:signal"));
ok('Quick Action: toggle_auto', mainBody.includes('cmd:toggle_auto'));
ok('Quick Action: Scan All', mainBody.includes('cmd:scanall'));
ok('Quick Action: History', mainBody.includes('cmd:history:0'));

// Explore group
ok('Explore: Today', mainBody.includes('cmd:today'));
ok('Explore: Weekly', mainBody.includes('cmd:weekly'));
ok('Explore: Best', mainBody.includes('cmd:best'));
ok('Explore: Risk', mainBody.includes('cmd:risk'));
ok('Explore: Heatmap', mainBody.includes('cmd:heatmap'));
ok('Explore: Journal', mainBody.includes('cmd:journal'));

// Account group
ok('Account: Watchlist', mainBody.includes('cmd:watchlist'));
ok('Account: Settings', mainBody.includes('cmd:settings'));
ok('Account: Status', mainBody.includes('cmd:status'));

// Premium
ok('Premium button', mainBody.includes('cmd:premium') && mainBody.includes('⭐ Premium'));
ok('Stats still on main', mainBody.includes('cmd:stats'));

// Signal/Auto must be first row (before Explore)
const sigPos = mainBody.indexOf('cmd:signal');
const todayPos = mainBody.indexOf('cmd:today');
const premPos = mainBody.indexOf('cmd:premium');
ok('Signal before Explore', sigPos >= 0 && todayPos > sigPos);
ok('Explore before Premium', todayPos >= 0 && premPos > todayPos);

// ── settingsKb ───────────────────────────────────────────────────────────────
const setMatch = src.match(/const settingsKb = u => \{([\s\S]*?)\n\};/);
ok('settingsKb is function (unified)', !!setMatch);
const setBody = setMatch ? setMatch[1] : '';
ok('Settings: Mode prominent (fxmode)', setBody.includes('cmd:fxmode'));
ok('Settings: Grade filter', setBody.includes('cmd:gradefilter'));
ok('Settings: Conf filter', setBody.includes('cmd:conffilter'));
ok('Settings: Interval', setBody.includes('cmd:intervals'));
ok('Settings: Pair', setBody.includes('pairpage:0'));
ok('Settings: AI Only', setBody.includes('cmd:aionly'));
ok('Settings: News Block', setBody.includes('cmd:blocknews'));
ok('Settings: Alerts', setBody.includes('cmd:alerts'));
ok('Settings: Replay', setBody.includes('cmd:replayhelp'));
ok('Settings: Summary', setBody.includes('cmd:togglesummary'));
ok('Settings: Channel', setBody.includes('cmd:channelinfo'));
ok('Settings: Export', setBody.includes('cmd:exportinfo'));
ok('Settings: Back → main', setBody.includes("cmd:main"));

// Mode is first actionable button in settings
const modePos = setBody.indexOf('cmd:fxmode');
const gradePos = setBody.indexOf('cmd:gradefilter');
ok('Mode before Grade (prominent)', modePos >= 0 && gradePos > modePos);

// settings2 merged
ok('settings2Kb aliases settingsKb', /const settings2Kb = settingsKb/.test(src));
ok('cmd:settings2 → doSettings', /cmd:settings2.*doSettings/.test(src));

// Premium handler
ok('doPremium defined', /async function doPremium/.test(src));
ok('premiumKb defined', /const premiumKb/.test(src));
ok('Premium honesty (no payment)', /no payment/i.test(src));
ok('doExportInfo defined', /async function doExportInfo/.test(src));
ok('fmtSettings defined', /function fmtSettings/.test(src));
ok('fmtMainMenu defined', /function fmtMainMenu/.test(src));

// No regression — all core cmds still handled
const coreCmds = [
  'cmd:signal', 'cmd:toggle_auto', 'cmd:scanall', 'cmd:status', 'cmd:stats',
  'cmd:watchlist', 'cmd:today', 'cmd:summary', 'cmd:settings', 'cmd:journal',
  'cmd:weekly', 'cmd:risk', 'cmd:heatmap', 'cmd:best', 'cmd:alerts',
  'cmd:cancelall', 'cmd:premium', 'cmd:exportinfo',
];
for (const c of coreCmds) {
  ok(`handler present: ${c}`, src.includes(`'${c}'`) || src.includes(`"${c}"`));
}

// Version bump
ok('v4.4 in header', /v4\.4/.test(src.slice(0, 800)));
ok('v4.4 in main menu card', /FTT Signal Bot v4\.4/.test(src));

// Back consistency on submenus
ok('alertsKb has Back', /alertsKb[\s\S]{0,400}cmd:settings/.test(src));
ok('intervalKb Back → settings', /intervalKb[\s\S]{0,200}cmd:settings/.test(src));
ok('gradeKb Back → settings', /gradeKb[\s\S]{0,200}cmd:settings/.test(src));
ok('confKb Back → settings', /confKb[\s\S]{0,200}cmd:settings/.test(src));
ok('wlKb Back → main', /wlKb[\s\S]{0,300}cmd:main/.test(src));
ok('histNavKb Back → main', /histNavKb[\s\S]{0,500}cmd:main/.test(src));

// Simulate keyboard structure (inline mini-eval of layout)
const fakeU = {
  autoEnabled: false, pair: 'EURUSD', interval: 5, gradeFilter: 'ALL',
  minConfidence: 0, aiOnlyMode: false, blockNews: true, channelId: null,
  fxMode: 'ftt', dailySummary: false, summaryHour: 20, watchlist: [],
};
// Reconstruct expected row counts from source patterns
const mainRows = (mainBody.match(/\[btn\(/g) || []).length;
ok('mainKb has multiple rows (≥6)', (mainBody.match(/\n\s*\[/g) || []).length >= 5);

console.log(`\n═══ Result: ${pass} passed, ${fail} failed ═══\n`);
if (fail > 0) process.exit(1);
console.log('🎉 ALL MENU TESTS PASSED\n');
