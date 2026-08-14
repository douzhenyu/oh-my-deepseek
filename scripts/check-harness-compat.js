#!/usr/bin/env node
'use strict';

/**
 * DeepSeek Harness 上游兼容性自检
 *
 * The desktop client depends on three observable "contracts" of the harness:
 *   1. Web GUI at the base URL (http://127.0.0.1:3080)
 *   2. Theme DOM signals: body[data-ds-dark-theme] + documentElement.style.colorScheme
 *   3. Settings API: POST /api/settings.describe with an RPC envelope,
 *      ui-theme namespace carrying a `preference` of dark|light|system
 *
 * Run this after every harness upgrade: node scripts/check-harness-compat.js
 * (or npm run check-compat). Each FAIL/WARN line tells you exactly which part
 * of preload.js / main.js needs updating.
 */

const BASE = (process.env.DEEPSEEK_URL || 'http://127.0.0.1:3080').replace(/\/+$/, '');

let failed = 0;
let warned = 0;

function report(ok, name, detail, hint) {
  const tag = ok ? 'PASS' : hint === 'WARN' ? 'WARN' : 'FAIL';
  if (!ok) {
    if (hint === 'WARN') warned++;
    else failed++;
  }
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok && hint && hint !== 'WARN') console.log(`        fix: ${hint}`);
}

async function main() {
  console.log(`Checking harness contract at ${BASE}\n`);

  // 1) Reachability + harness revision
  let html = '';
  try {
    const res = await fetch(BASE + '/');
    html = await res.text();
    const m = html.match(/window\.__DSH_BOOT__\s*=\s*\{[^}]*"rev"\s*:\s*"([^"]+)"/);
    report(true, 'Web GUI reachable', `${res.status}${m ? `, harness rev=${m[1]}` : ''}`);
  } catch (e) {
    report(false, 'Web GUI reachable', e.message, 'Is the harness running at ' + BASE + '?');
    process.exitCode = 1;
    return;
  }

  // 2) Theme DOM contract (boot script in served HTML)
  report(
    html.includes('data-ds-dark-theme'),
    'Theme DOM signal: data-ds-dark-theme',
    html.includes('data-ds-dark-theme') ? 'present in boot script' : 'MISSING',
    'Update the DARK_ATTRIBUTE in preload.js to the new attribute/class name.'
  );
  report(
    /colorScheme\s*=\s*(dark|light)/.test(html),
    'Theme DOM signal: documentElement.style.colorScheme',
    'present in boot script',
    'Update readTheme() in preload.js to the new scheme mechanism.'
  );

  // 3) Settings API envelope + ui-theme preference
  try {
    const res = await fetch(BASE + '/api/settings.describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'compat-check-' + Date.now(),
        method: 'settings.describe',
        payload: {},
      }),
    });
    const okEnvelope = res.ok;
    let pref = null;
    let nsFound = false;
    if (okEnvelope) {
      const data = await res.json();
      const namespaces = (data && data.result && data.result.value && data.result.value.namespaces) || [];
      const ns = namespaces.find((n) => n && n.ns === 'ui-theme');
      nsFound = !!ns;
      if (ns) {
        pref = (ns.value && ns.value.preference) || (ns.user && ns.user.preference);
      }
    }
    report(okEnvelope, 'Settings API: envelope accepted', okEnvelope ? 'settings.describe ok' : 'HTTP ' + res.status,
      'Update the envelope shape in main.js (ipcMain.handle "theme-preference").');
    report(nsFound, 'Settings API: ui-theme namespace', nsFound ? 'found' : 'MISSING',
      'Update the namespace lookup in main.js to the new namespace id.');
    report(pref === 'dark' || pref === 'light' || pref === 'system',
      'Settings API: preference field', pref ? `value=${pref}` : 'MISSING',
      'Update the field path in main.js (ui-theme.preference).');
  } catch (e) {
    report(false, 'Settings API', e.message, 'Update main.js (ipcMain.handle "theme-preference").');
  }

  console.log(`\n${failed === 0 ? '✓ All checks passed.' : `✗ ${failed} check(s) failed.`}${warned ? ` (${warned} warn)` : ''}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('script error:', e.message);
  process.exitCode = 1;
});
