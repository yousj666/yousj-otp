/* Yousj OTP 插件 popup：验证码（复制 + 自动填入） / 日记（速记 + 最近） */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  password: null,
  data: null,
  ticker: null
};

const DEFAULT_DATA = () => ({ accounts: [], diary: [], settings: { autoLockMinutes: 5 } });

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
  }, 1900);
}

function groupCode(code, digits) {
  if (!code || code.includes('-')) return code || '------';
  if (digits === 8) return code.slice(0, 4) + ' ' + code.slice(4);
  if (digits === 6) return code.slice(0, 3) + ' ' + code.slice(3);
  return code;
}

/* ---------- 持久化：每次变更后重新加密落盘 + 刷新会话 ---------- */
async function persist() {
  const envelope = await ExtVault.encryptEnvelope(state.data, state.password);
  await ExtVault.saveStoredEnvelope(envelope);
  await ExtVault.saveSession(state.password, state.data);
}

/* ---------- 锁定 / 解锁 ---------- */

let lockMode = 'unlock';

function showLock(mode) {
  lockMode = mode;
  stopTicker();
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
  $('#lock-password').focus();
}

function showMain() {
  $('#view-lock').classList.add('hidden');
  $('#view-main').classList.remove('hidden');
  renderCodes();
  renderRecentDiary();
  startTicker();
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
      state.data = await ExtVault.decryptEnvelope(envelope, pw); // 错密码抛错
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

$('#btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#addBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

/* ---------- 二维码扫码添加（图片文件 / 粘贴图片） ---------- */

function newId() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'id' + Date.now() + Math.floor(Math.random() * 1e9);
}

async function addAccountFromQrText(text) {
  const parsed = OtpCore.parseOtpauth(String(text || '').trim());
  if (!parsed) { toast('二维码不是有效的 OTP 账号'); return; }
  state.data.accounts.push({
    id: newId(),
    name: parsed.account || parsed.name || '',
    issuer: parsed.issuer || '',
    secret: parsed.secret,
    type: parsed.type || 'totp',
    algorithm: parsed.algorithm || 'SHA1',
    digits: parsed.digits || 6,
    period: parsed.period || 30,
    counter: parsed.counter || 0
  });
  await persist();
  renderCodes();
  toast('已添加 ' + (parsed.issuer ? parsed.issuer + ' ' : '') + (parsed.account || ''));
}

async function scanImageFile(file) {
  if (!file) return;
  const text = await QrTools.decodeFile(file);
  if (!text) { toast('没识别出二维码'); return; }
  await addAccountFromQrText(text);
}

$('#btn-qr-scan').addEventListener('click', () => $('#qr-file-input').click());
$('#qr-file-input').addEventListener('change', (e) => {
  scanImageFile(e.target.files[0]);
  e.target.value = '';
});
document.addEventListener('paste', (e) => {
  if (!state.data) return;
  const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  scanImageFile(item.getAsFile());
});

/* ---------- 标签页 ---------- */

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#tab-codes').classList.toggle('hidden', tab.dataset.tab !== 'codes');
    $('#tab-diary').classList.toggle('hidden', tab.dataset.tab !== 'diary');
  });
});

/* ---------- 验证码 ---------- */

const RING_C = 2 * Math.PI * 13.5;

function computeCode(acct) {
  return OtpCore.codeFromSecret(acct.secret, {
    type: acct.type || 'totp',
    counter: acct.counter || 0,
    algorithm: acct.algorithm || 'SHA1',
    digits: acct.digits || 6,
    period: acct.period || 30
  });
}

