'use strict';

const { ipcRenderer } = require('electron');

const DARK_ATTRIBUTE = 'data-ds-dark-theme';
let lastMode = null;

/**
 * Read the harness theme *preference* (ui-theme settings namespace) via the
 * main process, which calls the harness settings API. Returns
 * 'dark' | 'light' | 'system', or null on failure. This is what the window
 * frame must follow: when the user picks "跟随系统", nativeTheme must stay
 * on 'system' so the page keeps seeing the real OS scheme (forcing dark/light
 * there would break OS-following).
 */
async function fetchPreference() {
  try {
    return await ipcRenderer.invoke('theme-preference');
  } catch (e) {
    return null;
  }
}

function readTheme() {
  // 1) Authoritative: body carries data-ds-dark-theme in dark mode.
  try {
    if (document.body && document.body.hasAttribute(DARK_ATTRIBUTE)) return 'dark';
  } catch (e) {}

  // 2) Inline color-scheme written by the theme presenter.
  try {
    const scheme = document.documentElement && document.documentElement.style.colorScheme;
    if (scheme === 'dark') return 'dark';
    if (scheme === 'light') return 'light';
  } catch (e) {}

  // 3) Computed color-scheme.
  try {
    const cs = getComputedStyle(document.documentElement).colorScheme || '';
    if (cs.includes('dark') && !cs.includes('light')) return 'dark';
    if (cs.includes('light') && !cs.includes('dark')) return 'light';
  } catch (e) {}

  // 4) Fallback: rendered background luminance of body/html.
  let lum = bgLuminance(document.body);
  if (lum == null) lum = bgLuminance(document.documentElement);
  if (lum != null) return lum < 0.5 ? 'dark' : 'light';

  return null;
}

function bgLuminance(el) {
  if (!el) return null;
  const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map(Number);
  if (p.length >= 4 && p[3] === 0) return null; // transparent
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
}

async function report() {
  // Primary: follow the user's theme *preference*.
  const pref = await fetchPreference();
  let mode = pref;
  // Fallback (API unavailable): match the effective rendered theme instead.
  if (!mode) mode = readTheme();
  if (mode && mode !== lastMode) {
    lastMode = mode;
    ipcRenderer.send('theme-changed', mode);
  }
}

function start() {
  report();

  if (document.body) {
    new MutationObserver(report).observe(document.body, {
      attributes: true,
      attributeFilter: [DARK_ATTRIBUTE],
    });
  }
  if (document.documentElement) {
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  // Poll the preference: switching e.g. 'dark' -> 'system' while the OS is
  // already dark changes the preference but not the rendered theme, so the
  // observers above won't fire and only this poll notices it.
  setInterval(report, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
