/* Yousj OTP 桌面版渲染层逻辑 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  data: null,          // {accounts(无密钥), diary, settings}
  codes: new Map(),    // id -> {code, remaining, period, type}
  cardEls: new Map(),  // id -> card element
  hotpShown: new Map(),// id -> 已生成的 HOTP 码
  editingAccountId: null,
  editingDiaryId: null,
  diaryMood: '',
  ticker: null,
  lastActivity: Date.now()
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  }, 1800);
}

function groupCode(code, digits) {
  if (!code || code.includes('-')) return code || '------';
  if (digits === 8) return code.slice(0, 4) + ' ' + code.slice(4);
  if (digits === 6) return code.slice(0, 3) + ' ' + code.slice(3);
  return code;
}

/* ---------------- 锁定 / 解锁 ---------------- */

let lockMode = 'unlock'; // 'setup' | 'unlock'

async function boot() {
  const status = await window.api.vaultStatus();
  if (!status.exists) {
    lockMode = 'setup';
    $('#lock-sub').textContent = '首次使用，先设置一个主密码（务必记住，无法找回）';
    $('#lock-password2').classList.remove('hidden');
    $('#lock-submit').textContent = '设置主密码并进入';
  } else if (!status.unlocked) {
    lockMode = 'unlock';
    $('#lock-sub').textContent = '输入主密码解锁你的验证码与日记';
    $('#lock-password2').classList.add('hidden');
    $('#lock-submit').textContent = '解锁';
  } else {
    await enterApp();
    return;
  }
  $('#lock-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#lock-password').focus();
}

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#lock-password').value;
  const errEl = $('#lock-error');
  errEl.textContent = '';
  try {
    if (lockMode === 'setup') {
      if (pw !== $('#lock-password2').value) throw new Error('两次输入的密码不一致');
      await window.api.vaultSetup(pw);
    } else {
      await window.api.vaultUnlock(pw);
    }
    $('#lock-password').value = '';
    $('#lock-password2').value = '';
    await enterApp();
  } catch (err) {
    errEl.textContent = lockMode === 'unlock' ? '密码不正确' : err.message;
  }
});

async function lock() {
  stopTicker();
  try { await window.api.vaultLock(); } catch (e) { /* 忽略 */ }
  state.data = null;
  state.codes.clear();
  lockMode = 'unlock';
  $('#lock-sub').textContent = '输入主密码解锁你的验证码与日记';
  $('#lock-password2').classList.add('hidden');
  $('#lock-submit').textContent = '解锁';
  $('#app').classList.add('hidden');
  $('#lock-screen').classList.remove('hidden');
  $('#lock-password').focus();
}

$('#btn-lock').addEventListener('click', lock);

/* ---------------- 进入主界面 ---------------- */

async function enterApp() {
  $('#lock-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  state.lastActivity = Date.now();
  await reloadData();
  startTicker();
}

async function reloadData() {
  state.data = await window.api.getData();
  $('#autolock-select').value = String(state.data.settings.autoLockMinutes ?? 5);
  buildCodeCards();
  await refreshCodes();
  renderDiaryList();
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(async () => {
    await refreshCodes();
    checkAutoLock();
  }, 1000);
}
function stopTicker() {
  if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
}

['mousemove', 'keydown', 'click'].forEach((evt) =>
  window.addEventListener(evt, () => { state.lastActivity = Date.now(); }, { passive: true }));

function checkAutoLock() {
  const mins = state.data && state.data.settings ? Number(state.data.settings.autoLockMinutes) : 0;
  if (mins > 0 && Date.now() - state.lastActivity > mins * 60 * 1000) {
    toast('已自动锁定');
    lock();
  }
}

/* ---------------- 页面切换 ---------------- */

$$('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + btn.dataset.page));
  });
});

/* ---------------- 验证码页 ---------------- */

const RING_C = 2 * Math.PI * 15.5;

