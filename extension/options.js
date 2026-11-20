/* Yousj OTP 插件管理页：账号增删改、日记管理、备份导入导出、设置 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  password: null,
  data: null,
  editingAccountId: null,
  editingDiaryId: null
};

const DEFAULT_DATA = () => ({ accounts: [], diary: [], settings: { autoLockMinutes: 5 } });

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'id' + Date.now() + Math.floor(Math.random() * 1e9);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 250);
  }, 1900);
}

async function persist() {
  const envelope = await ExtVault.encryptEnvelope(state.data, state.password);
  await ExtVault.saveStoredEnvelope(envelope);
  await ExtVault.saveSession(state.password, state.data);
}

/* ---------- 锁定 / 解锁 ---------- */

let lockMode = 'unlock';

function showLock(mode) {
  lockMode = mode;
  $('#view-main').classList.add('hidden');
  $('#view-lock').classList.remove('hidden');
  if (mode === 'setup') {
    $('#lock-sub').textContent = '首次使用，先设置一个主密码（务必记住，无法找回）';
    $('#lock-password2').classList.remove('hidden');
    $('#lock-submit').textContent = '设置主密码并进入';
  } else {
    $('#lock-sub').textContent = '输入主密码解锁';
    $('#lock-password2').classList.add('hidden');
    $('#lock-submit').textContent = '解锁';
  }
}

function showMain() {
  $('#view-lock').classList.add('hidden');
  $('#view-main').classList.remove('hidden');
  $('#autolock-select').value = String(state.data.settings.autoLockMinutes ?? 5);
  renderAccounts();
  renderDiary();
  resetAccountForm();
  resetDiaryForm();
}

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#lock-password').value;
  const errEl = $('#lock-error');
  errEl.textContent = '';
  try {
    if (lockMode === 'setup') {
      if (pw.length < 4) throw new Error('主密码至少 4 位');
      if (pw !== $('#lock-password2').value) throw new Error('两次输入的密码不一致');
      state.password = pw;
      state.data = DEFAULT_DATA();
      await persist();
    } else {
      const envelope = await ExtVault.loadStoredEnvelope();
      if (!envelope) { showLock('setup'); return; }
      state.data = await ExtVault.decryptEnvelope(envelope, pw);
      state.password = pw;
      await ExtVault.saveSession(pw, state.data);
    }
    $('#lock-password').value = '';
    $('#lock-password2').value = '';
    showMain();
  } catch (err) {
    errEl.textContent = lockMode === 'unlock' ? '密码不正确' : err.message;
  }
});

$('#btn-lock').addEventListener('click', async () => {
  await ExtVault.clearSession();
  state.password = null;
  state.data = null;
  showLock('unlock');
});

/* ---------- 账号 ---------- */

function renderAccounts() {
  const box = $('#accounts-list');
  if (!state.data.accounts.length) {
    box.innerHTML = '<p class="empty-note">暂无账号，用下方表单添加。</p>';
    return;
  }
  box.innerHTML = state.data.accounts.map((a) => `
    <div class="list-row">
      <div class="grow">
        <div class="t1">${esc(a.issuer ? a.issuer + ' · ' : '')}${esc(a.name)}</div>
        <div class="t2">${a.type === 'hotp' ? 'HOTP 计数器 ' + (a.counter || 0) : 'TOTP ' + (a.period || 30) + 's'} · ${esc(a.algorithm || 'SHA1')} · ${a.digits || 6} 位</div>
      </div>
      <button class="mini-btn" data-edit="${a.id}">编辑</button>
      <button class="mini-btn danger" data-del="${a.id}">删除</button>
    </div>`).join('');
  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => fillAccountForm(b.dataset.edit)));
  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteAccount(b.dataset.del)));
}

function setTypeVisibility() {
  const isHotp = $('#f-type').value === 'hotp';
  $('#f-period-wrap').classList.toggle('hidden', isHotp);
  $('#f-counter-wrap').classList.toggle('hidden', !isHotp);
}
$('#f-type').addEventListener('change', setTypeVisibility);

function fillAccountForm(id) {
  const a = state.data.accounts.find((x) => x.id === id);
  if (!a) return;
  state.editingAccountId = id;
  $('#account-form-title').textContent = '编辑账号';
  $('#f-name').value = a.name;
  $('#f-issuer').value = a.issuer || '';
  $('#f-secret').value = a.secret;
  $('#f-type').value = a.type || 'totp';
  $('#f-algorithm').value = a.algorithm || 'SHA1';
  $('#f-digits').value = String(a.digits || 6);
  $('#f-period').value = a.period || 30;
  $('#f-counter').value = a.counter || 0;
  $('#btn-account-reset').classList.remove('hidden');
  setTypeVisibility();
}

