/* ============================================
   PHOTO EDITOR — asosiy ilova
   ============================================ */
'use strict';

// ===== HOLAT (STATE) =====
const State = {
  image: null,           // HTMLImageElement
  original: null,        // original ImageData
  history: [],           // snapshotlar [{state, opts}] (50 tagacha)
  future: [],            // redo
  current: null,         // hozirgi ImageData
  opts: defaultOpts(),   // barcha effekt qiymatlari
  crop: null,            // {x,y,w,h,ratio}
  rotate: 0,
  ratio: 'free',
  activeLut: null,
  fileName: 'rasm',
  projectId: null
};

function defaultOpts() {
  return {
    brightness: 0, contrast: 0, exposure: 0, saturation: 0, vibrance: 0, temperature: 0,
    hsl: { red:{h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0},
           green:{h:0,s:0,l:0}, aqua:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0},
           purple:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} },
    curves: { rgb:[0,0,255,255], r:[0,0,255,255], g:[0,0,255,255], b:[0,0,255,255] },
    sharpen: 0, clarity: 0, dehaze: 0, vignette: 0, grain: 0,
    splitShade: 0, splitHigh: 0, splitBalance: 0,
    selR: 0, selG: 0, selB: 0,
    hdr: 0, fade: 0
  };
}

// ===== DOM =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const home = $('#home');
const editor = $('#editor');
const canvas = $('#mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const overlay = $('#canvasOverlay');

// ===== TOAST =====
let toastTimer = null;
function toast(msg, dur = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, dur);
}

