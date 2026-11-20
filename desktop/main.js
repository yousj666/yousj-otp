/*
 * Yousj OTP 桌面版主进程
 * 加密库只在主进程持有（密钥与明文数据不出主进程）；
 * 渲染层经 preload 的固定 IPC 接口取验证码、读写数据，拿不到密钥本身。
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { VaultStore, encryptEnvelope, decryptEnvelope } = require('./vault.js');

let OtpCore;
try { OtpCore = require('./core.js'); }
catch (e) { OtpCore = require('../core/otp-core.js'); }

const DEFAULT_DATA = () => ({
  accounts: [],
  diary: [],
  settings: { autoLockMinutes: 5 }
});

let win = null;
let store = null;

function vaultPath() {
  return path.join(app.getPath('userData'), 'vault.json');
}

function requireUnlocked() {
  if (!store || !store.isUnlocked()) throw new Error('库未解锁');
  return store.data;
}

function publicAccount(a) {
  // 不把密钥发给渲染层（编辑时单独经 accounts:getSecret 取）
  return {
    id: a.id, name: a.name, issuer: a.issuer || '', type: a.type || 'totp',
    algorithm: a.algorithm || 'SHA1', digits: a.digits || 6,
    period: a.period || 30, counter: a.counter || 0
  };
}

function computeCodes() {
  const data = requireUnlocked();
  const now = Math.floor(Date.now() / 1000);
  return data.accounts.map((a) => {
    const base = { id: a.id, period: a.period || 30, type: a.type || 'totp' };
    try {
      if (base.type === 'hotp') {
        base.code = OtpCore.codeFromSecret(a.secret, {
          type: 'hotp', counter: a.counter || 0,
          algorithm: a.algorithm, digits: a.digits
        });
        base.remaining = null;
      } else {
        base.code = OtpCore.codeFromSecret(a.secret, {
          type: 'totp', algorithm: a.algorithm, digits: a.digits,
          period: base.period, timestamp: now
        });
        base.remaining = OtpCore.remainingSeconds(base.period, now);
      }
    } catch (e) {
      base.code = '------';
      base.error = true;
    }
    return base;
  });
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });
}

function registerIpc() {
  handle('vault:status', () => ({
    exists: store.exists(),
    unlocked: store.isUnlocked()
  }));

  handle('vault:setup', (password) => {
    if (!password || String(password).length < 4) throw new Error('主密码至少 4 位');
    if (store.exists()) throw new Error('库已存在');
    store.setup(String(password), DEFAULT_DATA());
    return { exists: true, unlocked: true };
  });

  handle('vault:unlock', (password) => {
    store.unlock(String(password));
    return { exists: true, unlocked: true };
  });

  handle('vault:lock', () => { store.lock(); return {}; });

  handle('data:get', () => {
    const data = requireUnlocked();
    return {
      accounts: data.accounts.map(publicAccount),
      diary: data.diary.slice().sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)),
      settings: data.settings || { autoLockMinutes: 5 }
    };
  });

  handle('codes:get', () => computeCodes());

  handle('accounts:getSecret', (id) => {
    const data = requireUnlocked();
    const acct = data.accounts.find((a) => a.id === id);
    if (!acct) throw new Error('账号不存在');
    return acct.secret;
  });

  handle('accounts:save', (input) => {
    const data = requireUnlocked();
    if (!input || !input.name || !input.secret) throw new Error('名称和密钥必填');
    // 校验密钥可解码
    OtpCore.base32Decode(String(input.secret));
    const acct = {
      id: input.id || crypto.randomUUID(),
      name: String(input.name).trim(),
      issuer: String(input.issuer || '').trim(),
      secret: String(input.secret).toUpperCase().replace(/[\s-]+/g, ''),
      type: input.type === 'hotp' ? 'hotp' : 'totp',
      algorithm: OtpCore.normalizeAlgo(input.algorithm || 'SHA1'),
      digits: [6, 8].includes(input.digits) ? input.digits : 6,
      period: Math.min(3600, Math.max(5, parseInt(input.period, 10) || 30)),
      counter: parseInt(input.counter, 10) || 0
    };
    const idx = data.accounts.findIndex((a) => a.id === acct.id);
    if (idx >= 0) data.accounts[idx] = acct; else data.accounts.push(acct);
    store.save();
    return publicAccount(acct);
  });

  handle('accounts:delete', (id) => {
    const data = requireUnlocked();
    data.accounts = data.accounts.filter((a) => a.id !== id);
    store.save();
    return {};
  });

  handle('accounts:useHotp', (id) => {
    const data = requireUnlocked();
    const acct = data.accounts.find((a) => a.id === id);
    if (!acct || acct.type !== 'hotp') throw new Error('不是 HOTP 账号');
    const code = OtpCore.codeFromSecret(acct.secret, {
      type: 'hotp', counter: acct.counter || 0,
      algorithm: acct.algorithm, digits: acct.digits
    });
    acct.counter = (acct.counter || 0) + 1;
    store.save();
    return { code, counter: acct.counter };
  });

  handle('accounts:parseOtpauth', (uri) => OtpCore.parseOtpauth(String(uri || '')));

  handle('diary:save', (input) => {
    const data = requireUnlocked();
    if (!input || !input.body && !input.title) throw new Error('日记内容不能为空');
    const now = Date.now();
    const entry = {
      id: input.id || crypto.randomUUID(),
      date: input.date || new Date().toISOString().slice(0, 10),
      title: String(input.title || '').trim(),
      body: String(input.body || ''),
      mood: String(input.mood || ''),
      createdAt: input.createdAt || now,
      updatedAt: now
    };
    const idx = data.diary.findIndex((d) => d.id === entry.id);
    if (idx >= 0) data.diary[idx] = entry; else data.diary.push(entry);
    store.save();
    return entry;
  });

  handle('diary:delete', (id) => {
    const data = requireUnlocked();
    data.diary = data.diary.filter((d) => d.id !== id);
    store.save();
    return {};
  });

  handle('settings:update', (partial) => {
    const data = requireUnlocked();
    data.settings = Object.assign({}, data.settings, partial || {});
    store.save();
    return data.settings;
  });

  handle('password:change', (oldPassword, newPassword) => {
    requireUnlocked();
    if (!newPassword || String(newPassword).length < 4) throw new Error('新密码至少 4 位');
    store.changePassword(String(oldPassword), String(newPassword));
    return {};
  });

  handle('backup:export', async (password) => {
    const data = requireUnlocked();
    if (!store.verifyPassword(String(password || ''))) throw new Error('主密码不正确');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出加密备份',
      defaultPath: `yousj-otp-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Yousj OTP 备份', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    const envelope = encryptEnvelope(JSON.parse(JSON.stringify(data)), String(password));
    fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf8');
    return { canceled: false, filePath };
  });

  handle('backup:import', async (backupPassword) => {
    requireUnlocked();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入加密备份',
      properties: ['openFile'],
      filters: [{ name: 'Yousj OTP 备份', extensions: ['json'] }]
    });
    if (canceled || !filePaths.length) return { canceled: true };
    const envelope = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    const imported = decryptEnvelope(envelope, String(backupPassword || ''));
    if (!imported || !Array.isArray(imported.accounts) || !Array.isArray(imported.diary)) {
      throw new Error('备份内容结构不正确');
    }
    store.data = {
      accounts: imported.accounts,
      diary: imported.diary,
      settings: imported.settings || { autoLockMinutes: 5 }
    };
    store.save();
    return { canceled: false, accounts: imported.accounts.length, diary: imported.diary.length };
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    title: 'Yousj OTP',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    // 只放行摄像头（扫码添加用），其余权限一律拒绝
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media');
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media');
    store = new VaultStore(vaultPath());
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (store) store.lock();
    if (process.platform !== 'darwin') app.quit();
  });
}