function buildCodeCards() {
  const grid = $('#codes-grid');
  grid.innerHTML = '';
  state.cardEls.clear();
  const accounts = state.data.accounts;
  $('#codes-empty').classList.toggle('hidden', accounts.length > 0);
  for (const acct of accounts) {
    const card = document.createElement('div');
    card.className = 'code-card';
    card.dataset.id = acct.id;
    card.dataset.search = (acct.name + ' ' + (acct.issuer || '')).toLowerCase();
    const isHotp = acct.type === 'hotp';
    card.innerHTML = `
      <div class="card-tools">
        <button class="tool-btn" data-act="qr" title="出示二维码"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M13.5 13.5h3v3h-3zM17.5 17.5h3v3h-3z"/></svg></button>
        <button class="tool-btn" data-act="edit" title="编辑">✎</button>
        <button class="tool-btn danger" data-act="del" title="删除">✕</button>
      </div>
      <div class="issuer">${esc(acct.issuer || '—')}</div>
      <div class="acct-name">${esc(acct.name)}</div>
      ${isHotp ? `
        <div class="code-row"><span class="code" data-role="code">······</span></div>
        <button class="btn hotp-btn" data-act="hotp">生成验证码（计数器 ${acct.counter}）</button>`
      : `
        <div class="code-row">
          <span class="code" data-role="code">--- ---</span>
          <span class="ring-wrap">
            <svg width="40" height="40">
              <circle class="ring-bg" cx="20" cy="20" r="15.5" fill="none" stroke-width="3.5"></circle>
              <circle class="ring-fg" data-role="ring" cx="20" cy="20" r="15.5" fill="none" stroke-width="3.5"
                stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="0"></circle>
            </svg>
          </span>
        </div>`}
    `;
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'qr') { e.stopPropagation(); openQrModal(acct); return; }
      if (act === 'edit') { e.stopPropagation(); openAccountModal(acct); return; }
      if (act === 'del') { e.stopPropagation(); deleteAccount(acct); return; }
      if (act === 'hotp') { e.stopPropagation(); useHotp(acct, card); return; }
      copyCurrentCode(acct, card);
    });
    grid.appendChild(card);
    state.cardEls.set(acct.id, card);
  }
  applyCodesFilter();
}

async function refreshCodes() {
  if (!state.data) return;
  let list;
  try { list = await window.api.getCodes(); } catch (e) { return; }
  for (const item of list) {
    state.codes.set(item.id, item);
    const card = state.cardEls.get(item.id);
    if (!card) continue;
    const acct = state.data.accounts.find((a) => a.id === item.id);
    if (!acct || acct.type === 'hotp') continue;
    const codeEl = card.querySelector('[data-role="code"]');
    const ringEl = card.querySelector('[data-role="ring"]');
    codeEl.textContent = groupCode(item.code, acct.digits);
    const urgent = item.remaining !== null && item.remaining <= 5;
    codeEl.classList.toggle('urgent', urgent);
    if (ringEl && item.remaining !== null) {
      const frac = item.remaining / (item.period || 30);
      ringEl.style.strokeDashoffset = String(RING_C * (1 - frac));
      ringEl.classList.toggle('urgent', urgent);
    }
  }
}

async function copyCurrentCode(acct, card) {
  if (acct.type === 'hotp') {
    const shown = state.hotpShown.get(acct.id);
    if (shown) {
      await navigator.clipboard.writeText(shown);
      toast('已复制 ' + shown);
    } else {
      toast('先点「生成验证码」');
    }
    return;
  }
  const item = state.codes.get(acct.id);
  if (!item || item.error) { toast('验证码不可用'); return; }
  await navigator.clipboard.writeText(item.code);
  card.classList.add('copied-flash');
  setTimeout(() => card.classList.remove('copied-flash'), 500);
  toast('已复制 ' + item.code);
}

async function useHotp(acct, card) {
  try {
    const { code, counter } = await window.api.useHotp(acct.id);
    state.hotpShown.set(acct.id, code);
    acct.counter = counter;
    card.querySelector('[data-role="code"]').textContent = groupCode(code, acct.digits);
    card.querySelector('[data-act="hotp"]').textContent = `生成验证码（计数器 ${counter}）`;
    await navigator.clipboard.writeText(code);
    toast('已生成并复制 ' + code);
  } catch (e) { toast(e.message); }
}

