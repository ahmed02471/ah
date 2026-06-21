/**
 * electron/main.js — نظام مرور سبها
 * تطبيق Electron WebView للنشر على Windows
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow;
let serverProcess;
const PORT = 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// ── تشغيل خادم Node.js ─────────────────────────────────────────
function startServer() {
  const serverPath = path.join(__dirname, '..', 'src', 'server.js');
  serverProcess = spawn('node', [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', d => console.log('[Server]', d.toString().trim()));
  serverProcess.stderr.on('data', d => console.error('[Server Error]', d.toString().trim()));
  serverProcess.on('exit', code => console.log('[Server] exited:', code));
}

// ── انتظار حتى يستجيب الخادم ──────────────────────────────────
function waitForServer(retries = 20) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      http.get(SERVER_URL, res => {
        resolve();
      }).on('error', () => {
        if (n <= 0) reject(new Error('Server did not start'));
        else setTimeout(() => check(n - 1), 500);
      });
    };
    check(retries);
  });
}

// ── إنشاء النافذة الرئيسية ──────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  900,
    minHeight: 600,
    title: 'نظام مرور سبها',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    backgroundColor: '#0a1628',
    autoHideMenuBar: true,
  });

  // فتح الروابط الخارجية في المتصفح
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.loadURL(SERVER_URL + '/login');

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── تشغيل التطبيق ──────────────────────────────────────────────
app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
    createWindow();
  } catch(e) {
    console.error('Server failed to start:', e.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
