import { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { randomUUID } from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

type ThemeMode = 'dark' | 'light' | 'system';

interface BackendResult {
  ok: boolean;
  spawned: boolean;
  reason?: string;
}

interface BackendCommand {
  cmd: string;
  args: string[];
}

interface SettingsNamespace {
  ns?: string;
  value?: { preference?: unknown };
  user?: { preference?: unknown };
}

interface SettingsDocument {
  result?: { value?: { namespaces?: SettingsNamespace[] } };
}

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

let mainWindow: BrowserWindow | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let backendChild: ChildProcess | null = null; // backend process spawned BY US (killed on quit)
let bootPromise: Promise<void> | null = null;

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

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function parseCommand(s: string): BackendCommand {
  const parts = (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((p) => p.replace(/^["']|["']$/g, ''));
  return { cmd: parts[0] ?? '', args: parts.slice(1) };
}

function resolveBackendCommand(): BackendCommand {
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
        .map((dir) => path.join(npxRoot, dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
        .filter((p) => fs.existsSync(p))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (hits.length > 0) return { cmd: 'node', args: [hits[0] as string] };
    }
  } catch {
    /* fall through to PATH */
  }
  // 4) resolve 'dsh' via PATH (works if globally installed)
  return { cmd: 'dsh', args: [] };
}

function portOpen(port: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(Number(port), '127.0.0.1', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

function backendLogPath(): string {
  return path.join(app.getPath('userData'), 'backend.log');
}

function backendLogTail(maxChars = 900): string {
  try {
    const p = backendLogPath();
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8').slice(-maxChars);
  } catch {
    return '';
  }
}

function waitForBackend(
  port: string,
  child: ChildProcess | null,
  timeoutMs: number
): Promise<BackendResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (v: BackendResult) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      resolve(v);
    };
    if (child) {
      child.on('error', (e) => finish({ ok: false, spawned: false, reason: '无法启动后端：' + e.message }));
      child.on('exit', (code) =>
        finish({ ok: false, spawned: false, reason: `后端进程意外退出（code=${code}）` })
      );
    }
    timer = setInterval(async () => {
      if (await portOpen(port)) finish({ ok: true, spawned: true });
      else if (Date.now() - start > timeoutMs) {
        finish({ ok: false, spawned: false, reason: '等待后端启动超时（首次启动可能较慢）' });
      }
    }, 500);
  });
}

async function ensureBackend(): Promise<BackendResult> {
  let url: URL;
  try {
    url = new URL(APP_URL);
  } catch {
    return { ok: false, spawned: false, reason: `无效的 DEEPSEEK_URL：${APP_URL}` };
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
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
    // Capture the spawned backend's stderr into a log file (and the app's
    // stderr) so startup failures are diagnosable instead of invisible.
    const logStream = fs.createWriteStream(backendLogPath(), { flags: 'a' });
    const argv = [...bc.args, '--profile', 'web', '--port', port];
    console.error(`[backend] spawning: ${bc.cmd} ${argv.join(' ')}`);
    logStream.write(`\n[${new Date().toISOString()}] spawn: ${bc.cmd} ${argv.join(' ')}\n`);
    backendChild = spawn(bc.cmd, argv, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true, // own process group so we can kill the whole tree on quit
      env: process.env,
    });
    backendChild.stderr?.on('data', (d: Buffer) => {
      logStream.write(d);
      console.error('[backend]', String(d).trimEnd());
    });
    backendChild.on('close', () => {
      logStream.end();
    });
  } catch (e) {
    return { ok: false, spawned: false, reason: '无法启动后端：' + (e as Error).message };
  }

  const r = await waitForBackend(port, backendChild, 90000);
  if (!r.ok) {
    if (backendChild?.pid) {
      try {
        process.kill(-backendChild.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    backendChild = null;
    return r;
  }
  return { ok: true, spawned: true };
}

function loadLoading(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile('loading.html').catch(() => {});
  }
}

function showLoadingError(reason: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Surface the backend log tail so real failures are visible.
    const tail = backendLogTail();
    const detail = tail ? `${reason}\n\n--- 后端日志（末尾）---\n${tail}` : reason;
    mainWindow
      .loadFile('loading.html', { query: { error: encodeURIComponent(detail) } })
      .catch(() => {});
  }
}

function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = ensureBackend().then((r) => {
      bootPromise = null; // allow re-boot (e.g. window re-opened via Dock)
      if (r.ok) loadApp();
      else if (r.reason) showLoadingError(r.reason);
    });
  }
  return bootPromise;
}

function createWindow(): void {
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

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Show only the base app name in the title bar. The page sets
  // document.title to "<会话名> — DeepSeek Harness"; strip the prefix so the
  // title bar reads just "DeepSeek Harness" (adapts if the base name changes).
  mainWindow.on('page-title-updated', (event, title) => {
    event.preventDefault();
    const base = String(title).split(' — ').pop()?.trim();
    mainWindow?.setTitle(base || 'DeepSeek Harness');
  });

  // Open external links in the default browser; keep internal navigation in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Auto-reconnect if the backend is not running when the app starts.
  mainWindow.webContents.on('did-fail-load', (_event, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) scheduleRetry();
  });
  mainWindow.webContents.on('did-finish-load', () => clearRetry());

  mainWindow.on('closed', () => {
    clearRetry();
    mainWindow = null;
  });

  loadLoading();
}

function isInternal(url: string): boolean {
  return (
    url.startsWith(APP_URL) ||
    url.startsWith('http://localhost:3080') ||
    url.startsWith('http://127.0.0.1:3080')
  );
}

function loadApp(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(APP_URL).catch(() => {});
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setInterval(loadApp, 3000);
}

function clearRetry(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

// Keep the native window frame (title bar) in sync with the page's theme
// preference ('dark' | 'light' | 'system'). When the user picks "跟随系统",
// themeSource stays 'system' so the page keeps seeing the real OS scheme.
function applyTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme;
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(dark ? '#0f1115' : '#ffffff');
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
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
    ipcMain.on('theme-changed', (_event, theme: unknown) => {
      if (theme === 'dark' || theme === 'light' || theme === 'system') applyTheme(theme);
    });
    // Harness settings API lives here (main process): immune to any page CSP,
    // and a single, easily testable place to update if the harness changes
    // its settings API shape. Returns 'dark' | 'light' | 'system' | null.
    ipcMain.handle('theme-preference', async (): Promise<ThemeMode | null> => {
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
        const data = (await res.json()) as SettingsDocument;
        const namespaces = data?.result?.value?.namespaces ?? [];
        const ns = namespaces.find((n) => n.ns === 'ui-theme');
        const pref = ns ? (ns.value?.preference ?? ns.user?.preference) : undefined;
        return pref === 'dark' || pref === 'light' || pref === 'system' ? (pref as ThemeMode) : null;
      } catch {
        return null;
      }
    });
    buildMenu();
    createWindow();
    void boot();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        void boot();
      }
    });
  });

  // Full quit (Cmd+Q): stop the backend we spawned. Backends the user
  // started manually (spawned === false) are left untouched.
  app.on('will-quit', () => {
    if (backendChild?.pid) {
      try {
        process.kill(-backendChild.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      backendChild = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
