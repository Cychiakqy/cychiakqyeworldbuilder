/*
 * Worldbuilder - 世界观编写器
 * Copyright (C) 2026 Cychiakqye
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const APP_DIR = process.env.WB_APP_DIR || __dirname;
const USER_DATA = process.env.WB_USER_DATA || app.getPath('userData');
const WWW_DIR = path.join(APP_DIR, 'www');
const UPDATE_DIR = path.join(USER_DATA, '_update');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Worldbuilder',
    backgroundColor: '#fbfbf9',
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const idx = path.join(WWW_DIR, 'index.html');
  if (fs.existsSync(idx)) {
    mainWindow.loadFile(idx);
  } else {
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font-family:sans-serif;padding:40px">' +
      '<h2>界面文件缺失</h2><p>' + idx + '</p>' +
      '</body>'
    ));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'r') {
      mainWindow.reload();
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

ipcMain.on('wb:get-user-data', (event) => {
  event.returnValue = USER_DATA;
});

ipcMain.on('wb:get-app-dir', (event) => {
  event.returnValue = APP_DIR;
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    (function follow(u, depth) {
      if (depth > 5) return reject(new Error('重定向次数过多'));
      const lib = u.indexOf('https') === 0 ? https : http;
      lib.get(u, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error('HTTP ' + res.statusCode + ': ' + u));
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => {
          try { fs.unlinkSync(dest); } catch (_) {}
          reject(err);
        });
      }).on('error', reject);
    })(url, 0);
  });
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    (function follow(u, depth) {
      if (depth > 5) return reject(new Error('重定向次数过多'));
      const lib = u.indexOf('https') === 0 ? https : http;
      lib.get(u, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    })(url, 0);
  });
}

function getCurrentVersion() {
  try {
    return fs.readFileSync(path.join(APP_DIR, 'version.txt'), 'utf8').trim();
  } catch (e) {
    return app.getVersion();
  }
}

ipcMain.handle('wb:check-update', async (_, manifestUrl) => {
  try {
    const m = JSON.parse(await downloadText(manifestUrl));
    const cur = getCurrentVersion();
    return {
      ok: true,
      current: cur,
      latest: m.version,
      hasUpdate: m.version !== cur && Array.isArray(m.files) && m.files.length > 0,
      manifest: m
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('wb:apply-update', async (_, manifestUrl) => {
  try {
    const m = JSON.parse(await downloadText(manifestUrl));
    if (!Array.isArray(m.files) || !m.files.length) {
      return { ok: false, error: '清单中没有文件' };
    }

    if (fs.existsSync(UPDATE_DIR)) {
      fs.rmSync(UPDATE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(UPDATE_DIR, { recursive: true });

    for (const f of m.files) {
      if (!f.path || !f.url) continue;
      const safe = f.path.replace(/\.\./g, '').replace(/^\/+/, '');
      await downloadFile(f.url, path.join(UPDATE_DIR, safe));
    }
    fs.writeFileSync(path.join(UPDATE_DIR, 'version.txt'), m.version);
    return { ok: true, manifest: m };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('wb:restart-with-update', async () => {
  try {
    if (!fs.existsSync(path.join(UPDATE_DIR, 'main.js'))) {
      return { ok: false, error: '没有待应用的更新' };
    }

    const batPath = path.join(os.tmpdir(), 'wb-update-' + Date.now() + '.bat');
    const lines = [
      '@echo off',
      'chcp 65001 >nul',
      'timeout /t 2 /nobreak >nul',
      'if exist "' + APP_DIR + '.bak" rmdir /s /q "' + APP_DIR + '.bak"',
      'if exist "' + APP_DIR + '" move "' + APP_DIR + '" "' + APP_DIR + '.bak"',
      'move "' + UPDATE_DIR + '" "' + APP_DIR + '"',
      'start "" "' + process.execPath + '"',
      '(goto) 2>nul & del "%~f0"'
    ];
    fs.writeFileSync(batPath, lines.join('\r\n'), 'utf8');

    const vbsPath = path.join(os.tmpdir(), 'wb-launch-' + Date.now() + '.vbs');
    fs.writeFileSync(vbsPath,
      'CreateObject("WScript.Shell").Run "cmd /c """' + batPath + '""", 0, False',
      'utf8');

    spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('wb:open-app-dir', async () => shell.openPath(APP_DIR));
ipcMain.handle('wb:open-data-dir', async () => shell.openPath(USER_DATA));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});