async function deleteAccount(acct) {
  if (!confirm(`删除账号「${acct.name}」？此操作不可恢复。`)) return;
  await window.api.deleteAccount(acct.id);
  state.data.accounts = state.data.accounts.filter((a) => a.id !== acct.id);
  buildCodeCards();
  await refreshCodes();
  toast('已删除');
}

$('#codes-search').addEventListener('input', applyCodesFilter);
function applyCodesFilter() {
  const q = $('#codes-search').value.trim().toLowerCase();
  state.cardEls.forEach((card) => {
    card.style.display = !q || card.dataset.search.includes(q) ? '' : 'none';
  });
}

/* ---------------- 账号弹窗 ---------------- */

function setTypeVisibility() {
  const isHotp = $('#f-type').value === 'hotp';
  $('#f-period-wrap').classList.toggle('hidden', isHotp);
  $('#f-counter-wrap').classList.toggle('hidden', !isHotp);
}
$('#f-type').addEventListener('change', setTypeVisibility);

async function openAccountModal(acct) {
  state.editingAccountId = acct ? acct.id : null;
  $('#account-modal-title').textContent = acct ? '编辑账号' : '添加账号';
  $('#account-error').textContent = '';
  $('#f-otpauth').value = '';
  $('#f-name').value = acct ? acct.name : '';
  $('#f-issuer').value = acct ? acct.issuer : '';
  $('#f-type').value = acct ? acct.type : 'totp';
  $('#f-algorithm').value = acct ? acct.algorithm : 'SHA1';
  $('#f-digits').value = String(acct ? acct.digits : 6);
  $('#f-period').value = acct ? acct.period : 30;
  $('#f-counter').value = acct ? acct.counter : 0;
  $('#f-secret').value = '';
  if (acct) {
    try { $('#f-secret').value = await window.api.getSecret(acct.id); } catch (e) { /* 忽略 */ }
  }
  setTypeVisibility();
  $('#account-modal').classList.remove('hidden');
  $('#f-name').focus();
}

function closeAccountModal() { $('#account-modal').classList.add('hidden'); }
$('#btn-add-account').addEventListener('click', () => openAccountModal(null));
$('#btn-account-cancel').addEventListener('click', closeAccountModal);
$('#account-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAccountModal();
});

/* 把解析出的 otpauth 字段填进账号表单（链接粘贴 / 扫码共用） */
function fillAccountForm(parsed) {
  $('#account-error').textContent = '';
  $('#f-name').value = parsed.account || parsed.name || '';
  $('#f-issuer').value = parsed.issuer || '';
  $('#f-secret').value = parsed.secret;
  $('#f-type').value = parsed.type || 'totp';
  $('#f-algorithm').value = parsed.algorithm || 'SHA1';
  $('#f-digits').value = String(parsed.digits || 6);
  $('#f-period').value = parsed.period || 30;
  if (parsed.counter !== undefined) $('#f-counter').value = parsed.counter;
  setTypeVisibility();
}

let parseTimer = null;
$('#f-otpauth').addEventListener('input', (e) => {
  clearTimeout(parseTimer);
  const v = e.target.value.trim();
  if (!v.startsWith('otpauth://')) return;
  parseTimer = setTimeout(async () => {
    try {
      const parsed = await window.api.parseOtpauth(v);
      if (!parsed) { $('#account-error').textContent = '链接解析失败，请检查'; return; }
      fillAccountForm(parsed);
      toast('已从链接解析填表');
    } catch (err) { $('#account-error').textContent = err.message; }
  }, 250);
});

/* ---------------- 二维码：扫码添加 / 出示 ---------------- */

function applyScannedText(text) {
  const parsed = window.OtpCore ? OtpCore.parseOtpauth(String(text || '').trim()) : null;
  if (!parsed) { toast('二维码不是有效的 OTP 账号'); return false; }
  fillAccountForm(parsed);
  toast('扫码成功，已填入，检查后点保存');
  return true;
}

async function scanImageFile(file) {
  if (!file) return;
  const text = await QrTools.decodeFile(file);
  if (!text) { toast('没识别出二维码'); return; }
  applyScannedText(text);
}

