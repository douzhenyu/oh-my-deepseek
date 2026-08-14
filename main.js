'use strict';

const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } = require('electron');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const APP_URL = process.env.DEEPSEEK_URL || 'http://127.0.0.1:3080';

// --- Performance tuning ---
// Profiling (CDP tracing) showed the harness GUI is allocation-heavy
// (trajectory tables, plugin inventory, long message lists): the renderer
// runs frequent V8 major GCs whose stop-the-world pauses (100-150ms, mostly
// the evacuate/compact phase) cause visible scroll / first-open jank.
// Rendering & compositing are fine. --no-compact skips the expensive
// evacuate phase (live set is small, so fragmentation cost is negligible);
// a larger young generation reduces scavenge churn.
app.commandLine.appendSwitch('js-flags', '--no-compact --max-semi-space-size=64');

let mainWindow = null;
let retryTimer = null;
let backendChild = null; // backend process spawned BY US (killed on quit)
let bootPromise = null;

// ---------------------------------------------------------------------------
// Backend auto-start: when the user launches the client and no DeepSeek
// Harness backend is listening, spawn it headless (no Terminal window), wait
// for it to be ready, then load the GUI. On full quit (Cmd+Q), the spawned
// backend is killed automatically. Backends the user started manually are
// detected and never touched.
// ---------------------------------------------------------------------------

// Exact dsh entry on this machine (npx cache). Harness updates can change
// this path; resolveBackendCommand() also scans for newer npx copies and
// falls back to PATH / DEEPSEEK_BACKEND_CMD.
const KNOWN_DSH_BIN =
  '/Users/dou/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js';

function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch (e) {
    return false;
  }
}

function parseCommand(s) {
  const parts = (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((p) => p.replace(/^["']|["']$/g, ''));
  return { cmd: parts[0], args: parts.slice(1) };
}

function resolveBackendCommand() {
  // 1) explicit override: DEEPSEEK_BACKEND_CMD="node /path/to/dsh --port 3080"
  if (process.env.DEEPSEEK_BACKEND_CMD) return parseCommand(process.env.DEEPSEEK_BACKEND_CMD);
  // 2) known absolute path from this machine
  if (fs.existsSync(KNOWN_DSH_BIN)) return { cmd: 'node', args: [KNOWN_DSH_BIN] };
  // 3) newest copy across npx cache dirs (harness updates may add a new one)
  try {
    const npxRoot = path.join(os.homedir(), '.npm', '_npx');
    if (fs.existsSync(npxRoot)) {
      const hits = fs
        .readdirSync(npxRoot)
        .map((d) => path.join(npxRoot, d, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
        .filter((p) => fs.existsSync(p))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (hits.length > 0) return { cmd: 'node', args: [hits[0]] };
    }
  } catch (e) {}
  // 4) resolve 'dsh' via PATH (works if globally installed)
  return { cmd: 'dsh', args: [] };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect(Number(port), '127.0.0.1', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

function waitForBackend(port, child, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    let timer = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      resolve(v);
    };
    if (child) {
      child.on('error', (e) => finish({ ok: false, reason: '无法启动后端：' + e.message }));
      child.on('exit', (code) => finish({ ok: false, reason: `后端进程意外退出（code=${code}）` }));
    }
    timer = setInterval(async () => {
      if (await portOpen(port)) finish({ ok: true });
      else if (Date.now() - start > timeoutMs) {
        finish({ ok: false, reason: '等待后端启动超时（首次启动可能较慢）' });
      }
    }, 500);
  });
}

async function ensureBackend() {
  let u;
  try {
    u = new URL(APP_URL);
  } catch (e) {
    return { ok: false, spawned: false, reason: `无效的 DEEPSEEK_URL：${APP_URL}` };
  }
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (await portOpen(port)) return { ok: true, spawned: false }; // already running

  if (!isLocalUrl(APP_URL)) {
    return {
      ok: false,
      spawned: false,
      reason: `目标地址 ${APP_URL} 不是本机服务，客户端不会自动启动后端，请先手动启动。`,
    };
  }

  const bc = resolveBackendCommand();
  try {
    backendChild = spawn(bc.cmd, [...bc.args, '--profile', 'web', '--port', port], {
      stdio: 'ignore',
      detached: true, // own process group so we can kill the whole tree on quit
      env: process.env,
    });
  } catch (e) {
    return { ok: false, spawned: false, reason: '无法启动后端：' + e.message };
  }

  const r = await waitForBackend(port, backendChild, 90000);
  if (!r.ok) {
    try {
      process.kill(-backendChild.pid, 'SIGTERM');
    } catch (e2) {}
    backendChild = null;
    return { ok: false, spawned: false, reason: r.reason };
  }
  return { ok: true, spawned: true };
}

function loadLoading() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile('loading.html').catch(() => {});
  }
}

function showLoadingError(reason) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow
      .loadFile('loading.html', { query: { error: encodeURIComponent(reason) } })
      .catch(() => {});
  }
}

function boot() {
  if (!bootPromise) {
    bootPromise = ensureBackend().then((r) => {
      bootPromise = null; // allow re-boot (e.g. window re-opened via Dock)
      if (r.ok) loadApp();
      else if (r.reason) showLoadingError(r.reason);
    });
  }
  return bootPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    title: 'DeepSeek Harness',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep timers/animations running when the window is occluded or
      // unfocused so scroll/animations don't stutter on focus changes.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Show only the base app name in the title bar. The page sets
  // document.title to "<会话名> — DeepSeek Harness"; strip the prefix so the
  // title bar reads just "DeepSeek Harness" (adapts if the base name changes).
  mainWindow.on('page-title-updated', (event, title) => {
    event.preventDefault();
    const base = String(title).split(' — ').pop().trim();
    mainWindow.setTitle(base || 'DeepSeek Harness');
  });

  // Open external links in the default browser; keep internal navigation in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Auto-reconnect if the backend is not running when the app starts.
  mainWindow.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) scheduleRetry();
  });
  mainWindow.webContents.on('did-finish-load', () => clearRetry());

  mainWindow.on('closed', () => {
    clearRetry();
    mainWindow = null;
  });

  loadLoading();
}