function resetAccountForm() {
  state.editingAccountId = null;
  $('#account-form-title').textContent = '添加账号';
  ['#f-otpauth', '#f-name', '#f-issuer', '#f-secret'].forEach((s) => { $(s).value = ''; });
  $('#f-type').value = 'totp';
  $('#f-algorithm').value = 'SHA1';
  $('#f-digits').value = '6';
  $('#f-period').value = 30;
  $('#f-counter').value = 0;
  $('#account-error').textContent = '';
  $('#btn-account-reset').classList.add('hidden');
  setTypeVisibility();
}
$('#btn-account-reset').addEventListener('click', resetAccountForm);

let parseTimer = null;
$('#f-otpauth').addEventListener('input', (e) => {
  clearTimeout(parseTimer);
  const v = e.target.value.trim();
  if (!v.startsWith('otpauth://')) return;
  parseTimer = setTimeout(() => {
    const parsed = OtpCore.parseOtpauth(v);
    if (!parsed) { $('#account-error').textContent = '链接解析失败，请检查'; return; }
    $('#account-error').textContent = '';
    $('#f-name').value = parsed.account || '';
    $('#f-issuer').value = parsed.issuer || '';
    $('#f-secret').value = parsed.secret;
    $('#f-type').value = parsed.type;
    $('#f-algorithm').value = parsed.algorithm;
    $('#f-digits').value = String(parsed.digits);
    $('#f-period').value = parsed.period;
    if (parsed.counter !== undefined) $('#f-counter').value = parsed.counter;
    setTypeVisibility();
    toast('已从链接解析填表');
  }, 250);
});

$('#btn-account-save').addEventListener('click', async () => {
  const name = $('#f-name').value.trim();
  const secret = $('#f-secret').value.trim();
  if (!name || !secret) { $('#account-error').textContent = '名称和密钥必填'; return; }
  try { OtpCore.base32Decode(secret); }
  catch (e) { $('#account-error').textContent = '密钥不是有效的 Base32'; return; }
  const acct = {
    id: state.editingAccountId || newId(),
    name,
    issuer: $('#f-issuer').value.trim(),
    secret: secret.toUpperCase().replace(/[\s-]+/g, ''),
    type: $('#f-type').value,
    algorithm: $('#f-algorithm').value,
    digits: parseInt($('#f-digits').value, 10),
    period: Math.min(3600, Math.max(5, parseInt($('#f-period').value, 10) || 30)),
    counter: parseInt($('#f-counter').value, 10) || 0
  };
  const idx = state.data.accounts.findIndex((a) => a.id === acct.id);
  if (idx >= 0) state.data.accounts[idx] = acct; else state.data.accounts.push(acct);
  await persist();
  resetAccountForm();
  renderAccounts();
  toast('账号已保存');
});

async function deleteAccount(id) {
  const a = state.data.accounts.find((x) => x.id === id);
  if (!a || !confirm(`删除账号「${a.name}」？此操作不可恢复。`)) return;
  state.data.accounts = state.data.accounts.filter((x) => x.id !== id);
  await persist();
  if (state.editingAccountId === id) resetAccountForm();
  renderAccounts();
  toast('已删除');
}

/* ---------- 日记 ---------- */

function renderDiary() {
  const box = $('#diary-list');
  if (!state.data.diary.length) {
    box.innerHTML = '<p class="empty-note">暂无日记。</p>';
    return;
  }
  box.innerHTML = state.data.diary.map((d) => `
    <div class="list-row">
      <div class="grow">
        <div class="t1">${esc(d.title || '（无标题）')}${d.mood ? `<span class="mood-chip">${esc(d.mood)}</span>` : ''}</div>
        <div class="t2">${esc(d.date)} · ${esc((d.body || '').slice(0, 60))}</div>
      </div>
      <button class="mini-btn" data-edit="${d.id}">编辑</button>
      <button class="mini-btn danger" data-del="${d.id}">删除</button>
    </div>`).join('');
  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => fillDiaryForm(b.dataset.edit)));
  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteDiary(b.dataset.del)));
}

function fillDiaryForm(id) {
  const d = state.data.diary.find((x) => x.id === id);
  if (!d) return;
  state.editingDiaryId = id;
  $('#diary-form-title').textContent = '编辑日记';
  $('#d-date').value = d.date;
  $('#d-title').value = d.title || '';
  $('#d-body').value = d.body || '';
  $('#d-mood').value = d.mood || '';
  $('#btn-diary-reset').classList.remove('hidden');
}

function resetDiaryForm() {
  state.editingDiaryId = null;
  $('#diary-form-title').textContent = '写日记';
  $('#d-date').value = new Date().toISOString().slice(0, 10);
  $('#d-title').value = '';
  $('#d-body').value = '';
  $('#d-mood').value = '';
  $('#diary-error').textContent = '';
  $('#btn-diary-reset').classList.add('hidden');
}
$('#btn-diary-reset').addEventListener('click', resetDiaryForm);

