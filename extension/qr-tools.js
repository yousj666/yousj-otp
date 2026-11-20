/* 二维码工具：解码用 jsQR（v1 同款，本地打包）、生成用 qrcode-generator（本地打包）
 * 两者都是全局脚本，先于本文件加载。无 CDN、无网络请求。 */
'use strict';

window.QrTools = (() => {
  /* 从已绘制好的 canvas 解码，返回文本或 null */
  function decodeCanvas(canvas) {
    const w = canvas.width | 0, h = canvas.height | 0;
    if (!w || !h || typeof window.jsQR !== 'function') return null;
    const ctx = canvas.getContext('2d');
    let data;
    try { data = ctx.getImageData(0, 0, w, h); } catch (e) { return null; }
    const res = window.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    return res && res.data ? res.data : null;
  }

  /* 从已加载的 HTMLImageElement 解码（过大时先缩小，提速） */
  function decodeImage(img) {
    const maxSide = 2048;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return decodeCanvas(cv);
  }

  /* 从图片文件（File/Blob）解码，返回 Promise<文本|null> */
  function decodeFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(decodeImage(img)); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  /* 把文本生成二维码，逐模块画到 canvas 上（白底黑码，自带静区） */
  function drawToCanvas(canvas, text) {
    if (typeof window.qrcode !== 'function') throw new Error('二维码生成库未加载');
    const qr = window.qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const scale = Math.max(3, Math.floor(288 / (n + quiet * 2)));
    canvas.width = (n + quiet * 2) * scale;
    canvas.height = (n + quiet * 2) * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return canvas.width;
  }

  return { decodeCanvas, decodeImage, decodeFile, drawToCanvas };
})();
