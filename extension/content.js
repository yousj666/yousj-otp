/*
 * 内容脚本：收到 popup 的 FILL_CODE 消息后，把验证码填入当前页面的验证码输入框。
 * 识别顺序：
 *  1. autocomplete="one-time-code" 的输入框
 *  2. name/id/aria-label/placeholder 含 otp/code/token/2fa/验证码 等关键词的单框
 *  3. 一组 maxlength=1 的单字框 → 逐字填
 * 填值走原生 setter 并派发 input/change 事件，兼容 React/Vue 受控组件。
 */
(function () {
  'use strict';

  var KEYWORDS = /(otp|one[-_ ]?time|2fa|two[-_ ]?factor|verification|verify|auth|token|code|验证码|动态码|校验码)/i;

  function isVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    var st = window.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }

  function setValue(input, value) {
    var proto = window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function textInputs() {
    return Array.prototype.filter.call(
      document.querySelectorAll('input'),
      function (el) {
        var t = (el.type || 'text').toLowerCase();
        return ['text', 'tel', 'number', ''].indexOf(t) >= 0 && isVisible(el);
      });
  }

  function describe(el) {
    return [el.name, el.id, el.getAttribute('aria-label'), el.placeholder,
            el.getAttribute('autocomplete')].join(' ');
  }

  function fillSingle(code) {
    var inputs = textInputs();
    var target = null;
    // 1) one-time-code
    target = inputs.filter(function (el) {
      return (el.getAttribute('autocomplete') || '') === 'one-time-code';
    })[0];
    // 2) 关键词单框（maxLength 未限制或 >= 验证码长度）
    if (!target) {
      target = inputs.filter(function (el) {
        var ml = el.maxLength;
        return KEYWORDS.test(describe(el)) && (ml === -1 || ml >= code.length);
      })[0];
    }
    // 3) inputmode=numeric 的单框兜底
    if (!target) {
      target = inputs.filter(function (el) {
        var ml = el.maxLength;
        return el.getAttribute('inputmode') === 'numeric' && (ml === -1 || ml >= code.length);
      })[0];
    }
    if (!target) return false;
    target.focus();
    setValue(target, code);
    return true;
  }

  function fillSplit(code) {
    var boxes = textInputs().filter(function (el) { return el.maxLength === 1; });
    if (boxes.length < code.length) return false;
    for (var i = 0; i < code.length; i++) {
      boxes[i].focus();
      setValue(boxes[i], code[i]);
    }
    boxes[Math.min(code.length, boxes.length) - 1].focus();
    return true;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'FILL_CODE' || !msg.code) return;
    var code = String(msg.code).replace(/\s+/g, '');
    var ok = fillSingle(code);
    var mode = ok ? 'single' : null;
    if (!ok && fillSplit(code)) { ok = true; mode = 'split'; }
    sendResponse({ filled: ok, mode: mode });
    return true;
  });
})();