// ===== SOZLAMALAR (theme + accent) =====
function loadSettings() {
  const theme = localStorage.getItem('pe_theme') || 'auto';
  const accent = localStorage.getItem('pe_accent') || '#5B8DEF';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent, 0.18));
  $$('input[name="theme"]').forEach(r => r.checked = r.value === theme);
  $$('.accent').forEach(b => b.classList.toggle('active', b.dataset.color === accent));
}
function hexToRgba(hex, a) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0,2),16);
  const g = parseInt(c.substr(2,2),16);
  const b = parseInt(c.substr(4,2),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ===== BOSH SAHIFA =====
async function refreshProjects() {
  const projects = Store.list();
  const wrap = $('#projectsList');
  $('#projectsCount').textContent = projects.length;
  if (!projects.length) {
    wrap.innerHTML = '<p class="empty-state">Hozircha loyihalar yoʻq. Birinchi rasmni yuklang!</p>';
    return;
  }
  wrap.innerHTML = projects.map(p => `
    <div class="project-card" data-id="${p.id}">
      <img src="${p.thumb}" alt="">
      <div class="pname">${escapeHtml(p.name)}</div>
      <button class="pdel" data-del="${p.id}">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      const id = card.dataset.id;
      const p = Store.get(id);
      if (p) loadProject(p);
    });
  });
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.remove(btn.dataset.del);
      refreshProjects();
      toast('Loyiha oʻchirildi');
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== RASM YUKLASH =====
$('#pickImageBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  State.fileName = file.name.replace(/\.[^.]+$/, '') || 'rasm';
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    initEditor(img);
  };
  img.onerror = () => toast('Rasmni ochib boʻlmadi');
  img.src = url;
});

function initEditor(img, savedData = null) {
  State.image = img;
  State.history = [];
  State.future = [];
  State.opts = defaultOpts();
  State.projectId = null;
  State.activeLut = null;
  State.ratio = 'free';
  State.crop = null;
  State.rotate = 0;
  $$('.ratio-btn').forEach(b => b.classList.toggle('active', b.dataset.ratio === 'free'));
  $$('.lut-tile').forEach(t => t.classList.remove('active'));
  $('#rotateSlider') && ($('#rotateSlider').value = 0);

  // Maksimal 2400px — tez ishlash uchun
  const maxSide = 2400;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > maxSide || h > maxSide) {
    const k = Math.min(maxSide/w, maxSide/h);
    w = Math.round(w * k); h = Math.round(h * k);
  }
  canvas.width = w; canvas.height = h;

  // Original ImageData
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0, w, h);
  State.original = octx.getImageData(0, 0, w, h);
  State.current = new ImageData(new Uint8ClampedArray(State.original.data), w, h);

  // Reset all sliders
  $$('input[type="range"][data-effect]').forEach(s => {
    s.value = 0;
    s.parentElement.querySelector('.val').textContent = s.dataset.effect === 'rotate' ? '0°' : '0';
  });
  // Reset HSL sliders
  buildHSL();

  showEditor();
  setTimeout(() => render(), 50);
}

function showEditor() {
  home.classList.remove('active');
  editor.classList.add('active');
  $('#editorFileName').textContent = State.fileName;
}
function showHome() {
  editor.classList.remove('active');
  home.classList.add('active');
  refreshProjects();
}
$('#backToHome').addEventListener('click', () => {
  if (optsHasChanges()) {
    askSaveBeforeLeave();
  } else {
    showHome();
  }
});

function askSaveBeforeLeave() {
  const m = $('#saveModal');
  $('#projectName').value = State.fileName;
  m.hidden = false;
}
$('#saveProjectBtn').addEventListener('click', () => {
  const name = $('#projectName').value.trim() || 'Loyiha';
  const project = saveProject(name);
  $('#saveModal').hidden = true;
  toast('Loyiha saqlandi');
  showHome();
});
// saveModal close handler — umumiy modal handler pastda bor

// ===== RENDER PIPELINE =====
let renderToken = 0;
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 16);
}

function render() {
  if (!State.original) return;
  const myToken = ++renderToken;
  overlay.hidden = false;

  setTimeout(() => {
    if (myToken !== renderToken) return;
    try {
      // original dan boshlash
      const w = State.original.width, h = State.original.height;
      const src = new ImageData(new Uint8ClampedArray(State.original.data), w, h);
      const o = State.opts;

      // 1. Asosiy effektlar
      applyBrightness(src, o.brightness);
      applyContrast(src, o.contrast);
      applyExposure(src, o.exposure);
      applySaturation(src, o.saturation);
      applyVibrance(src, o.vibrance);
      applyTemperature(src, o.temperature);

      // 2. HSL
      applyHSL(src, o.hsl);

      // 3. Curves
      if (hasCurveChanges(o.curves)) applyCurves(src, o.curves);

      // 4. Detail
      applyClarity(src, o.clarity);
      applyDehaze(src, o.dehaze);
      if (o.vignette) applyVignette(src, o.vignette);
      if (o.grain) applyGrain(src, o.grain);
      if (o.sharpen) applySharpen(src, o.sharpen);

      // 5. Effects
      if (o.splitShade || o.splitHigh) applySplitTone(src, o.splitShade, o.splitHigh, o.splitBalance);
      if (o.selR || o.selG || o.selB) applySelectiveColor(src, o.selR, o.selG, o.selB);
      if (o.hdr) applyHDR(src, o.hdr);
      if (o.fade) applyFade(src, o.fade);

      // 6. LUT
      if (State.activeLut) applyLUT(src, State.activeLut);

      State.current = src;
      ctx.putImageData(src, 0, 0);
    } catch (err) {
      console.error(err);
      toast('Render xatosi: ' + err.message);
    }
    overlay.hidden = true;
  }, 10);
}

function optsHasChanges() {
  // Sodda tekshirish
  return JSON.stringify(State.opts) !== JSON.stringify(defaultOpts()) || State.activeLut;
}

// ===== EFFEKTLAR =====
// (bitta faylda bo'limlarga ajratilgan)

function applyBrightness(d, v) {
  if (!v) return;
  const k = v * 2.55;
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = clamp(d.data[i] + k);
    d.data[i+1] = clamp(d.data[i+1] + k);
    d.data[i+2] = clamp(d.data[i+2] + k);
  }
}
function applyContrast(d, v) {
  if (!v) return;
  const k = Math.pow((v + 100) / 100, 2);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = clamp((d.data[i] - 128) * k + 128);
    d.data[i+1] = clamp((d.data[i+1] - 128) * k + 128);
    d.data[i+2] = clamp((d.data[i+2] - 128) * k + 128);
  }
}
function applyExposure(d, v) {
  if (!v) return;
  const k = Math.pow(2, v / 100);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = clamp(d.data[i] * k);
    d.data[i+1] = clamp(d.data[i+1] * k);
    d.data[i+2] = clamp(d.data[i+2] * k);
  }
}
function applySaturation(d, v) {
  if (!v) return;
  const s = 1 + v / 100;
  for (let i = 0; i < d.data.length; i += 4) {
    const g = 0.299 * d.data[i] + 0.587 * d.data[i+1] + 0.114 * d.data[i+2];
    d.data[i] = clamp(g + s * (d.data[i] - g));
    d.data[i+1] = clamp(g + s * (d.data[i+1] - g));
    d.data[i+2] = clamp(g + s * (d.data[i+2] - g));
  }
}
function applyVibrance(d, v) {
  if (!v) return;
  const a = v / 100 * 0.6;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    const sat = (mx === 0) ? 0 : (mx - mn) / mx;
    const adj = 1 + a * (1 - sat);
    const gray = 0.299*r + 0.587*g + 0.114*b;
    d.data[i] = clamp(gray + adj * (r - gray));
    d.data[i+1] = clamp(gray + adj * (g - gray));
    d.data[i+2] = clamp(gray + adj * (b - gray));
  }
}
function applyTemperature(d, v) {
  if (!v) return;
  const k = v / 100 * 40;
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = clamp(d.data[i] + k);     // issiq = +R
    d.data[i+2] = clamp(d.data[i+2] - k); // sovuq = -B
  }
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// HSL — har bir rang alohida H/S/L
function applyHSL(d, hsl) {
  if (!hsl) return;
  let any = false;
  for (const k in hsl) {
    const c = hsl[k];
    if (c.h || c.s || c.l) { any = true; break; }
  }
  if (!any) return;

  // Har rang uchun markaziy hue
  const ranges = {
    red:     [0,   15], orange: [15,  45], yellow: [45,  70],
    green:   [70, 150], aqua:   [150,195], blue:   [195,240],
    purple:  [240,275], magenta:[275,330]
  };
  // HSL ga o'tkazish
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    const [h, s, l] = rgbToHsl(r, g, b);
    // qaysi diapazon?
    let modifiedH = h, modifiedS = s, modifiedL = l;
    for (const name in ranges) {
      const [lo, hi] = ranges[name];
      const c = hsl[name];
      if (h >= lo && h < hi) {
        modifiedH = wrapHue(h + c.h);
        modifiedS = clamp01(s * (1 + c.s/100));
        modifiedL = clamp01(l * (1 + c.l/100));
        break;
      }
    }
    const [nr, ng, nb] = hslToRgb(modifiedH, modifiedS, modifiedL);
    d.data[i] = nr; d.data[i+1] = ng; d.data[i+2] = nb;
  }
}
function rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
  const l = (mx+mn)/2;
  let h, s;
  if (mx === mn) { h = 0; s = 0; }
  else {
    const d = mx - mn;
    s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
    switch(mx) {
      case r: h = (g-b)/d + (g<b?6:0); break;
      case g: h = (b-r)/d + 2; break;
      case b: h = (r-g)/d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s); l = clamp01(l);
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs(((h/60) % 2) - 1));
  const m = l - c/2;
  let r, g, b;
  if (h < 60) [r,g,b] = [c,x,0];
  else if (h < 120) [r,g,b] = [x,c,0];
  else if (h < 180) [r,g,b] = [0,c,x];
  else if (h < 240) [r,g,b] = [0,x,c];
  else if (h < 300) [r,g,b] = [x,0,c];
  else [r,g,b] = [c,0,x];
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function wrapHue(h) { h = h % 360; return h < 0 ? h + 360 : h; }

// CURVES
function hasCurveChanges(curves) {
  for (const ch in curves) {
    const c = curves[ch];
    if (c[0] !== 0 || c[1] !== 0 || c[2] !== 255 || c[3] !== 255) return true;
  }
  return false;
}
function applyCurves(d, curves) {
  const lutR = makeCurveLut(curves.r);
  const lutG = makeCurveLut(curves.g);
  const lutB = makeCurveLut(curves.b);
  const lutM = makeCurveLut(curves.rgb);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    // har bir kanal uchun curve, keyin RGB master
    let nr = lutR[r], ng = lutG[g], nb = lutB[b];
    nr = lutM[nr]; ng = lutM[ng]; nb = lutM[nb];
    d.data[i] = nr; d.data[i+1] = ng; d.data[i+2] = nb;
  }
}
function makeCurveLut(pts) {
  // pts: [x0,y0,x1,y1] — 2 nuqta, line chizish
  // Soddalashtirilgan: hozir 2 nuqta orasida line
  const lut = new Uint8ClampedArray(256);
  const x0 = pts[0], y0 = pts[1], x1 = pts[2], y1 = pts[3];
  for (let i = 0; i < 256; i++) {
    let v;
    if (x0 === 0 && x1 === 255 && y0 === 0 && y1 === 255) {
      v = i; // identity
    } else {
      // P1=old daraja, P2=keyingi daraja — linear interpolyatsiya
      if (i <= x0) v = y0;
      else if (i >= x1) v = y1;
      else v = y0 + (y1 - y0) * (i - x0) / (x1 - x0);
    }
    lut[i] = clamp(v);
  }
  return lut;
}

function applyClarity(d, v) {
  if (!v) return;
  // oddiy usul: S-curve ga o'xshash — contrast ni o'rtacha atrofida kuchaytirish
  const k = v / 100;
  // local contrast approximation: har pikselga uning 4 qo'shnisi o'rtachasini solishtirish
  const w = d.width, h = d.height;
  const src = new Uint8ClampedArray(d.data);
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const i = (y*w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[i+c];
        const avg = (src[i-4+c] + src[i+4+c] + src[i-w*4+c] + src[i+w*4+c]) / 4;
        const diff = center - avg;
        d.data[i+c] = clamp(center + diff * k * 0.5);
      }
    }
  }
}
function applyDehaze(d, v) {
  if (!v) return;
  const k = v / 100;
  for (let i = 0; i < d.data.length; i += 4) {
    // oddiy dehaze: kontrast + to'yinganlik
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    const gray = 0.299*r + 0.587*g + 0.114*b;
    // yuqori kontrast + rang kuchaytirish
    const sat = (mx - mn) / 255;
    const f = 1 + k * 0.4 * (1 - sat); // kam to'yingan joylarda kuchliroq
    d.data[i] = clamp(gray + f * (r - gray) + k*15);
    d.data[i+1] = clamp(gray + f * (g - gray) + k*15);
    d.data[i+2] = clamp(gray + f * (b - gray) + k*15);
  }
}
function applyVignette(d, v) {
  if (!v) return;
  const w = d.width, h = d.height;
  const cx = w/2, cy = h/2;
  const maxR = Math.sqrt(cx*cx + cy*cy);
  const k = v / 100; // -1..1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx*dx + dy*dy) / maxR;
      // yumaloq gradient
      const t = Math.max(0, r * 1.3 - 0.3);
      const factor = 1 - k * t * t;
      const i = (y*w + x) * 4;
      d.data[i] = clamp(d.data[i] * factor);
      d.data[i+1] = clamp(d.data[i+1] * factor);
      d.data[i+2] = clamp(d.data[i+2] * factor);
    }
  }
}
function applyGrain(d, amount) {
  if (!amount) return;
  // tasodifiy shovqin
  const amp = amount * 0.6;
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * amp;
    d.data[i] = clamp(d.data[i] + n);
    d.data[i+1] = clamp(d.data[i+1] + n);
    d.data[i+2] = clamp(d.data[i+2] + n);
  }
}
function applySharpen(d, amount) {
  if (!amount) return;
  const w = d.width, h = d.height;
  const src = new Uint8ClampedArray(d.data);
  // Unsharp mask: original - blurred
  const k = amount / 100;
  // oddiy 3x3 qo'shnilar bilan farq
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const i = (y*w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[i+c];
        const avg = (
          src[i-4+c] + src[i+4+c] +
          src[i-w*4+c] + src[i+w*4+c]
        ) / 4;
        const sharpened = center + (center - avg) * k;
        d.data[i+c] = clamp(sharpened);
      }
    }
  }
}

function applySplitTone(d, shade, high, balance) {
  if (!shade && !high) return;
  // shade = -100..100 (soya uchun), high = -100..100 (yorug'lik uchun)
  // balance = -100..100 — soya va yorug'lik o'rtasidagi muvozanat
  const bAdj = balance / 200;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    const lum = (r + g + b) / (3 * 255);
    // soya: lum < 0.5, yorug'lik: lum > 0.5
    const shadeW = Math.max(0, 1 - lum * 2 + bAdj);
    const highW = Math.max(0, lum * 2 - 1 - bAdj);
    // ko'k soya: -R, +B; sariq yorug'lik: +R, +G, -B
    const r2 = r + (shade * shadeW * -0.4) + (high * highW * 0.5);
    const g2 = g + (high * highW * 0.3);
    const b2 = b + (shade * shadeW * 0.5) + (high * highW * -0.4);
    d.data[i] = clamp(r2); d.data[i+1] = clamp(g2); d.data[i+2] = clamp(b2);
  }
}

function applySelectiveColor(d, sr, sg, sb) {
  if (!sr && !sg && !sb) return;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    const mx = Math.max(r,g,b);
    if (mx === r) d.data[i] = clamp(r + sr * 0.5);
    else if (mx === g) d.data[i+1] = clamp(g + sg * 0.5);
    else d.data[i+2] = clamp(b + sb * 0.5);
    // sub-channels
    if (r === mx) d.data[i+1] = clamp(g + sr * 0.2);
    if (g === mx) d.data[i+2] = clamp(b + sg * 0.2);
    if (b === mx) d.data[i] = clamp(r + sb * 0.2);
  }
}

function applyHDR(d, v) {
  if (!v) return;
  // tone mapping + saturation boost
  const k = v / 100;
  for (let i = 0; i < d.data.length; i += 4) {
    let r = d.data[i] / 255, g = d.data[i+1] / 255, b = d.data[i+2] / 255;
    // Reinhard tone map
    r = r * (1 + k * 0.5) / (1 + k * 0.4 * r);
    g = g * (1 + k * 0.5) / (1 + k * 0.4 * g);
    b = b * (1 + k * 0.5) / (1 + k * 0.4 * b);
    d.data[i] = clamp(r * 255);
    d.data[i+1] = clamp(g * 255);
    d.data[i+2] = clamp(b * 255);
  }
}
function applyFade(d, v) {
  if (!v) return;
  // Fade: qora nuqtalarni ko'tarish
  const k = v * 0.5;
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = clamp(d.data[i] + k);
    d.data[i+1] = clamp(d.data[i+1] + k);
    d.data[i+2] = clamp(d.data[i+2] + k);
  }
}

// ===== LUT =====
function applyLUT(d, lut) {
  // lut: { size, data: Uint8Array(r*r*r*3) }
  const s = lut.size;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
    const ri = Math.floor(r / 256 * s);
    const gi = Math.floor(g / 256 * s);
    const bi = Math.floor(b / 256 * s);
    const idx = (ri * s * s + gi * s + bi) * 3;
    d.data[i] = lut.data[idx];
    d.data[i+1] = lut.data[idx+1];
    d.data[i+2] = lut.data[idx+2];
  }
}

// 10 ta tayyor cinematic LUT — procedural formula orqali
const LUT_PRESETS = [
  { id: 'tealorange', name: 'Teal & Orange',
    fn: (r,g,b) => {
      // Soya → cyan/teal, yorug'lik → orange
      const lum = (r+g+b)/3/255;
      const tint = lum < 0.5 ? 'cool' : 'warm';
      if (tint === 'cool') {
        return [clamp(r*0.85), clamp(g*1.1), clamp(b*1.2)];
      } else {
        return [clamp(r*1.25), clamp(g*1.1), clamp(b*0.75)];
      }
    } },
  { id: 'bladerunner', name: 'Blade Runner',
    fn: (r,g,b) => {
      // Neon ko'k, binafsha, sariq
      const lum = (r+g+b)/3/255;
      return [
        clamp(r*0.9 + lum*30),
        clamp(g*0.8 + (1-lum)*20),
        clamp(b*1.4 + lum*40)
      ];
    } },
  { id: 'wesanderson', name: 'Wes Anderson',
    fn: (r,g,b) => {
      // pastel, issiq pushti-sariq
      return [
        clamp(r*1.1 + 15),
        clamp(g*0.95 + 10),
        clamp(b*0.8 + 5)
      ];
    } },
  { id: 'marvel', name: 'Marvel',
    fn: (r,g,b) => {
      // yuqori kontrast, to'yingan, ko'k soya
      const k = 1.2;
      return [
        clamp((r-128)*k + 128 + 10),
        clamp((g-128)*k + 128),
        clamp((b-128)*k + 128 + 20)
      ];
    } },
  { id: 'noir', name: 'Noir',
    fn: (r,g,b) => {
      const gray = 0.299*r + 0.587*g + 0.114*b;
      const c = (gray - 128) * 1.4 + 128;
      return [clamp(c), clamp(c), clamp(c)];
    } },
  { id: 'sepia', name: 'Sepia',
    fn: (r,g,b) => {
      const gray = 0.299*r + 0.587*g + 0.114*b;
      return [clamp(gray*1.0 + 40), clamp(gray*0.85 + 20), clamp(gray*0.6)];
    } },
  { id: 'vintage', name: 'Vintage',
    fn: (r,g,b) => {
      return [clamp(r*1.1+20), clamp(g*0.95), clamp(b*0.75+5)];
    } },
  { id: 'moody', name: 'Moody',
    fn: (r,g,b) => {
      // desaturated, dark teal
      const lum = (r+g+b)/3/255;
      return [
        clamp(r*0.85 - 5),
        clamp(g*0.95),
        clamp(b*1.1 + 10)
      ];
    } },
  { id: 'cyberpunk', name: 'Cyberpunk',
    fn: (r,g,b) => {
      // magenta + cyan
      return [
        clamp(r*1.3 + 20),
        clamp(g*0.7 + 5),
        clamp(b*1.3 + 30)
      ];
    } },
  { id: 'kodachrome', name: 'Kodachrome',
    fn: (r,g,b) => {
      // boy, warm reds, deep blues
      return [
        clamp(r*1.2 + 10),
        clamp(g*1.0),
        clamp(b*0.85 + 5)
      ];
    } }
];

function applyLutById(id) {
  if (id === 'none' || !id) {
    State.activeLut = null;
    $$('.lut-tile').forEach(t => t.classList.remove('active'));
    render(); return;
  }
  const p = LUT_PRESETS.find(x => x.id === id);
  if (!p) return;
  // Procedural LUT: 16x16x16 (tez)
  const s = 16;
  const arr = new Uint8Array(s*s*s*3);
  for (let r = 0; r < s; r++) {
    for (let g = 0; g < s; g++) {
      for (let b = 0; b < s; b++) {
        const R = Math.round(r * 255 / (s-1));
        const G = Math.round(g * 255 / (s-1));
        const B = Math.round(b * 255 / (s-1));
        const [nr, ng, nb] = p.fn(R, G, B);
        const idx = (r*s*s + g*s + b) * 3;
        arr[idx] = nr; arr[idx+1] = ng; arr[idx+2] = nb;
      }
    }
  }
  State.activeLut = { size: s, data: arr };
  $$('.lut-tile').forEach(t => t.classList.toggle('active', t.dataset.lut === id));
  render();
}

function buildLUTs() {
  const wrap = $('#lutGrid');
  // "yo'q" varianti
  wrap.innerHTML = `<div class="lut-tile" data-lut="none" style="background:var(--bg-elev-2);display:grid;place-items:center;color:var(--text-dim);font-size:11px;">Asl</div>` +
    LUT_PRESETS.map(p => `
      <div class="lut-tile" data-lut="${p.id}">
        <canvas class="lut-preview" data-id="${p.id}" width="100" height="100"></canvas>
        <div class="lut-name">${p.name}</div>
      </div>
    `).join('');
  wrap.querySelectorAll('.lut-tile').forEach(t => {
    t.addEventListener('click', () => applyLutById(t.dataset.lut));
  });
  // Preview yaratish
  LUT_PRESETS.forEach(p => {
    const c = wrap.querySelector(`canvas[data-id="${p.id}"]`);
    if (!c) return;
    const cx = c.getContext('2d');
    // gradient
    const grd = cx.createLinearGradient(0,0,100,100);
    grd.addColorStop(0, '#3a78a3');
    grd.addColorStop(0.5, '#d2a06a');
    grd.addColorStop(1, '#2a2a3a');
    cx.fillStyle = grd;
    cx.fillRect(0,0,100,100);
    const data = cx.getImageData(0,0,100,100);
    for (let i = 0; i < data.data.length; i += 4) {
      const [r,g,b] = p.fn(data.data[i], data.data[i+1], data.data[i+2]);
      data.data[i] = r; data.data[i+1] = g; data.data[i+2] = b;
    }
    cx.putImageData(data, 0, 0);
  });
}

// .cube fayl import
$('#cubeInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const lut = parseCubeLUT(text);
  if (!lut) { toast('.cube faylni oʻqib boʻlmadi'); return; }
  State.activeLut = lut;
  $$('.lut-tile').forEach(t => t.classList.remove('active'));
  toast(`"${file.name}" yuklandi`);
  render();
});

function parseCubeLUT(text) {
  // .cube format: LUT_3D_SIZE N, keyin RGB qatorlari
  const lines = text.split('\n');
  let size = 0;
  const data = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('TITLE') || t.startsWith('DOMAIN')) continue;
    if (t.startsWith('LUT_3D_SIZE')) {
      size = parseInt(t.split(/\s+/)[1]);
      continue;
    }
    if (t.startsWith('LUT_1D_SIZE')) continue; // faqat 3D
    const p = t.split(/\s+/);
    if (p.length >= 3) {
      const r = parseFloat(p[0]), g = parseFloat(p[1]), b = parseFloat(p[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        data.push([r, g, b]);
      }
    }
  }
  if (!size || data.length !== size*size*size) return null;
  const arr = new Uint8Array(data.length * 3);
  for (let i = 0; i < data.length; i++) {
    arr[i*3] = clamp(Math.round(data[i][0] * 255));
    arr[i*3+1] = clamp(Math.round(data[i][1] * 255));
    arr[i*3+2] = clamp(Math.round(data[i][2] * 255));
  }
  return { size, data: arr };
}

// ===== UI BINDINGS =====

// Slider events
$$('input[type="range"][data-effect]').forEach(slider => {
  slider.addEventListener('input', () => {
    const eff = slider.dataset.effect;
    const v = parseFloat(slider.value);
    const valSpan = slider.parentElement.querySelector('.val');
    if (valSpan) valSpan.textContent = eff === 'rotate' ? v + '°' : v;
    State.opts[eff] = v;
    scheduleRender();
    // har 10 ta o'zgarishda snapshot
    if (Math.random() < 0.15) snapshot();
  });
  slider.addEventListener('change', () => snapshot());
});

// HSL grid
function buildHSL() {
  const colors = [
    { id:'red',     name:'Qizil',  hex:'#e23b3b' },
    { id:'orange',  name:'Apelsin',hex:'#e2863b' },
    { id:'yellow',  name:'Sariq',  hex:'#e2c83b' },
    { id:'green',   name:'Yashil', hex:'#3be263' },
    { id:'aqua',    name:'Moviy',  hex:'#3bd6e2' },
    { id:'blue',    name:'Koʻk',   hex:'#3b6be2' },
    { id:'purple',  name:'Binafsha',hex:'#9b3be2' },
    { id:'magenta', name:'Magenta',hex:'#e23bd2' }
  ];
  const wrap = $('#hslGrid');
  wrap.innerHTML = colors.map(c => `
    <div class="hsl-row">
      <div class="swatch" style="background:${c.hex}"></div>
      <div class="hsl-mini"><input type="range" min="-100" max="100" value="0" data-hsl="${c.id}-h"><span>H</span></div>
      <div class="hsl-mini"><input type="range" min="-100" max="100" value="0" data-hsl="${c.id}-s"><span>S</span></div>
      <div class="hsl-mini"><input type="range" min="-100" max="100" value="0" data-hsl="${c.id}-l"><span>L</span></div>
    </div>
  `).join('');
  wrap.querySelectorAll('input[data-hsl]').forEach(inp => {
    inp.addEventListener('input', () => {
      const [c, k] = inp.dataset.hsl.split('-');
      State.opts.hsl[c][k] = parseFloat(inp.value);
      scheduleRender();
    });
    inp.addEventListener('change', () => snapshot());
  });
}

// Tabs
$$('.tab').forEach(t => {
  t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const target = t.dataset.tool;
    $$('.tool-page').forEach(p => p.classList.toggle('active', p.dataset.page === target));
  });
});
$$('.sub-tab').forEach(t => {
  t.addEventListener('click', () => {
    const parent = t.parentElement;
    parent.querySelectorAll('.sub-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const target = t.dataset.sub;
    parent.parentElement.querySelectorAll('.sub-page').forEach(p => p.classList.toggle('active', p.dataset.subPage === target));
  });
});

// Ratio
$$('.ratio-btn').forEach(b => {
  b.addEventListener('click', () => {
    $$('.ratio-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    State.ratio = b.dataset.ratio;
  });
});

// Undo/Redo
$('#undoBtn').addEventListener('click', () => undo());
$('#redoBtn').addEventListener('click', () => redo());

function snapshot() {
  State.history.push(JSON.parse(JSON.stringify(State.opts)));
  if (State.history.length > 50) State.history.shift();
  State.future = [];
}
function undo() {
  if (State.history.length < 1) { toast('Bekor qilinadigan narsa yoʻq'); return; }
  const last = State.history.pop();
  State.future.push(JSON.parse(JSON.stringify(State.opts)));
  State.opts = last;
  syncSlidersFromOpts();
  render();
}
function redo() {
  if (State.future.length < 1) { toast('Qaytariladigan narsa yoʻq'); return; }
  const next = State.future.pop();
  State.history.push(JSON.parse(JSON.stringify(State.opts)));
  State.opts = next;
  syncSlidersFromOpts();
  render();
}
function syncSlidersFromOpts() {
  $$('input[type="range"][data-effect]').forEach(s => {
    const v = State.opts[s.dataset.effect];
    if (typeof v === 'number') {
      s.value = v;
      const valSpan = s.parentElement.querySelector('.val');
      if (valSpan) valSpan.textContent = s.dataset.effect === 'rotate' ? v + '°' : v;
    }
  });
  // HSL
  $$('input[data-hsl]').forEach(inp => {
    const [c, k] = inp.dataset.hsl.split('-');
    if (State.opts.hsl[c]) inp.value = State.opts.hsl[c][k];
  });
}

// ===== LOYIHALAR (localStorage) =====
const Store = {
  KEY: 'pe_projects',
  list() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
  },
  get(id) {
    return this.list().find(p => p.id === id);
  },
  add(project) {
    const list = this.list();
    list.unshift(project);
    if (list.length > 30) list.pop();
    localStorage.setItem(this.KEY, JSON.stringify(list));
  },
  remove(id) {
    const list = this.list().filter(p => p.id !== id);
    localStorage.setItem(this.KEY, JSON.stringify(list));
  },
  clear() {
    localStorage.removeItem(this.KEY);
  }
};

async function saveProject(name) {
  // thumb yaratish (kichik canvas)
  const tw = 200, th = 200;
  const tcanvas = document.createElement('canvas');
  tcanvas.width = tw; tcanvas.height = th;
  const tctx = tcanvas.getContext('2d');
  // center crop
  const sw = State.original.width, sh = State.original.height;
  const ratio = Math.max(tw/sw, th/sh);
  const dw = sw*ratio, dh = sh*ratio;
  tctx.drawImage(canvas, (tw-dw)/2, (th-dh)/2, dw, dh);
  const thumb = tcanvas.toDataURL('image/jpeg', 0.7);

  const project = {
    id: 'p_' + Date.now(),
    name,
    created: Date.now(),
    thumb,
    opts: State.opts,
    originalData: State.original ? arrayToBase64(State.original.data) : null,
    width: State.original?.width,
    height: State.original?.height,
    activeLut: State.activeLut ? lutToObj(State.activeLut) : null,
    fileName: State.fileName
  };
  Store.add(project);
  State.projectId = project.id;
  return project;
}

function arrayToBase64(arr) {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}
function base64ToArray(b64) {
  const bin = atob(b64);
  const arr = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function lutToObj(lut) {
  return { size: lut.size, data: Array.from(lut.data) };
}
function objToLut(o) {
  return { size: o.size, data: new Uint8Array(o.data) };
}

async function loadProject(p) {
  if (!p.originalData || !p.width) { toast('Loyiha buzilgan'); return; }
  const arr = base64ToArray(p.originalData);
  const data = new ImageData(arr, p.width, p.height);
  State.fileName = p.name;
  State.opts = p.opts || defaultOpts();
  State.activeLut = p.activeLut ? objToLut(p.activeLut) : null;
  State.projectId = p.id;
  State.original = data;
  State.current = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  State.history = [];
  State.future = [];
  State.ratio = 'free';
  State.crop = null;
  $$('.ratio-btn').forEach(b => b.classList.toggle('active', b.dataset.ratio === 'free'));
  $$('.lut-tile').forEach(t => {
    t.classList.toggle('active', State.activeLut && LUT_PRESETS.find(x => x.id === t.dataset.lut) === null ? false : false);
  });

  canvas.width = data.width;
  canvas.height = data.height;
  buildHSL();
  syncSlidersFromOpts();
  showEditor();
  setTimeout(() => render(), 50);
}

// ===== SOZLAMALAR =====
$('#openSettings').addEventListener('click', () => $('#settingsModal').hidden = false);
$$('input[name="theme"]').forEach(r => r.addEventListener('change', () => {
  document.documentElement.setAttribute('data-theme', r.value);
  localStorage.setItem('pe_theme', r.value);
}));
$$('.accent').forEach(b => b.addEventListener('click', () => {
  $$('.accent').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const c = b.dataset.color;
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-soft', hexToRgba(c, 0.18));
  localStorage.setItem('pe_accent', c);
}));
$('#clearProjectsBtn').addEventListener('click', () => {
  if (confirm('Barcha loyihalarni oʻchirilsinmi?')) {
    Store.clear();
    refreshProjects();
    toast('Barcha loyihalar oʻchirildi');
    $('#settingsModal').hidden = true;
  }
});

// Modal yopish
$$('[data-close-modal]').forEach(b => {
  b.addEventListener('click', () => b.closest('.modal').hidden = true);
});

// ===== EKSPORT =====
$('#exportBtn').addEventListener('click', () => {
  if (!State.original) return;
  // Default o'lcham = canvas
  $('#exportW').value = canvas.width;
  $('#exportH').value = canvas.height;
  $('#exportModal').hidden = false;
});
$$('#sizePresets button').forEach(b => {
  b.addEventListener('click', () => {
    $('#exportW').value = b.dataset.w;
    $('#exportH').value = b.dataset.h;
  });
});
$('#doExportBtn').addEventListener('click', async () => {
  const w = parseInt($('#exportW').value) || canvas.width;
  const h = parseInt($('#exportH').value) || canvas.height;
  const q = parseFloat($('input[name="quality"]:checked').value);
  const keepExif = $('#keepExif').checked;

  $('#exportInfo').textContent = 'Tayyorlanmoqda...';
  $('#exportModal').hidden = false;

  // Render final image at requested size
  setTimeout(async () => {
    try {
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const octx = out.getContext('2d');
      octx.drawImage(canvas, 0, 0, w, h);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', q));

      // EXIF
      let finalBlob = blob;
      if (keepExif) {
        const exif = extractExif(blob);
        if (exif) finalBlob = injectExif(blob, exif);
      }

      // Saqlash
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${State.fileName}-${w}x${h}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#exportInfo').textContent = `✓ ${(finalBlob.size/1024).toFixed(0)} KB yuklandi`;
      toast('Rasm saqlandi');
      setTimeout(() => { $('#exportModal').hidden = true; }, 1200);
    } catch (e) {
      console.error(e);
      $('#exportInfo').textContent = 'Xato: ' + e.message;
    }
  }, 50);
});

// EXIF (soddalashtirilgan — original EXIF olish)
function extractExif(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target.result);
      if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return resolve(null);
      let offset = 2;
      while (offset < view.byteLength) {
        if (view.getUint8(offset) !== 0xFF) break;
        const marker = view.getUint8(offset + 1);
        const size = view.getUint16(offset + 2);
        if (marker === 0xE1) {
          // APP1
          const seg = new Uint8Array(e.target.result, offset, size + 2);
          return resolve(seg);
        }
        offset += size + 2;
      }
      resolve(null);
    };
    reader.readAsArrayBuffer(blob);
  });
}
async function injectExif(blob, exifSeg) {
  // Original JPEG ni qayta o'qib, EXIF segmentini qo'shish
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const out = new Uint8Array(buf.byteLength + exifSeg.byteLength);
  out.set(new Uint8Array(buf, 0, 2), 0);
  out.set(exifSeg, 2);
  out.set(new Uint8Array(buf, 2), 2 + exifSeg.byteLength);
  return new Blob([out], { type: 'image/jpeg' });
}

// ===== INIT =====
loadSettings();
buildLUTs();
buildHSL();
refreshProjects();

console.log('Photo Editor tayyor');
