/* Yousj OTP - TOTP 验证码生成器 */
"use strict";

const PERIOD = 30;   // 30 秒一变（标准 TOTP）
const DIGITS = 6;

/* ---------- Base32 解码 ---------- */
function base32Decode(s) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0, out = [];
  for (const ch of s) {
    val = (val << 5) | alpha.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

/* ---------- TOTP 生成 ---------- */
async function totp(secret, period) {
  period = period || PERIOD;
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter); // 大端，低 32 位
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
  const off = hmac[hmac.length - 1] & 0x0f;
  const n = ((hmac[off] & 0x7f) << 24 | (hmac[off+1] & 0xff) << 16 |
             (hmac[off+2] & 0xff) << 8 | (hmac[off+3] & 0xff)) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, "0");
}

/* ---------- otpauth:// 解析 ---------- */
function parseOtpAuth(url) {
  // otpauth://totp/名字?secret=XXX&issuer=YYY&period=60
  const m = url.match(/^otpauth:\/\/totp\/([^?]+)\?(.+)$/i);
  if (!m) return null;
  const label = decodeURIComponent(m[1]);
  const q = new URLSearchParams(m[2]);
  const secret = q.get("secret");
  if (!secret) return null;
  const issuer = q.get("issuer") || "";
  const period = parseInt(q.get("period") || "15", 10);
  // label 可能是 "issuer:account" 格式
  const name = label.includes(":") ? label.split(":").slice(1).join(":") : label;
  return { name: issuer ? `${issuer} (${name})` : name, secret,
           period: Number.isInteger(period) && period >= 10 && period <= 3600 ? period : 15 };
}

/* ---------- 存储 ---------- */
async function loadAccounts() {
  const r = await chrome.storage.local.get("accounts");
  return r.accounts || [];
}
async function saveAccounts(a) {
  await chrome.storage.local.set({ accounts: a });
}

/* ---------- UI ---------- */
const listEl = document.getElementById("list");
const toastEl = document.getElementById("toast");
let toastTimer = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.style.opacity = 0, 1200);
}

function secondsLeft(period) {
  period = period || PERIOD;
  return period - Math.floor(Date.now() / 1000) % period;
}

/* 倒计时圆环 SVG */
function ringSVG(sec, period) {
  period = period || PERIOD;
  const r = 14, c = 2 * Math.PI * r;
  const frac = sec / period;
  const color = sec <= 5 ? "#ff6b6b" : "#f5a623";
  return `<svg class="ring" viewBox="0 0 34 34">
    <circle cx="17" cy="17" r="${r}" fill="none" stroke="#444" stroke-width="3"/>
    <circle cx="17" cy="17" r="${r}" fill="none" stroke="${color}" stroke-width="3"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"
      transform="rotate(-90 17 17)" stroke-linecap="round"/>
    <text x="17" y="21" text-anchor="middle" font-size="10" fill="#aaa">${sec}</text>
  </svg>`;
}

async function render() {
  const accounts = await loadAccounts();
  if (!accounts.length) {
    listEl.innerHTML = `<div class="empty">还没有账号<br>点右上角 + 添加<br>支持上传二维码图片自动解析</div>`;
    return;
  }
  const sec = 0; // 占位，每卡独立计算
  let html = "";
  for (let i = 0; i < accounts.length; i++) {
    const period = accounts[i].period || 15;
    const sLeft = secondsLeft(period);
    const code = await totp(accounts[i].secret, period).catch(() => "------");
    html += `<div class="card" data-i="${i}">
      <div><div class="name">${esc(accounts[i].name)}${period !== 15 ? ` · ${period}s` : ""}</div>
      <div class="code">${code.slice(0,3)} ${code.slice(3)}</div></div>
      <div style="display:flex;align-items:center">${ringSVG(sLeft, period)}
      <span class="edit" data-edit="${i}" title="编辑">✎</span>
      <span class="del" data-del="${i}" title="删除">×</span></div>
    </div>`;
  }
  listEl.innerHTML = html;
}

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* 点击复制 / 删除 / 编辑（事件委托） */
listEl.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    const i = +del.dataset.del;
    const accounts = await loadAccounts();
    if (confirm(`删除「${accounts[i].name}」？`)) {
      accounts.splice(i, 1);
      await saveAccounts(accounts);
      render();
    }
    return;
  }
  const edt = e.target.closest("[data-edit]");
  if (edt) {
    e.stopPropagation();
    const i = +edt.dataset.edit;
    const accounts = await loadAccounts();
    const a = accounts[i];
    document.getElementById("inpName").value = a.name;
    document.getElementById("inpSecret").value = a.secret;
    document.getElementById("inpPeriod").value = a.period || 15;
    editingIndex = i;
    document.getElementById("btnManual").textContent = "保存修改";
    addPanel.classList.add("show");
    return;
  }
  const card = e.target.closest(".card");
  if (card) {
    const code = card.querySelector(".code").textContent.replace(/\s/g, "");
    await navigator.clipboard.writeText(code);
    toast("已复制 " + code);
  }
});

/* ---------- 添加 / 编辑 ---------- */
const addPanel = document.getElementById("addPanel");
let editingIndex = -1;  // -1 = 新增，>=0 = 正在编辑第几个

document.getElementById("addBtn").onclick = () => {
  // 点 + 时重置为新增模式
  editingIndex = -1;
  document.getElementById("btnManual").textContent = "手动添加";
  document.getElementById("inpName").value = "";
  document.getElementById("inpSecret").value = "";
  document.getElementById("inpPeriod").value = "";
  addPanel.classList.toggle("show");
};

document.getElementById("btnManual").onclick = async () => {
  const name = document.getElementById("inpName").value.trim();
  const secret = document.getElementById("inpSecret").value.trim().replace(/\s/g, "");
  const periodRaw = document.getElementById("inpPeriod").value.trim();
  const period = periodRaw ? parseInt(periodRaw, 10) : 15;
  if (!name || !secret) { toast("名字和密钥都要填"); return; }
  if (!Number.isInteger(period) || period < 10 || period > 3600) {
    toast("时长填 10~3600 的整数秒"); return;
  }
  // 校验密钥能算出码
  try { await totp(secret, period); }
  catch { toast("密钥格式不对"); return; }
  const accounts = await loadAccounts();
  if (editingIndex >= 0 && editingIndex < accounts.length) {
    accounts[editingIndex] = { name, secret, period };
    toast("已保存修改");
  } else {
    accounts.push({ name, secret, period });
    toast("已添加");
  }
  await saveAccounts(accounts);
  editingIndex = -1;
  document.getElementById("btnManual").textContent = "手动添加";
  document.getElementById("inpName").value = "";
  document.getElementById("inpSecret").value = "";
  document.getElementById("inpPeriod").value = "";
  addPanel.classList.remove("show");
  render();
};

/* 上传二维码图片 → jsQR 解析 */
document.getElementById("btnQR").onclick = () =>
  document.getElementById("qrInput").click();

document.getElementById("qrInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const qr = jsQR(data.data, cv.width, cv.height);
    if (!qr || !qr.data) { toast("没识别出二维码"); return; }
    const p = parseOtpAuth(qr.data.trim());
    if (!p) { toast("不是有效的 OTP 二维码"); return; }
    document.getElementById("inpName").value = p.name;
    document.getElementById("inpSecret").value = p.secret;
    document.getElementById("inpPeriod").value = p.period || 15;
    toast("已填入，检查后点「手动添加」保存");
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
  e.target.value = ""; // 允许重复选同一文件
});

/* ---------- 刷新循环：每秒更新码 + 倒计时 ---------- */
render();
setInterval(render, 1000);
