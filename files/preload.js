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

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const USER_DATA = ipcRenderer.sendSync('wb:get-user-data');
const APP_DIR = ipcRenderer.sendSync('wb:get-app-dir');
const DATA_FILE = path.join(USER_DATA, 'worldbuilder.json');
const IMG_DIR = path.join(USER_DATA, 'images');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

contextBridge.exposeInMainWorld('wbStore', {
  isElectron: true,

  loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) return fs.readFileSync(DATA_FILE, 'utf8');
    } catch (e) {}
    return null;
  },

  saveData(str) {
    try {
      atomicWrite(DATA_FILE, str);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  saveImage(dataUrl) {
    try {
      const m = /^data:image\/(\w+);base64,([\s\S]*)$/.exec(dataUrl);
      if (!m) return { ok: false, error: '不是有效的图片数据' };
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + ext;
      ensureDir(IMG_DIR);
      fs.writeFileSync(path.join(IMG_DIR, name), Buffer.from(m[2], 'base64'));
      return { ok: true, path: 'img/' + name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  readImage(rel) {
    try {
      const name = rel.replace(/^img\//, '');
      const file = path.join(IMG_DIR, name);
      if (!fs.existsSync(file)) return null;
      const ext = path.extname(name).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      return 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    } catch (e) {
      return null;
    }
  },

  deleteImage(rel) {
    try {
      const file = path.join(IMG_DIR, rel.replace(/^img\//, ''));
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  resolveImage(rel) {
    try {
      return pathToFileURL(path.join(IMG_DIR, rel.replace(/^img\//, ''))).href;
    } catch (e) {
      return '';
    }
  },

  getDataPath() { return DATA_FILE; },
  getImagesPath() { return IMG_DIR; },

  checkUpdate(url) { return ipcRenderer.invoke('wb:check-update', url); },
  applyUpdate(url) { return ipcRenderer.invoke('wb:apply-update', url); },
  restartWithUpdate() { return ipcRenderer.invoke('wb:restart-with-update'); },

  openAppDir() { return ipcRenderer.invoke('wb:open-app-dir'); },
  openDataDir() { return ipcRenderer.invoke('wb:open-data-dir'); }
});