$('#btn-qr-file').addEventListener('click', () => $('#qr-file-input').click());
$('#qr-file-input').addEventListener('change', (e) => {
  scanImageFile(e.target.files[0]);
  e.target.value = '';
});

/* 弹窗打开时，粘贴图片直接识别 */
document.addEventListener('paste', (e) => {
  if ($('#account-modal').classList.contains('hidden')) return;
  const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  scanImageFile(item.getAsFile());
});

/* 出示二维码：用本机密钥在渲染层本地生成，不出窗口 */
async function openQrModal(acct) {
  try {
    const secret = await window.api.getSecret(acct.id);
    const url = OtpCore.buildOtpauth(Object.assign({}, acct, { secret }));
    $('#qr-modal-title').textContent = (acct.issuer ? acct.issuer + ' · ' : '') + acct.name;
    $('#qr-modal-url').textContent = url;
    QrTools.drawToCanvas($('#qr-canvas'), url);
    $('#qr-modal').classList.remove('hidden');
  } catch (e) { toast(e.message); }
}
function closeQrModal() { $('#qr-modal').classList.add('hidden'); }
$('#btn-qr-close').addEventListener('click', closeQrModal);
$('#qr-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeQrModal();
});

$('#btn-account-save').addEventListener('click', async () => {
  const payload = {
    id: state.editingAccountId || undefined,
    name: $('#f-name').value.trim(),
    issuer: $('#f-issuer').value.trim(),
    secret: $('#f-secret').value.trim(),
    type: $('#f-type').value,
    algorithm: $('#f-algorithm').value,
    digits: parseInt($('#f-digits').value, 10),
    period: parseInt($('#f-period').value, 10) || 30,
    counter: parseInt($('#f-counter').value, 10) || 0
  };
  try {
    const saved = await window.api.saveAccount(payload);
    const idx = state.data.accounts.findIndex((a) => a.id === saved.id);
    if (idx >= 0) state.data.accounts[idx] = saved; else state.data.accounts.push(saved);
    closeAccountModal();
    buildCodeCards();
    await refreshCodes();
    toast('已保存');
  } catch (e) {
    $('#account-error').textContent = e.message;
  }
});

/* ---------------- 日记页 ---------------- */

function renderDiaryList() {
  const list = $('#diary-list');
  if (!state.data) { list.innerHTML = ''; return; }
  const q = $('#diary-search').value.trim().toLowerCase();
  const entries = state.data.diary.filter((d) =>
    !q || (d.title + ' ' + d.body + ' ' + d.date).toLowerCase().includes(q));
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state"><p class="empty-title">暂无日记</p><p class="empty-desc">点右上角「写日记」开始</p></div>';
    return;
  }
  list.innerHTML = entries.map((d) => `
    <button class="diary-item ${d.id === state.editingDiaryId ? 'active' : ''}" data-id="${d.id}">
      <span class="d-date">${esc(d.date)}</span>${d.mood ? `<span class="mood-chip">${esc(d.mood)}</span>` : ''}
      <div class="d-title">${esc(d.title || '（无标题）')}</div>
      <div class="d-body">${esc(d.body)}</div>
    </button>`).join('');
  list.querySelectorAll('.diary-item').forEach((el) => {
    el.addEventListener('click', () => selectDiary(el.dataset.id));
  });
}

function setMood(mood) {
  state.diaryMood = mood || '';
  $$('#mood-picker button').forEach((b) =>
    b.classList.toggle('selected', b.dataset.mood === state.diaryMood));
}
$$('#mood-picker button').forEach((b) =>
  b.addEventListener('click', () => setMood(b.dataset.mood)));

function selectDiary(id) {
  const entry = state.data.diary.find((d) => d.id === id);
  if (!entry) return;
  state.editingDiaryId = id;
  $('#diary-date').value = entry.date;
  $('#diary-title').value = entry.title;
  $('#diary-body').value = entry.body;
  setMood(entry.mood);
  $('#btn-delete-diary').classList.remove('hidden');
  $('#diary-save-hint').textContent = '';
  renderDiaryList();
}