function renderCodes() {
  const list = $('#codes-list');
  const q = $('#codes-search').value.trim().toLowerCase();
  const accounts = state.data.accounts.filter((a) =>
    !q || (a.name + ' ' + (a.issuer || '')).toLowerCase().includes(q));
  $('#codes-empty').classList.toggle('hidden', state.data.accounts.length > 0);
  const now = Math.floor(Date.now() / 1000);
  list.innerHTML = accounts.map((acct) => {
    const isHotp = acct.type === 'hotp';
    let code = '------';
    let remaining = null;
    try {
      code = computeCode(acct);
      if (!isHotp) remaining = OtpCore.remainingSeconds(acct.period || 30, now);
    } catch (e) { /* 密钥损坏时显示占位 */ }
    const urgent = remaining !== null && remaining <= 5;
    const label = acct.issuer ? `${acct.issuer} (${acct.name})` : acct.name;
    return `
    <button class="code-item" data-id="${acct.id}">
      <span class="meta">
        <span class="name">${esc(label)}${!isHotp && (acct.period || 30) !== 30 ? ` · ${acct.period || 30}s` : ''}</span>
        <span class="code ${urgent ? 'urgent' : ''}" data-role="code">${esc(groupCode(code, acct.digits))}</span>
      </span>
      ${isHotp
        ? '<span class="hotp-tag">计数器</span>'
        : `<span class="ring-wrap"><svg width="34" height="34" viewBox="0 0 34 34">
             <circle class="ring-bg" cx="17" cy="17" r="13.5" fill="none" stroke-width="3"></circle>
             <circle class="ring-fg ${urgent ? 'urgent' : ''}" data-role="ring" cx="17" cy="17" r="13.5" fill="none"
               stroke-width="3" stroke-linecap="round" stroke-dasharray="${RING_C}"
               stroke-dashoffset="${remaining !== null ? RING_C * (1 - remaining / (acct.period || 30)) : 0}"
               transform="rotate(-90 17 17)"></circle>
             <text data-role="ring-text" x="17" y="21" text-anchor="middle" font-size="10" fill="#aaa">${remaining !== null ? remaining : ''}</text>
           </svg></span>`}
    </button>`;
  }).join('');
  list.querySelectorAll('.code-item').forEach((el) => {
    el.addEventListener('click', () => onCodeClick(el.dataset.id));
  });
}

function refreshCodesInPlace() {
  if (!state.data) return;
  const now = Math.floor(Date.now() / 1000);
  $$('#codes-list .code-item').forEach((el) => {
    const acct = state.data.accounts.find((a) => a.id === el.dataset.id);
    if (!acct || acct.type === 'hotp') return;
    let code;
    try { code = computeCode(acct); } catch (e) { return; }
    const remaining = OtpCore.remainingSeconds(acct.period || 30, now);
    const codeEl = el.querySelector('[data-role="code"]');
    const ringEl = el.querySelector('[data-role="ring"]');
    const ringText = el.querySelector('[data-role="ring-text"]');
    codeEl.textContent = groupCode(code, acct.digits);
    codeEl.classList.toggle('urgent', remaining <= 5);
    if (ringText) ringText.textContent = String(remaining);
    if (ringEl) {
      ringEl.style.strokeDashoffset = String(RING_C * (1 - remaining / (acct.period || 30)));
      ringEl.classList.toggle('urgent', remaining <= 5);
    }
  });
}

async function onCodeClick(id) {
  const acct = state.data.accounts.find((a) => a.id === id);
  if (!acct) return;
  let code;
  try {
    code = computeCode(acct);
  } catch (e) { toast('密钥无效，无法生成'); return; }
  if (acct.type === 'hotp') {
    acct.counter = (acct.counter || 0) + 1;
    await persist();
    renderCodes();
  }
  // 1) 复制
  let copied = false;
  try { await navigator.clipboard.writeText(code); copied = true; } catch (e) { /* 忽略 */ }
  // 2) 尝试填入当前标签页
  let filled = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id !== undefined) {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_CODE', code });
      filled = !!(res && res.filled);
    }
  } catch (e) { /* 页面无内容脚本（如 chrome:// 页） */ }
  if (filled) toast(`已填入并复制 ${code}`);
  else if (copied) toast(`已复制 ${code}（未找到验证码输入框）`);
  else toast(code);
}

$('#codes-search').addEventListener('input', renderCodes);

function startTicker() {
  stopTicker();
  state.ticker = setInterval(refreshCodesInPlace, 1000);
}
function stopTicker() {
  if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
}

/* ---------- 日记 ---------- */

function renderRecentDiary() {
  const box = $('#diary-recent');
  const recent = state.data.diary.slice(0, 5);
  if (!recent.length) {
    box.innerHTML = '<div class="empty"><p>暂无日记</p></div>';
    return;
  }
  box.innerHTML = recent.map((d) => `
    <div class="recent-item">
      <span class="r-date">${esc(d.date)}</span>${d.mood ? `<span class="mood-chip">${esc(d.mood)}</span>` : ''}
      <div class="r-title">${esc(d.title || '（无标题）')}</div>
      <div class="r-body">${esc(d.body)}</div>
    </div>`).join('');
}

$('#qd-save').addEventListener('click', async () => {
  const title = $('#qd-title').value.trim();
  const body = $('#qd-body').value;
  if (!title && !body.trim()) { toast('先写点内容'); return; }
  const now = Date.now();
  state.data.diary.unshift({
    id: (crypto.randomUUID ? crypto.randomUUID() : 'd' + now + Math.floor(Math.random() * 1e6)),
    date: new Date().toISOString().slice(0, 10),
    title, body, mood: $('#qd-mood').value,
    createdAt: now, updatedAt: now
  });
  await persist();
  $('#qd-title').value = '';
  $('#qd-body').value = '';
  renderRecentDiary();
  toast('日记已保存');
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