$('#btn-diary-save').addEventListener('click', async () => {
  const title = $('#d-title').value.trim();
  const body = $('#d-body').value;
  if (!title && !body.trim()) { $('#diary-error').textContent = '标题和正文不能都为空'; return; }
  const now = Date.now();
  const existing = state.editingDiaryId
    ? state.data.diary.find((d) => d.id === state.editingDiaryId) : null;
  const entry = {
    id: state.editingDiaryId || newId(),
    date: $('#d-date').value || new Date().toISOString().slice(0, 10),
    title, body, mood: $('#d-mood').value,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  const idx = state.data.diary.findIndex((d) => d.id === entry.id);
  if (idx >= 0) state.data.diary[idx] = entry; else state.data.diary.unshift(entry);
  state.data.diary.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  await persist();
  resetDiaryForm();
  renderDiary();
  toast('日记已保存');
});

async function deleteDiary(id) {
  if (!confirm('删除这篇日记？此操作不可恢复。')) return;
  state.data.diary = state.data.diary.filter((d) => d.id !== id);
  await persist();
  if (state.editingDiaryId === id) resetDiaryForm();
  renderDiary();
  toast('已删除');
}

/* ---------- 备份 ---------- */

$('#btn-export').addEventListener('click', async () => {
  const msg = $('#backup-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  const pw = $('#export-password').value;
  try {
    const stored = await ExtVault.loadStoredEnvelope();
    await ExtVault.decryptEnvelope(stored, pw); // 校验密码
    const envelope = await ExtVault.encryptEnvelope(state.data, pw);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yousj-otp-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('#export-password').value = '';
    msg.classList.add('ok');
    msg.textContent = '备份已下载';
  } catch (e) { msg.textContent = '主密码不正确'; }
});

$('#import-file').addEventListener('change', async (e) => {
  const msg = $('#backup-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('导入将整体替换当前账号与日记，确定继续？')) return;
  try {
    const envelope = JSON.parse(await file.text());
    const imported = await ExtVault.decryptEnvelope(envelope, $('#import-password').value);
    if (!imported || !Array.isArray(imported.accounts) || !Array.isArray(imported.diary)) {
      throw new Error('备份内容结构不正确');
    }
    state.data = {
      accounts: imported.accounts,
      diary: imported.diary,
      settings: imported.settings || { autoLockMinutes: 5 }
    };
    await persist();
    $('#import-password').value = '';
    $('#autolock-select').value = String(state.data.settings.autoLockMinutes ?? 5);
    resetAccountForm();
    resetDiaryForm();
    renderAccounts();
    renderDiary();
    msg.classList.add('ok');
    msg.textContent = `导入成功：${imported.accounts.length} 个账号、${imported.diary.length} 篇日记`;
  } catch (err) { msg.textContent = '导入失败：密码不正确或文件损坏'; }
});

/* ---------- 设置 ---------- */

$('#btn-change-pw').addEventListener('click', async () => {
  const msg = $('#settings-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  const oldPw = $('#pw-old').value, newPw = $('#pw-new').value, newPw2 = $('#pw-new2').value;
  if (oldPw !== state.password) { msg.textContent = '当前密码不正确'; return; }
  if (newPw.length < 4) { msg.textContent = '新密码至少 4 位'; return; }
  if (newPw !== newPw2) { msg.textContent = '两次输入的新密码不一致'; return; }
  state.password = newPw;
  await persist();
  $('#pw-old').value = $('#pw-new').value = $('#pw-new2').value = '';
  msg.classList.add('ok');
  msg.textContent = '主密码已修改';
});

$('#btn-autolock-save').addEventListener('click', async () => {
  state.data.settings.autoLockMinutes = parseInt($('#autolock-select').value, 10);
  await persist();
  toast('自动锁定设置已保存');
});

/* ---------- 启动 ---------- */

(async function boot() {
  const envelope = await ExtVault.loadStoredEnvelope();
  if (!envelope) { showLock('setup'); return; }
  const session = await ExtVault.loadSession();
  if (session && session.password && session.data) {
    const mins = Number(session.data.settings && session.data.settings.autoLockMinutes);
    const expired = mins > 0 && Date.now() - (session.unlockedAt || 0) > mins * 60 * 1000;
    if (!expired) {
      state.password = session.password;
      state.data = session.data;
      showMain();
      return;
    }
    await ExtVault.clearSession();
  }
  showLock('unlock');
})().catch((e) => {
  $('#lock-error').textContent = e.message;
  showLock('unlock');
});