function isInternal(url) {
  return (
    url.startsWith(APP_URL) ||
    url.startsWith('http://localhost:3080') ||
    url.startsWith('http://127.0.0.1:3080')
  );
}

function loadApp() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(APP_URL).catch(() => {});
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(loadApp, 3000);
}

function clearRetry() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

// Keep the native window frame (title bar) in sync with the page's theme
// preference ('dark' | 'light' | 'system'). When the user picks "跟随系统",
// themeSource stays 'system' so the page keeps seeing the real OS scheme.
function applyTheme(theme) {
  nativeTheme.themeSource = theme;
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(dark ? '#0f1115' : '#ffffff');
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setName('DeepSeek');
    app.setAboutPanelOptions({
      applicationName: 'DeepSeek',
      applicationVersion: app.getVersion(),
      copyright: 'Desktop client for the local DeepSeek Harness',
    });
    ipcMain.on('theme-changed', (event, theme) => {
      if (theme === 'dark' || theme === 'light' || theme === 'system') applyTheme(theme);
    });
    // Harness settings API lives here (main process): immune to any page CSP,
    // and a single, easily testable place to update if the harness changes
    // its settings API shape. Returns 'dark' | 'light' | 'system' | null.
    ipcMain.handle('theme-preference', async () => {
      try {
        const api = APP_URL.replace(/\/+$/, '') + '/api/settings.describe';
        const res = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: randomUUID(),
            method: 'settings.describe',
            payload: {},
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const namespaces = (data && data.result && data.result.value && data.result.value.namespaces) || [];
        const ns = namespaces.find((n) => n && n.ns === 'ui-theme');
        const pref = ns && ((ns.value && ns.value.preference) || (ns.user && ns.user.preference));
        return pref === 'dark' || pref === 'light' || pref === 'system' ? pref : null;
      } catch (e) {
        return null;
      }
    });
    buildMenu();
    createWindow();
    boot();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        boot();
      }
    });
  });

  // Full quit (Cmd+Q): stop the backend we spawned. Backends the user
  // started manually (spawned === false) are left untouched.
  app.on('will-quit', () => {
    if (backendChild && backendChild.pid) {
      try {
        process.kill(-backendChild.pid, 'SIGTERM');
      } catch (e) {}
      backendChild = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