function newDiary() {
  state.editingDiaryId = null;
  $('#diary-date').value = new Date().toISOString().slice(0, 10);
  $('#diary-title').value = '';
  $('#diary-body').value = '';
  setMood('');
  $('#btn-delete-diary').classList.add('hidden');
  $('#diary-save-hint').textContent = '';
  renderDiaryList();
  $('#diary-body').focus();
}

$('#btn-new-diary').addEventListener('click', newDiary);
$('#diary-search').addEventListener('input', renderDiaryList);

$('#btn-save-diary').addEventListener('click', async () => {
  const payload = {
    id: state.editingDiaryId || undefined,
    date: $('#diary-date').value || new Date().toISOString().slice(0, 10),
    title: $('#diary-title').value,
    body: $('#diary-body').value,
    mood: state.diaryMood
  };
  if (!payload.title.trim() && !payload.body.trim()) {
    $('#diary-save-hint').textContent = '标题和正文不能都为空';
    return;
  }
  try {
    const saved = await window.api.saveDiary(payload);
    const idx = state.data.diary.findIndex((d) => d.id === saved.id);
    if (idx >= 0) state.data.diary[idx] = saved; else state.data.diary.unshift(saved);
    state.data.diary.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.editingDiaryId = saved.id;
    $('#btn-delete-diary').classList.remove('hidden');
    $('#diary-save-hint').textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    renderDiaryList();
  } catch (e) { $('#diary-save-hint').textContent = e.message; }
});

$('#btn-delete-diary').addEventListener('click', async () => {
  if (!state.editingDiaryId) return;
  if (!confirm('删除这篇日记？此操作不可恢复。')) return;
  await window.api.deleteDiary(state.editingDiaryId);
  state.data.diary = state.data.diary.filter((d) => d.id !== state.editingDiaryId);
  newDiary();
  toast('已删除');
});

/* ---------------- 备份页 ---------------- */

$('#btn-export').addEventListener('click', async () => {
  const msg = $('#export-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  try {
    const res = await window.api.exportBackup($('#export-password').value);
    if (res.canceled) { msg.textContent = '已取消'; return; }
    $('#export-password').value = '';
    msg.classList.add('ok');
    msg.textContent = '已导出到 ' + res.filePath;
  } catch (e) { msg.textContent = e.message; }
});

$('#btn-import').addEventListener('click', async () => {
  const msg = $('#import-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  if (!confirm('导入将整体替换当前账号与日记，确定继续？')) return;
  try {
    const res = await window.api.importBackup($('#import-password').value);
    if (res.canceled) { msg.textContent = '已取消'; return; }
    $('#import-password').value = '';
    msg.classList.add('ok');
    msg.textContent = `导入成功：${res.accounts} 个账号、${res.diary} 篇日记`;
    state.editingDiaryId = null;
    await reloadData();
    newDiary();
  } catch (e) { msg.textContent = e.message; }
});

/* ---------------- 设置页 ---------------- */

$('#btn-change-pw').addEventListener('click', async () => {
  const msg = $('#pw-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  const oldPw = $('#pw-old').value, newPw = $('#pw-new').value, newPw2 = $('#pw-new2').value;
  if (newPw !== newPw2) { msg.textContent = '两次输入的新密码不一致'; return; }
  try {
    await window.api.changePassword(oldPw, newPw);
    $('#pw-old').value = $('#pw-new').value = $('#pw-new2').value = '';
    msg.classList.add('ok');
    msg.textContent = '主密码已修改';
  } catch (e) { msg.textContent = e.message; }
});

$('#autolock-select').addEventListener('change', async (e) => {
  const mins = parseInt(e.target.value, 10);
  state.data.settings = await window.api.updateSettings({ autoLockMinutes: mins });
  state.lastActivity = Date.now();
  toast(mins > 0 ? `自动锁定：${mins} 分钟` : '自动锁定已关闭');
});

/* ---------------- 启动 ---------------- */

newDiary();
boot().catch((e) => {
  $('#lock-error').textContent = e.message;
});
