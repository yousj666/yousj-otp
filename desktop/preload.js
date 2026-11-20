/* 预加载：只暴露固定的一组 IPC 方法给渲染层 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function call(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).then((res) => {
    if (!res || !res.ok) throw new Error((res && res.error) || '操作失败');
    return res.result;
  });
}

contextBridge.exposeInMainWorld('api', {
  vaultStatus: () => call('vault:status'),
  vaultSetup: (password) => call('vault:setup', password),
  vaultUnlock: (password) => call('vault:unlock', password),
  vaultLock: () => call('vault:lock'),
  getData: () => call('data:get'),
  getCodes: () => call('codes:get'),
  getSecret: (id) => call('accounts:getSecret', id),
  saveAccount: (acct) => call('accounts:save', acct),
  deleteAccount: (id) => call('accounts:delete', id),
  useHotp: (id) => call('accounts:useHotp', id),
  parseOtpauth: (uri) => call('accounts:parseOtpauth', uri),
  saveDiary: (entry) => call('diary:save', entry),
  deleteDiary: (id) => call('diary:delete', id),
  updateSettings: (partial) => call('settings:update', partial),
  changePassword: (oldPw, newPw) => call('password:change', oldPw, newPw),
  exportBackup: (password) => call('backup:export', password),
  importBackup: (backupPassword) => call('backup:import', backupPassword)
});
