'use strict';

const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } = require('electron');
const { randomUUID } = require('crypto');
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

  loadApp();
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
