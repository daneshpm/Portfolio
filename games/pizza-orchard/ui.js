'use strict';
// ───────────────────────── Pizza Orchard: UI + world ─────────────────────────
const { CROPS, UPG, MAX_PLOTS } = Farm;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const rnd = (a, b) => a + Math.random() * (b - a);

// ── number formatting ──
const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n < 1000) return n < 10 ? String(Math.round(n * 10) / 10) : String(Math.floor(n));
  let i = Math.min(SUF.length - 1, Math.floor(Math.log10(n) / 3));
  const dec = v => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0));
  let s = dec(n / Math.pow(1000, i));
  if (parseFloat(s) >= 1000 && i < SUF.length - 1) { i++; s = dec(n / Math.pow(1000, i)); }
  return s + SUF[i];
}
const fmtClock = s => { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function fmtDur(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? h + 'h ' + m + 'm' : m + 'm';
}
// deterministic pseudo-random 0..1 per grid cell (so the scenery looks the same every time)
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ── portal / ads adapter ──
// Auto-detects a portal SDK injected by the host page (Poki: window.PokiSDK,
// CrazyGames: window.CrazyGames.SDK). With no SDK (itch.io, local) there are no ads and boosts are free.
// NOTE: SDK call names follow each portal's public docs as I understand them;
// verify in the portal's own preview/inspector tool before submitting.
const Ads = {
  _playing: false,
  get sdk() {
    if (window.PokiSDK) return 'poki';
    if (window.CrazyGames && window.CrazyGames.SDK) return 'crazy';
    return null;
  },
  get hasAds() { return !!this.sdk; },
  init() {
    try {
      if (this.sdk === 'poki') window.PokiSDK.init().then(() => { try { window.PokiSDK.gameLoadingFinished(); } catch (e) {} }).catch(() => {});
      else if (this.sdk === 'crazy') { const r = window.CrazyGames.SDK.init(); if (r && r.catch) r.catch(() => {}); }
    } catch (e) {}
  },
  gameplayStart() {
    if (this._playing) return;
    this._playing = true;
    try {
      if (this.sdk === 'poki') window.PokiSDK.gameplayStart();
      else if (this.sdk === 'crazy') window.CrazyGames.SDK.game.gameplayStart();
    } catch (e) {}
  },
  gameplayStop() {
    if (!this._playing) return;
    this._playing = false;
    try {
      if (this.sdk === 'poki') window.PokiSDK.gameplayStop();
      else if (this.sdk === 'crazy') window.CrazyGames.SDK.game.gameplayStop();
    } catch (e) {}
  },
  // Rewarded ad. cb(true) ONLY if the player actually finished watching.
  rewarded(cb) {
    const s = this.sdk;
    if (!s) { cb(true); return; }   // no ads here -> free reward
    const was = muted;
    let fired = false;
    const fin = ok => { if (fired) return; fired = true; muted = was; cb(!!ok); };
    muted = true;
    try {
      if (s === 'poki') window.PokiSDK.rewardedBreak().then(fin).catch(() => fin(false));
      else window.CrazyGames.SDK.ad.requestAd('rewarded', { adStarted() {}, adFinished: () => fin(true), adError: () => fin(false) });
    } catch (e) { fin(false); }
  }
};

// ── audio ──
let muted = false, AC = null, lastBeep = 0;
try { muted = localStorage.getItem('po_muted') === '1'; } catch (e) {}
function audio() {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {}
  return AC;
}
function beep(f, dur = 0.08, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted || !audio()) return;
  try {
    const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
function popSound(tier, quiet) {
  const now = performance.now();
  if (now - lastBeep < (quiet ? 140 : 40)) return;
  lastBeep = now;
  beep(380 + tier * 55, 0.08, 'triangle', quiet ? 0.02 : 0.05, 160);
}
// gentle background loop (C - Am - F - G, pentatonic melody)
const Music = {
  on: false, step: 0, next: 0, timer: null, roots: [0, -3, -7, -5], pent: [0, 2, 4, 7, 9],
  start() {
    if (this.on || !audio()) return;
    this.on = true; this.next = AC.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 120);
  },
  tick() {
    if (!this.on || !AC) return;
    if (muted) { this.next = AC.currentTime + 0.1; return; }
    while (this.next < AC.currentTime + 0.35) { this.note(this.step, this.next); this.next += 0.26; this.step++; }
  },
  tone(f, t, dur, type, vol) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  note(s, t) {
    const bar = Math.floor(s / 16) % 4, i = s % 16, root = 130.81 * Math.pow(2, this.roots[bar] / 12);
    if (i % 8 === 0) this.tone(root, t, 1.6, 'triangle', 0.05);
    if (i % 2 === 0 && ((s * 7 + bar * 3) % 5) !== 1) {
      const n = this.pent[(s * 3 + bar) % 5];
      this.tone(root * 4 * Math.pow(2, n / 12), t, 0.5, 'sine', 0.022);
    }
  }
};
function setMuted(m) {
  muted = m; $('#mute').textContent = m ? '🔇' : '🔊';
  try { localStorage.setItem('po_muted', m ? '1' : '0'); } catch (e) {}
}

// ── save / load ──
const KEY = 'pizza_orchard_save_v1';
function load() {
  try { const raw = JSON.parse(localStorage.getItem(KEY)); return raw ? Farm.sanitize(raw) : Farm.newState(); }
  catch (e) { return Farm.newState(); }
}
function save() { S.lastSeen = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

let S = load();
let tab = 'up', amt = '1';
let clock = 0;   // animation time

// ── toasts & modals ──
function toast(msg) {
  const d = document.createElement('div'); d.className = 't'; d.textContent = msg;
  $('#toast').appendChild(d); setTimeout(() => d.remove(), 2800);
}
function modal(html, handlers) {
  $('#modalbox').innerHTML = html;
  $('#modal').classList.remove('hidden');
  for (const sel in handlers) { const el = $('#modalbox ' + sel); if (el) el.addEventListener('click', () => { closeModal(); handlers[sel](); }); }
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalbox').innerHTML = ''; }
const modalOpen = () => !$('#modal').classList.contains('hidden');

// ───────────────────────── the world (canvas) ─────────────────────────
const WW = 720, WH = 520, PS = 92, GAP = 20, COLS = 4;
const X0 = (WW - (COLS * PS + (COLS - 1) * GAP)) / 2, Y0 = 70;
const plotPos = i => ({ x: X0 + (i % COLS) * (PS + GAP) + PS / 2, y: Y0 + Math.floor(i / COLS) * (PS + GAP) + PS / 2 });
const FARMER_SPEED = 200, REACH = 52;
const ANIMALS = ['🐔', '🐔', '🐄', '🐖', '🐑', '🦆', '🐴', '👽'];   // one more joins per crop you unlock

const cv = $('#world'), cx = cv.getContext('2d');
let bg = null;

const Wd = {
  farmer: { x: 360, y: 300, tx: null, ty: null, face: 1, mv: false, bob: 0, en: 1, sprinting: false, walked: 0 },
  animals: [], eggs: [], golden: null, texts: [], sparks: [], hop: [], lastFx: [], prevT: [], dust: [], crows: [], crowN: 0, dig: null, digN: 0, digFx: 0, work: -1, dropT: 0, dustT: 0, drag: false, ghostHit: false
};
const keys = {};

// emoji sprite cache (fast drawImage instead of fillText)
const spr = {};
function sprite(e, s) {
  const k = e + '|' + s;
  if (spr[k]) return spr[k];
  const n = Math.ceil(s * 2 * 1.4), c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d');
  x.font = (s * 2) + 'px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(e === 'CROW' ? '🐦' : e, n / 2, n / 2 + s * 0.1);
  if (e === 'CROW') { x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(30,26,44,0.9)'; x.fillRect(0, 0, n, n); }   // dark bird
  return (spr[k] = c);
}
function drawSpr(e, s, x, y, sc = 1, flip = 1, rot = 0, sq = 1) {
  const c = sprite(e, s), n = (c.width / 2) * sc;
  cx.save(); cx.translate(x, y);
  if (rot) cx.rotate(rot);
  if (flip < 0) cx.scale(-1, 1);
  if (sq !== 1) cx.scale(1, sq);
  cx.drawImage(c, -n / 2, -n / 2, n, n);
  cx.restore();
}
function rrPath(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function shadow(x, y, rx, ry, a = 0.25) { cx.fillStyle = 'rgba(0,0,0,' + a + ')'; cx.beginPath(); cx.ellipse(x, y, rx, ry, 0, 0, 6.283); cx.fill(); }
function outlined(txt, x, y, size, fill) {
  cx.font = 'bold ' + size + 'px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.lineWidth = Math.max(3, size / 5); cx.lineJoin = 'round'; cx.strokeStyle = 'rgba(0,0,0,0.7)';
  cx.strokeText(txt, x, y); cx.fillStyle = fill || '#fff'; cx.fillText(txt, x, y);
}

function sizeCanvas() {
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(240, Math.round((r.width || 600) * dpr));
  if (cv.width === w && bg) return;
  cv.width = w; cv.height = Math.round(w * WH / WW);
  buildBg();
}
// static scenery (grass, flowers, house, trees) drawn once per resize
function buildBg() {
  bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
  const g = bg.getContext('2d'), k = cv.width / WW;
  g.setTransform(k, 0, 0, k, 0, 0);
  const T = 48;
  for (let ix = 0; ix < WW / T + 1; ix++) for (let iy = 0; iy < WH / T + 1; iy++) {
    g.fillStyle = ((ix + iy) & 1) ? '#7bcf55' : '#72c74d'; g.fillRect(ix * T, iy * T, T + 1, T + 1);
  }
  const fx = X0 - 18, fy = Y0 - 18, fw = COLS * PS + (COLS - 1) * GAP + 36, fh = 4 * PS + 3 * GAP + 36;
  g.fillStyle = 'rgba(70,120,40,0.28)'; rrPath(g, fx, fy, fw, fh, 24); g.fill();
  g.strokeStyle = 'rgba(70,120,40,0.45)'; g.lineWidth = 3; g.setLineDash([10, 8]); rrPath(g, fx, fy, fw, fh, 24); g.stroke(); g.setLineDash([]);
  const put = (e, s, x, y) => { const c = sprite(e, s), n = c.width / 2; g.drawImage(c, x - n / 2, y - n / 2, n, n); };
  const flowers = ['🌼', '🌸', '🌱', '🍄', '🪨', '🌿'];
  for (let ix = 0; ix < 13; ix++) for (let iy = 0; iy < 10; iy++) {
    if (hash2(ix, iy) > 0.4) continue;
    const x = ix * 56 + hash2(ix + 9, iy) * 40 + 8, y = iy * 56 + hash2(ix, iy + 9) * 40 + 8;
    if (x > fx - 14 && x < fx + fw + 14 && y > fy - 14 && y < fy + fh + 14) continue;
    put(flowers[Math.min(5, Math.floor(hash2(ix + 3, iy + 3) * 6))], 14 + Math.floor(hash2(ix + 5, iy + 1) * 8), x, y);
  }
  g.globalAlpha = 0.3; g.fillStyle = '#000';
  [[66, 112], [40, 322], [32, 470], [684, 100], [690, 276], [672, 454]].forEach(([x, y]) => { g.beginPath(); g.ellipse(x, y + 22, 26, 8, 0, 0, 6.283); g.fill(); });
  g.globalAlpha = 1;
  put('🏠', 74, 66, 76); put('🌳', 54, 40, 322); put('🌳', 50, 32, 470); put('🌳', 56, 684, 100); put('🌳', 52, 690, 276); put('🌳', 54, 672, 454);
}
window.addEventListener('resize', sizeCanvas);

function resetWorld() {
  Wd.animals = []; Wd.eggs = []; Wd.golden = null; Wd.texts = []; Wd.sparks = [];
  Wd.hop = []; Wd.lastFx = []; Wd.prevT = []; Wd.dust = []; Wd.crows = []; Wd.dig = null; Wd.work = -1; Wd.dropT = 0; Wd.dustT = 0;
  Wd.farmer.x = 360; Wd.farmer.y = 300; Wd.farmer.tx = null; Wd.farmer.ty = null;
}

function addText(x, y, txt, size, fill) { if (Wd.texts.length < 40) Wd.texts.push({ x, y, txt, size: size || 20, fill, t: 0.95 }); }
function addSparks(x, y, emoji, n) {
  for (let k = 0; k < n && Wd.sparks.length < 90; k++) {
    const a = rnd(0, 6.283), sp = rnd(50, 130);
    Wd.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, e: k % 2 ? '✨' : emoji, t: 0.6 });
  }
}

// ── input: WASD / arrows move the farmer; click/tap/drag sends him there ──
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k) && !modalOpen()) e.preventDefault();
  keys[k] = true; firstTouch();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function worldPoint(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * WW, y: (e.clientY - r.top) / r.height * WH };
}
function pointerTo(e, first) {
  const p = worldPoint(e);
  if (first) {
    // tapping the golden star grabs it right away (checked first so it wins over whatever is underneath)
    if (Wd.golden && Math.hypot(p.x - Wd.golden.x, p.y - Wd.golden.y) < 44) { claimGolden(); return; }
    // tapping the dashed "new plot" tile buys it
    if (S.plots.length < MAX_PLOTS) {
      const g = plotPos(S.plots.length);
      if (Math.abs(p.x - g.x) < PS / 2 && Math.abs(p.y - g.y) < PS / 2 && S.coins >= Farm.plotCost(S)) { doAct('plot'); return; }
    }
  }
  Wd.farmer.tx = Math.max(24, Math.min(WW - 24, p.x)); Wd.farmer.ty = Math.max(50, Math.min(WH - 24, p.y));
}
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); firstTouch(); Wd.drag = true;
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  pointerTo(e, true);
});
cv.addEventListener('pointermove', e => { if (Wd.drag) pointerTo(e, false); });
const endDrag = () => { Wd.drag = false; };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

// ── golden star ──
function spawnGolden() {
  Wd.golden = { x: rnd(60, WW - 60), y: rnd(70, WH - 60), life: 14 };
  toast('⭐ A golden star appeared! Grab it!');
}
function claimGolden() {
  if (!Wd.golden) return;
  const g = Farm.claimGolden(S);
  addText(Wd.golden.x, Wd.golden.y - 20, '⭐ +' + fmt(g), 26, '#ffe14a');
  addSparks(Wd.golden.x, Wd.golden.y, '⭐', 10);
  toast('⭐ Golden bonus! +' + fmt(g) + ' 🪙');
  [784, 988, 1175, 1568].forEach((f, j) => setTimeout(() => beep(f, 0.15, 'triangle', 0.05), j * 70));
  Wd.golden = null;
}

// ── buried treasure: a glimmering mound appears on a patch of grass; stand on it to dig ──
function spawnDig() {
  for (let k = 0; k < 30; k++) {
    const x = rnd(40, WW - 40), y = rnd(70, WH - 40);
    let bad = false;
    for (let i = 0; i <= S.plots.length && i < MAX_PLOTS; i++) {
      const q = plotPos(i);
      if (Math.abs(x - q.x) < PS / 2 + 16 && Math.abs(y - q.y) < PS / 2 + 16) { bad = true; break; }
    }
    if (!bad) { Wd.dig = { x, y, prog: 0, life: 45 }; return true; }
  }
  return false;
}
function updateDig(dt, frozen) {
  const d = Wd.dig;
  if (!d || frozen) return;
  const f = Wd.farmer;
  d.life -= dt;
  if (Math.hypot(f.x - d.x, f.y - d.y) < 34) {
    d.prog += dt / 1.2;
    Wd.digFx -= dt;
    if (Wd.digFx <= 0) { Wd.digFx = 0.18; addSparks(d.x, d.y, '🟫', 2); beep(160 + d.prog * 200, 0.05, 'square', 0.025); }
  } else d.prog = Math.max(0, d.prog - dt * 0.8);
  if (d.prog >= 1) {
    const r = Farm.digReward(S);
    Wd.dig = null; S.digT = 35 + Math.random() * 35;
    if (r.type === 'gold') { addText(d.x, d.y - 20, '🪙 +' + fmt(r.amt), 28, '#ffe14a'); toast('🪙 Found buried gold! +' + fmt(r.amt)); }
    else if (r.type === 'jackpot') { addText(d.x, d.y - 20, '💎 JACKPOT +' + fmt(r.amt), 30, '#8fe3ff'); toast('💎 JACKPOT! Treasure chest: +' + fmt(r.amt) + ' 🪙'); addSparks(d.x, d.y, '💎', 12); }
    else if (r.type === 'boost') { addText(d.x, d.y - 20, '⚡ 2× income 30s', 24, '#fff3a0'); toast('⚡ You dug up a lightning bolt! 2× income for 30s'); }
    else { const q = plotPos(r.plot); addText(q.x, q.y - 34, '🌟 GOLDEN CROP ×' + r.amt, 22, '#ffe14a'); toast('🌟 A plot turned golden! Its next harvest pays ×' + r.amt); addSparks(q.x, q.y, '🌟', 8); }
    addSparks(d.x, d.y, '✨', 8);
    [523, 659, 784, 988, 1319].forEach((fr, j) => setTimeout(() => beep(fr, 0.14, 'triangle', 0.05), j * 70));
  } else if (d.life <= 0) { Wd.dig = null; S.digT = 30 + Math.random() * 30; }
}

// ── crows: fly in, sit on a plot (freezing it), leave after a while or when the farmer shoos them ──
function spawnCrow() {
  const f = Wd.farmer, taken = Wd.crows.map(c => c.i), cand = [];
  for (let i = 0; i < S.plots.length; i++) {
    const p = S.plots[i], q = plotPos(i);
    if (p.crop !== null && !p.crow && !taken.includes(i) && Math.hypot(q.x - f.x, q.y - f.y) > 100) cand.push(i);
  }
  if (!cand.length) return false;
  Wd.crows.push({ x: Math.random() < 0.5 ? -30 : WW + 30, y: rnd(-20, 120), i: cand[Math.floor(Math.random() * cand.length)], st: 'fly', sit: 18, face: 1, vx: 1, ph: rnd(0, 6.28) });
  return true;
}
function crowLeaves(c, awayFrom) { c.st = 'leave'; c.vx = (awayFrom !== undefined ? c.x >= awayFrom : c.x > WW / 2) ? 1 : -1; }
function updateCrows(dt, frozen) {
  if (frozen) return;
  const f = Wd.farmer;
  for (const c of Wd.crows) {
    const p = S.plots[c.i], q = plotPos(c.i);
    if (c.st === 'fly') {
      if (!p || p.crop === null) { crowLeaves(c); }
      else {
        const tx = q.x, ty = q.y - 6, vx = tx - c.x, vy = ty - c.y, d = Math.hypot(vx, vy);
        if (d < 8) {
          if (Farm.crowLand(S, c.i)) {
            c.st = 'sit'; c.x = tx; c.y = ty;
            beep(240, 0.08, 'sawtooth', 0.03, -60); setTimeout(() => beep(210, 0.1, 'sawtooth', 0.03, -60), 110);
            if (Wd.crowN++ < 3) toast('🐦 A crow landed on a plot! Run over and shoo it away.');
          } else crowLeaves(c);
        } else { c.x += vx / d * 200 * dt; c.y += vy / d * 200 * dt; c.face = vx > 0 ? 1 : -1; }
      }
    } else if (c.st === 'sit') {
      c.sit -= dt;
      if (!p || !p.crow) crowLeaves(c);
      else if (Math.hypot(f.x - c.x, f.y - c.y) < 58) {
        const r = Farm.shoo(S, c.i);
        addText(c.x, c.y - 26, '💨 +' + fmt(r), 22, '#fff'); addSparks(c.x, c.y, '💨', 4); beep(520, 0.1, 'square', 0.04, 200);
        crowLeaves(c, f.x);
      } else if (c.sit <= 0) { Farm.crowLeave(S, c.i); crowLeaves(c); }
    }
    if (c.st === 'leave') { c.x += c.vx * 230 * dt; c.y -= 150 * dt; c.face = c.vx > 0 ? 1 : -1; }
  }
  Wd.crows = Wd.crows.filter(c => !(c.st === 'leave' && (c.x < -50 || c.x > WW + 50 || c.y < -50)));
}

// ── animals + eggs ──
const eggValue = () => Math.max(Farm.autoRate(S) * 12, Farm.valueOf(S, S.sel) * 4, 10);
function syncAnimals() {
  const want = Math.min(ANIMALS.length, 2 + S.unlocked);
  while (Wd.animals.length < want) {
    const i = Wd.animals.length;
    Wd.animals.push({ e: ANIMALS[i], x: rnd(40, WW - 40), y: rnd(60, WH - 40), tx: null, ty: null, wait: rnd(0, 2), face: 1, eggT: rnd(15, 35), flee: 0, ph: rnd(0, 6.28) });
  }
  while (Wd.animals.length > want) Wd.animals.pop();
}

function updateWorld(dt) {
  syncAnimals();
  const f = Wd.farmer;
  const frozen = modalOpen();
  // movement
  let dx = 0, dy = 0;
  if (!frozen) {
    if (keys['a'] || keys['arrowleft']) dx--;
    if (keys['d'] || keys['arrowright']) dx++;
    if (keys['w'] || keys['arrowup']) dy--;
    if (keys['s'] || keys['arrowdown']) dy++;
    if (dx || dy) { f.tx = null; const m = Math.hypot(dx, dy); dx /= m; dy /= m; }
    else if (f.tx !== null) {
      const vx = f.tx - f.x, vy = f.ty - f.y, d = Math.hypot(vx, vy);
      if (d < 6) { f.tx = null; } else { dx = vx / d; dy = vy / d; }
    }
  }
  // sprint: hold Space / Shift to run ~1.8x faster for a moment, then it recharges
  const wantSprint = (keys[' '] || keys['shift']) && (dx || dy) && !frozen;
  if (wantSprint && (f.sprinting ? f.en > 0 : f.en > 0.25)) { f.sprinting = true; f.en = Math.max(0, f.en - dt / 1.6); }
  else { f.sprinting = false; f.en = Math.min(1, f.en + dt / 3.5); }
  if (f.sprinting && Wd.dustT > 0.04) Wd.dustT = 0.04;
  const spd = FARMER_SPEED * (1 + 0.02 * Math.min(10, S.forks)) * (f.sprinting ? 1.8 : 1);
  f.x =Math.max(22, Math.min(WW - 22, f.x + dx * spd * dt));
  f.y = Math.max(46, Math.min(WH - 22, f.y + dy * spd * dt));
  f.mv = dx !== 0 || dy !== 0;
  if (f.mv) f.walked += spd * dt;
  if (dx) f.face = dx > 0 ? 1 : -1;
  f.bob += dt * (f.mv ? 14 : 2.5);

  // dust puffs behind a walking farmer
  Wd.dustT -= dt;
  if (f.mv && !frozen && Wd.dustT <= 0) { Wd.dustT = 0.09; Wd.dust.push({ x: f.x - (dx || 0) * 8 + rnd(-4, 4), y: f.y + 17, r: rnd(3, 5), t: 0.45 }); }
  for (const d of Wd.dust) { d.t -= dt; d.y -= 10 * dt; d.r += 14 * dt; }
  Wd.dust = Wd.dust.filter(d => d.t > 0);

  // interact with the nearest plot in reach
  Wd.work = -1;
  if (!frozen) {
    let best = -1, bd = REACH;
    for (let i = 0; i < S.plots.length; i++) {
      const p = plotPos(i), d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const pl = S.plots[best], cidx = pl.crop, p = plotPos(best);
      const r = Farm.farmerAct(S, best, dt);
      Wd.work = best;
      Wd.dropT -= dt;
      if (r.type === 'water' && pl.crop !== null && Wd.dropT <= 0) { Wd.dropT = 0.28; addSparks(p.x + rnd(-22, 22), p.y - 20, '💧', 1); }
      if (r.type === 'harvest') {
        addText(p.x, p.y - 30, '+' + fmt(r.amt), 22 + Math.min(10, r.combo));
        addSparks(p.x, p.y, CROPS[cidx].e, 5);
        popSound(cidx + Math.min(8, r.combo));
        Wd.hop[best] = 0.3;
      } else if (r.type === 'plant') beep(300, 0.05, 'sine', 0.03, 120);
    }
  }

  // eggs: collect by walking over them
  for (const eg of Wd.eggs) {
    eg.life -= dt;
    if (!frozen && Math.hypot(f.x - eg.x, f.y - eg.y) < 30) {
      const v = eggValue(); Farm.earn(S, v); eg.life = 0;
      addText(eg.x, eg.y - 16, '🥚 +' + fmt(v), 20, '#fff3a0'); addSparks(eg.x, eg.y, '🥚', 5);
      beep(880, 0.1, 'triangle', 0.05, 300);
    }
  }
  Wd.eggs = Wd.eggs.filter(e => e.life > 0);

  // golden star: float around, pick up by walking into it
  if (Wd.golden) {
    Wd.golden.life -= dt;
    if (!frozen && Math.hypot(f.x - Wd.golden.x, f.y - Wd.golden.y) < 36) claimGolden();
    else if (Wd.golden.life <= 0) { Wd.golden = null; S.goldenT = 40 + Math.random() * 40; }
  }

  // animals wander, flee from the farmer, and lay eggs
  for (const a of Wd.animals) {
    const fd = Math.hypot(a.x - f.x, a.y - f.y);
    let vx = 0, vy = 0;
    if (fd < 90) { a.flee = 0.6; }
    if (a.flee > 0) {
      a.flee -= dt;
      const d = fd || 1; vx = (a.x - f.x) / d * 130; vy = (a.y - f.y) / d * 130;
    } else if (a.tx !== null) {
      const ex = a.tx - a.x, ey = a.ty - a.y, d = Math.hypot(ex, ey);
      if (d < 4) { a.tx = null; a.wait = rnd(1.5, 4); } else { vx = ex / d * 30; vy = ey / d * 30; }
    } else {
      a.wait -= dt;
      if (a.wait <= 0) { a.tx = rnd(30, WW - 30); a.ty = rnd(60, WH - 30); }
    }
    a.x = Math.max(20, Math.min(WW - 20, a.x + vx * dt)); a.y = Math.max(50, Math.min(WH - 20, a.y + vy * dt));
    if (vx) a.face = vx > 0 ? 1 : -1;
    a.eggT -= dt;
    if (a.eggT <= 0) {
      a.eggT = rnd(25, 45);
      if (Wd.eggs.length < 8) Wd.eggs.push({ x: a.x, y: a.y + 10, life: 30 });
    }
  }

  updateCrows(dt, frozen);
  updateDig(dt, frozen);

  // effects
  for (const t of Wd.texts) { t.y -= 38 * dt; t.t -= dt; }
  Wd.texts = Wd.texts.filter(t => t.t > 0);
  for (const s of Wd.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 160 * dt; s.t -= dt; }
  Wd.sparks = Wd.sparks.filter(s => s.t > 0);
  for (let i = 0; i < Wd.hop.length; i++) if (Wd.hop[i] > 0) Wd.hop[i] -= dt;
}

// robots hop when their plot's grow timer wraps (an automated harvest)
function watchAutoHarvests(dt) {
  const hands = Farm.handsActive(S), now = performance.now();
  for (let i = 0; i < S.plots.length; i++) {
    const p = S.plots[i];
    const prev = Wd.prevT[i];
    if (i < hands && p.crop !== null && prev !== undefined && p.t < prev - 1e-6 && now - (Wd.lastFx[i] || 0) > 450) {
      Wd.lastFx[i] = now; Wd.hop[i] = 0.3;
      const pos = plotPos(i);
      addText(pos.x, pos.y - 30, '+' + fmt(Farm.valueOf(S, S.sel)), 18);
      addSparks(pos.x, pos.y, CROPS[S.sel].e, 3); popSound(S.sel, true);
    }
    Wd.prevT[i] = p.t;
  }
}

function drawPlot(i) {
  const p = S.plots[i], pos = plotPos(i), x = pos.x, y = pos.y, h = PS / 2;
  const has = p.crop !== null, ready = has && p.ready, auto = i < Farm.handsActive(S);
  cx.fillStyle = '#5a3820'; rrPath(cx, x - h, y - h + 5, PS, PS, 15); cx.fill();
  const gr = cx.createRadialGradient(x, y - 18, 8, x, y, PS * 0.75);
  gr.addColorStop(0, '#b27a46'); gr.addColorStop(1, '#7a4b29');
  cx.fillStyle = gr; rrPath(cx, x - h, y - h, PS, PS, 15); cx.fill();
  if (Wd.work === i) {
    cx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.25 * Math.sin(clock * 8)).toFixed(2) + ')'; cx.lineWidth = 3;
    rrPath(cx, x - h + 3, y - h + 3, PS - 6, PS - 6, 13); cx.stroke();
  }
  if (p.gold) {
    cx.fillStyle = 'rgba(255,215,0,' + (0.22 + 0.1 * Math.sin(clock * 5)).toFixed(2) + ')'; rrPath(cx, x - h, y - h, PS, PS, 15); cx.fill();
    cx.strokeStyle = '#ffd23f'; cx.lineWidth = 4; rrPath(cx, x - h + 2, y - h + 2, PS - 4, PS - 4, 13); cx.stroke();
    drawSpr('✨', 18, x - h + 14 + Math.sin(clock * 3) * 3, y - h + 14, 1 + 0.2 * Math.sin(clock * 6));
  }
  if (p.crow) { cx.fillStyle = 'rgba(25,12,35,0.3)'; rrPath(cx, x - h, y - h, PS, PS, 15); cx.fill(); }
  if (ready) {
    cx.strokeStyle = 'rgba(255,225,74,' + (0.65 + 0.35 * Math.sin(clock * 7)).toFixed(2) + ')'; cx.lineWidth = 5;
    rrPath(cx, x - h - 1, y - h - 1, PS + 2, PS + 2, 16); cx.stroke();
  }
  if (!has) { cx.fillStyle = 'rgba(255,255,255,0.22)'; cx.font = 'bold 34px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('+', x, y); }
  else {
    const prog = Math.min(1, p.t / CROPS[p.crop].grow);
    const sc = ready ? 1.05 + 0.07 * Math.sin(clock * 9) : 0.35 + 0.65 * prog;
    cx.globalAlpha = ready ? 1 : 0.55 + 0.45 * prog;
    drawSpr(CROPS[p.crop].e, 46, x, y - 6 - (ready ? Math.abs(Math.sin(clock * 6)) * 4 : 0), sc);
    cx.globalAlpha = 1;
    cx.fillStyle = 'rgba(0,0,0,0.4)'; rrPath(cx, x - h + 10, y + h - 15, PS - 20, 7, 3.5); cx.fill();
    if (prog > 0.02) { cx.fillStyle = '#86e048'; rrPath(cx, x - h + 10, y + h - 15, Math.max(7, (PS - 20) * prog), 7, 3.5); cx.fill(); }
  }
  if (auto) {
    const hop = Wd.hop[i] > 0 ? Math.sin((0.3 - Wd.hop[i]) / 0.3 * Math.PI) * 9 : 0;
    drawSpr('🤖', 18, x + h - 14, y - h + 15 - hop);
  }
}

function drawWorld() {
  const k = cv.width / WW;
  cx.setTransform(k, 0, 0, k, 0, 0);
  if (bg) cx.drawImage(bg, 0, 0, WW, WH); else { cx.fillStyle = '#72c74d'; cx.fillRect(0, 0, WW, WH); }

  // the dashed "buy a new plot" tile
  if (S.plots.length < MAX_PLOTS) {
    const g = plotPos(S.plots.length), c = Farm.plotCost(S), afford = S.coins >= c, h = PS / 2;
    cx.fillStyle = afford ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
    rrPath(cx, g.x - h, g.y - h, PS, PS, 15); cx.fill();
    cx.strokeStyle = afford ? '#ff7a2f' : 'rgba(60,40,20,0.4)'; cx.lineWidth = 3.5; cx.setLineDash([9, 7]);
    rrPath(cx, g.x - h + 2, g.y - h + 2, PS - 4, PS - 4, 14); cx.stroke(); cx.setLineDash([]);
    outlined('+', g.x, g.y - 8, 30, afford ? '#fff' : 'rgba(255,255,255,0.8)');
    outlined(fmt(c) + ' 🪙', g.x, g.y + 22, 13, '#fff');
  }
  for (let i = 0; i < S.plots.length; i++) drawPlot(i);

  // things that stand in the field, drawn back-to-front
  const f = Wd.farmer, items = [];
  for (const a of Wd.animals) items.push({ y: a.y, d: () => {
    const hop = Math.abs(Math.sin(clock * (a.flee > 0 ? 14 : 5) + a.ph)) * (a.flee > 0 ? 7 : (a.tx !== null ? 3 : 0));
    shadow(a.x, a.y + 12, 13, 4.5); drawSpr(a.e, 30, a.x, a.y - hop, 1, a.face);
  } });
  for (const eg of Wd.eggs) items.push({ y: eg.y, d: () => {
    const fade = eg.life < 6 ? (Math.sin(clock * 16) > 0 ? 1 : 0.3) : 1;
    cx.globalAlpha = fade;
    cx.fillStyle = 'rgba(255,225,74,' + (0.25 + 0.15 * Math.sin(clock * 5)).toFixed(2) + ')'; cx.beginPath(); cx.arc(eg.x, eg.y, 15, 0, 6.283); cx.fill();
    shadow(eg.x, eg.y + 9, 9, 3); drawSpr('🥚', 22, eg.x, eg.y - Math.abs(Math.sin(clock * 4 + eg.x)) * 3);
    cx.globalAlpha = 1;
  } });
  if (Wd.dig) { const d = Wd.dig; items.push({ y: d.y, d: () => {
    const blink = d.life < 6 && Math.sin(clock * 16) < 0 ? 0.35 : 1;
    cx.globalAlpha = blink;
    cx.fillStyle = 'rgba(255,225,74,' + (0.2 + 0.12 * Math.sin(clock * 5)).toFixed(2) + ')'; cx.beginPath(); cx.arc(d.x, d.y, 26, 0, 6.283); cx.fill();
    cx.fillStyle = '#6b4423'; cx.beginPath(); cx.ellipse(d.x, d.y + 5, 17, 8, 0, 0, 6.283); cx.fill();
    cx.fillStyle = '#8a5a30'; cx.beginPath(); cx.ellipse(d.x, d.y + 2, 14, 6.5, 0, 0, 6.283); cx.fill();
    drawSpr('✨', 22, d.x + Math.sin(clock * 3) * 6, d.y - 10 - Math.abs(Math.sin(clock * 4)) * 6, 1 + 0.15 * Math.sin(clock * 7));
    if (d.prog > 0.02) {
      cx.strokeStyle = '#ffe14a'; cx.lineWidth = 5; cx.beginPath(); cx.arc(d.x, d.y - 4, 22, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.min(1, d.prog)); cx.stroke();
    }
    cx.globalAlpha = 1;
  } }); }
  for (const c of Wd.crows) items.push({ y: c.st === 'sit' ? c.y + 40 : c.y + 300, d: () => {
    if (c.st === 'sit') {
      shadow(c.x, c.y + 14, 13, 4.5, 0.3);
      drawSpr('CROW', 38, c.x, c.y - Math.abs(Math.sin(clock * 6 + c.ph)) * 2, 1, -c.face);
      outlined('!', c.x + 16, c.y - 26 - Math.abs(Math.sin(clock * 7)) * 4, 24, '#ff5a4a');
      const fr = Math.max(0, c.sit / 18);
      cx.fillStyle = 'rgba(0,0,0,0.4)'; rrPath(cx, c.x - 16, c.y + 20, 32, 5, 2.5); cx.fill();
      cx.fillStyle = '#ff8a6a'; rrPath(cx, c.x - 16, c.y + 20, Math.max(4, 32 * fr), 5, 2.5); cx.fill();
    } else {
      shadow(c.x, c.y + 38, 11, 4, 0.18);
      drawSpr('CROW', 38, c.x, c.y, 1, -c.face, Math.sin(clock * 20) * 0.12, 0.85 + 0.2 * Math.abs(Math.sin(clock * 22)));
    }
  } });
  items.push({ y: f.y, d: () => {
    shadow(f.x, f.y + 18, 16, 5.5, 0.3);
    const sq = f.mv ? 1 + 0.06 * Math.sin(f.bob) : 1 + 0.025 * Math.sin(f.bob);
    drawSpr('🧑‍🌾', 44, f.x, f.y - (f.mv ? Math.abs(Math.sin(f.bob)) * 4 : 0), 1, f.face, f.mv ? Math.sin(f.bob) * 0.1 : 0, sq);
  } });
  items.sort((a, b) => a.y - b.y).forEach(it => it.d());

  // dust
  for (const d of Wd.dust) { cx.fillStyle = 'rgba(255,255,255,' + (d.t * 0.7).toFixed(2) + ')'; cx.beginPath(); cx.arc(d.x, d.y, d.r, 0, 6.283); cx.fill(); }
  // golden star
  if (Wd.golden) {
    const g = Wd.golden, bob = Math.sin(clock * 3) * 8;
    cx.fillStyle = 'rgba(255,225,74,' + (0.28 + 0.14 * Math.sin(clock * 6)).toFixed(2) + ')'; cx.beginPath(); cx.arc(g.x, g.y + bob, 34, 0, 6.283); cx.fill();
    drawSpr('⭐', 50, g.x, g.y + bob, 1 + 0.1 * Math.sin(clock * 6), 1, Math.sin(clock * 2) * 0.2);
  }
  // destination marker
  if (f.tx !== null) {
    cx.strokeStyle = 'rgba(255,255,255,0.75)'; cx.lineWidth = 3; cx.beginPath(); cx.arc(f.tx, f.ty, 9 + Math.sin(clock * 8) * 2, 0, 6.283); cx.stroke();
  }
  // sparks + floating numbers
  for (const s of Wd.sparks) { cx.globalAlpha = Math.min(1, s.t / 0.3); drawSpr(s.e, 16, s.x, s.y, s.t / 0.6 + 0.3); }
  cx.globalAlpha = 1;
  for (const t of Wd.texts) { cx.globalAlpha = Math.min(1, t.t * 3); outlined(t.txt, t.x, t.y, t.size, t.fill); }
  cx.globalAlpha = 1;
  // sprint meter (only shown when not full)
  if (f.en < 0.99) {
    cx.fillStyle = 'rgba(0,0,0,0.4)'; rrPath(cx, f.x - 18, f.y + 28, 36, 5, 2.5); cx.fill();
    cx.fillStyle = f.sprinting ? '#7fe0ff' : '#cfe9f5'; rrPath(cx, f.x - 18, f.y + 28, Math.max(3, 36 * f.en), 5, 2.5); cx.fill();
  }
  // movement tip until the player has actually walked around
  if (f.walked < 160) {
    const a = 0.75 + 0.25 * Math.sin(clock * 4);
    cx.globalAlpha = a; outlined('Move with WASD / arrow keys  ·  Space = sprint', WW / 2, WH - 22, 17, '#fff'); cx.globalAlpha = 1;
  }
  // combo badge
  if (S.combo >= 2) {
    const pulse = 1 + 0.06 * Math.sin(clock * 14), a = Math.min(1, S.comboT / 0.6);
    cx.globalAlpha = a;
    outlined('COMBO ×' + S.combo, WW / 2, 30, 28 * pulse, '#ffe14a');
    outlined('+' + Math.round((Farm.comboMul(S) - 1) * 100) + '% harvest bonus', WW / 2, 56, 15, '#fff');
    const bw = 140, fr = Math.max(0, Math.min(1, S.comboT / 2.2));
    cx.fillStyle = 'rgba(0,0,0,0.4)'; rrPath(cx, WW / 2 - bw / 2, 68, bw, 6, 3); cx.fill();
    cx.fillStyle = fr < 0.3 ? '#ff6a4a' : '#ffe14a'; rrPath(cx, WW / 2 - bw / 2, 68, Math.max(6, bw * fr), 6, 3); cx.fill();
    cx.globalAlpha = 1;
  }
}

// ───────────────────────── panels (DOM) ─────────────────────────
const panel = $('#panel');
let lastSig = '';

function upgradeItem(k) {
  const U = UPG[k], n = amt === 'max' ? Infinity : +amt, q = Farm.quoteUp(S, k, n);
  const lvl = S.up[k], max = Farm.maxLevel(S, k);
  let btn;
  if (q.maxed && k === 'hands' && S.plots.length < MAX_PLOTS && lvl >= S.plots.length) btn = '<button class="buy" disabled>Need plots</button>';
  else if (q.maxed) btn = '<button class="buy" disabled>MAX</button>';
  else btn = `<button class="buy" data-act="up" data-k="${k}" ${q.afford ? '' : 'disabled'}>${q.count > 1 ? 'Buy ' + q.count + '<br>' : ''}${fmt(q.cost)} 🪙</button>`;
  return `<div class="item"><div class="ic">${U.icon}</div><div class="txt"><b>${U.name} <small>Lv ${lvl}/${max}</small></b><small>${U.desc}</small></div>${btn}</div>`;
}

function renderPanel() {
  let h = '';
  if (tab === 'up') {
    h += ['grow', 'yield', 'hands'].map(upgradeItem).join('');
    if (S.plots.length < MAX_PLOTS) {
      const c = Farm.plotCost(S);
      h += `<div class="item"><div class="ic">🟫</div><div class="txt"><b>New Plot <small>${S.plots.length}/${MAX_PLOTS}</small></b><small>One more patch of soil (or tap the dashed tile)</small></div><button class="buy" data-act="plot" ${S.coins >= c ? '' : 'disabled'}>${fmt(c)} 🪙</button></div>`;
    } else h += '<div class="item"><div class="ic">🟫</div><div class="txt"><b>All plots owned!</b><small>Your orchard is huge</small></div></div>';
  } else if (tab === 'crops') {
    h += '<p class="note">Everything you plant uses the crop you select. Unlock fancier crops to earn more per harvest. Each new crop also brings a new animal to the farm!</p>';
    CROPS.forEach((c, i) => {
      if (i <= S.unlocked) {
        const sel = S.sel === i;
        h += `<div class="item"><div class="ic">${c.e}</div><div class="txt"><b>${c.name}</b><small>🪙 ${fmt(Farm.valueOf(S, i))} · ${Farm.growTime(S, i).toFixed(1)}s</small></div><button class="buy ${sel ? 'sel' : ''}" data-act="sel" data-k="${i}">${sel ? '✔ Planting' : 'Plant this'}</button></div>`;
      } else if (i === S.unlocked + 1) {
        h += `<div class="item"><div class="ic">${c.e}</div><div class="txt"><b>${c.name}</b><small>🪙 ${fmt(Farm.valueOf(S, i))} · ${Farm.growTime(S, i).toFixed(1)}s</small></div><button class="buy" data-act="unlock" ${S.coins >= c.cost ? '' : 'disabled'}>Unlock<br>${fmt(c.cost)} 🪙</button></div>`;
      } else {
        h += `<div class="item dim"><div class="ic">🔒</div><div class="txt"><b>???</b><small>Keep farming…</small></div><button class="buy" disabled>${fmt(c.cost)} 🪙</button></div>`;
      }
    });
  } else {
    const g = Farm.forkGain(S), next = Math.pow(g + 1, 2) * Farm.PRESTIGE_BASE;
    h += `<p class="note">Reboot your farm to earn <b>Golden Forks 🍴</b>. Every fork permanently gives <b>+15% income</b> to everything. You keep your forks; you lose coins, crops, upgrades and plots.</p>
      <div class="item"><div class="ic">🍴</div><div class="txt"><b>${S.forks} forks <small>(×${Farm.forkMul(S).toFixed(2)} income)</small></b><small>${g >= 1 ? 'Reboot now for +' + g + ' 🍴' : 'Earn 🪙 ' + fmt(Farm.PRESTIGE_BASE) + ' this run for your first fork'}</small></div><button class="buy" data-act="reboot" ${g >= 1 ? '' : 'disabled'}>+${g} 🍴</button></div>
      <p class="note">Next fork at 🪙 ${fmt(next)} earned this run (so far ${fmt(S.earnedRun)}).</p>
      <p class="note">Stats: ${fmt(S.harvests)} harvests · ${S.golden} golden stars · ${S.prestiges} reboots · ${fmt(S.earnedAll)} coins earned all-time</p>
      <button class="link" data-act="wipe">Reset all progress</button>`;
  }
  panel.innerHTML = h;
}
function panelSig() {
  const a = [tab, amt, S.plots.length, S.unlocked, S.sel, S.up.grow, S.up.yield, S.up.hands, S.forks, Farm.forkGain(S), Ads.hasAds ? 1 : 0, Farm.boostMul(S)];
  for (const k of ['grow', 'yield', 'hands']) { const q = Farm.quoteUp(S, k, amt === 'max' ? Infinity : +amt); a.push(q.afford ? 1 : 0, q.count); }
  a.push(S.coins >= Farm.plotCost(S) ? 1 : 0, S.unlocked + 1 < CROPS.length && S.coins >= CROPS[S.unlocked + 1].cost ? 1 : 0);
  return a.join('|');
}

function renderPlantbar() {
  let h = '<span class="lbl">Planting:</span>';
  for (let i = 0; i <= S.unlocked; i++) h += `<button class="pc ${S.sel === i ? 'sel' : ''}" data-act="sel" data-k="${i}">${CROPS[i].e}<small>${fmt(Farm.valueOf(S, i))}</small></button>`;
  $('#plantbar').innerHTML = h;
}

// ── daily orders ──
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
let lastOrdersHtml = '', ordT = 0;
function renderOrders() {
  const O = S.orders;
  let h = '';
  if (O.list.length) {
    const note = O.bonus ? '🎉 All done! Come back tomorrow.' : (O.list.length >= 3 ? 'Finish all 3 for a +50% bonus' : 'More orders appear as you unlock crops');
    h = `<div class="ohead"><span class="lbl">📋 Daily orders</span><small>${note}</small></div>`;
    for (const o of O.list) {
      const locked = o.c > S.unlocked, pct = Math.min(100, o.got / o.need * 100);
      const rw = o.done ? o.reward : o.need * Farm.baseValue(S, o.c) * Farm.ORDER_MULT[o.tier];
      h += `<button class="ord ${o.done ? 'done' : ''} ${locked ? 'locked' : ''} ${!o.done && S.sel === o.c ? 'sel' : ''}" ${locked || o.done ? 'disabled' : ''} data-act="sel" data-k="${o.c}">
        <span class="top">${locked ? '🔒' : CROPS[o.c].e} <b>${o.done ? '✅' : o.got + '/' + o.need}</b></span>
        <span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span><small>+${fmt(rw)} 🪙</small></button>`;
    }
  }
  if (h !== lastOrdersHtml) { lastOrdersHtml = h; $('#orders').innerHTML = h; }
}

let lastBoostHtml = '';
function renderBoost() {
  let h;
  if (S.boostT > 0) h = `<span class="bstat">⚡ 2× income! ${fmtClock(S.boostT)}</span>`;
  else if (S.boostCd > 0) h = `<span class="bstat">⚡ Next boost in ${fmtClock(S.boostCd)}</span>`;
  else {
    const cost = Farm.boostCost(S);
    h = Ads.hasAds
      ? `<button class="bbtn" data-act="boostad">📺 Watch ad: 2× income (60s)</button><button class="bbtn coin" data-act="boostcoin" ${S.coins >= cost ? '' : 'disabled'}>⚡ 2× for ${fmt(cost)} 🪙</button>`
      : '<button class="bbtn" data-act="boostad">⚡ 2× income (60s)</button>';
  }
  // only touch the DOM when something changed, otherwise a click can be lost mid-rebuild
  if (h !== lastBoostHtml) { lastBoostHtml = h; $('#boost').innerHTML = h; }
}

// ── actions ──
function doAct(act, k) {
  firstTouch();
  if (act === 'up') { if (Farm.buyUp(S, k, amt === 'max' ? Infinity : +amt)) { beep(660, 0.1, 'square', 0.04, 220); renderPlantbar(); } }
  else if (act === 'plot') { if (Farm.buyPlot(S)) { beep(520, 0.12, 'square', 0.04, 260); const p = plotPos(S.plots.length - 1); addSparks(p.x, p.y, '🟫', 6); } }
  else if (act === 'unlock') {
    if (Farm.unlockNext(S)) {
      const c = CROPS[S.unlocked];
      toast(c.e + ' ' + c.name + ' unlocked!' + (S.unlocked + 2 <= ANIMALS.length ? ' A new ' + ANIMALS[Math.min(ANIMALS.length - 1, 1 + S.unlocked)] + ' joined the farm!' : ''));
      [523, 659, 784, 1047].forEach((f, j) => setTimeout(() => beep(f, 0.18, 'triangle', 0.05), j * 90));
      renderPlantbar();
    }
  }
  else if (act === 'sel') { if (Farm.select(S, +k)) { beep(440, 0.05, 'sine', 0.04); renderPlantbar(); } }
  else if (act === 'tab') { tab = k; $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === k)); $('#amt').style.display = k === 'up' ? '' : 'none'; }
  else if (act === 'amt') { amt = k; $$('#amt button').forEach(b => b.classList.toggle('on', b.dataset.amt === k)); }
  else if (act === 'boostad') Ads.rewarded(ok => { if (ok && Farm.startBoost(S)) { toast('⚡ 2× income for 60 seconds!'); beep(880, 0.25, 'sawtooth', 0.04, 400); } });
  else if (act === 'boostcoin') { const c = Farm.boostCost(S); if (S.coins >= c && Farm.startBoost(S)) { S.coins -= c; toast('⚡ 2× income for 60 seconds!'); beep(880, 0.25, 'sawtooth', 0.04, 400); } }
  else if (act === 'reboot') {
    const g = Farm.forkGain(S);
    modal(`<h2>🍴 Reboot farm?</h2><p>You'll earn <b>+${g} Golden Forks</b> (+${g * 15}% income forever).<br>You will lose your coins, crops, upgrades and plots.</p><div class="row"><button class="buy" id="yes">Reboot!</button><button class="buy ghostb" id="no">Not yet</button></div>`, {
      '#yes': () => { const got = Farm.prestige(S); resetWorld(); renderPlantbar(); lastSig = ''; save(); toast('🍴 +' + got + ' Golden Forks! Your farm restarts richer.'); beep(784, 0.4, 'triangle', 0.06, 400); },
      '#no': () => {}
    });
  }
  else if (act === 'wipe') {
    modal('<h2>Reset everything?</h2><p>This permanently deletes all your progress, including forks.</p><div class="row"><button class="buy" id="yes">Delete it all</button><button class="buy ghostb" id="no">Keep playing</button></div>', {
      '#yes': () => { try { localStorage.removeItem(KEY); } catch (e) {} S = Farm.newState(); resetWorld(); renderPlantbar(); lastSig = ''; },
      '#no': () => {}
    });
  }
  Farm.refreshOrders(S, todayKey());
  renderPanel(); lastSig = panelSig(); renderBoost(); renderOrders();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) doAct(b.dataset.act, b.dataset.k);
  const t = e.target.closest('[data-tab]'); if (t) doAct('tab', t.dataset.tab);
  const a = e.target.closest('[data-amt]'); if (a) doAct('amt', a.dataset.amt);
});
$('#mute').addEventListener('click', () => { setMuted(!muted); firstTouch(); });
window.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'm') setMuted(!muted); });

let touched = false;
function firstTouch() {
  try { window.focus(); cv.focus({ preventScroll: true }); } catch (e) {}     // itch.io iframes only get key events once focused
  if (!touched) { touched = true; Music.start(); const st = $('#start'); if (st) st.style.display = 'none'; }
  Ads.gameplayStart();
}
window.addEventListener('pointerdown', firstTouch);

// ── main loop ──
let last = performance.now(), saveT = 0, slowT = 0;
function step(dt) {
  const r = Farm.tick(S, dt);
  if (r.goldenDue && !Wd.golden) spawnGolden();
  if (r.crowDue) {
    if (S.harvests >= 10 && Wd.crows.length < Farm.maxCrows(S) && spawnCrow()) S.crowT = 40 + Math.random() * 40;
    else S.crowT = 6;      // nothing to peck yet: try again shortly
  }
  if (r.digDue) {
    if (!Wd.dig && S.harvests >= 5 && spawnDig()) { S.digT = 99; if (Wd.digN++ < 2) toast('✨ Something is buried on the farm! Stand on the glimmering mound to dig it up.'); }
    else if (!Wd.dig) S.digT = 5;
  }
  ordT -= dt; if (ordT <= 0) { ordT = 2; Farm.refreshOrders(S, todayKey()); }
  while (S.events.length) {
    const ev = S.events.shift(), f = Wd.farmer;
    if (ev.type === 'order') {
      toast('📋 Order complete! +' + fmt(ev.reward) + ' 🪙'); addText(f.x, f.y - 44, '📋 +' + fmt(ev.reward), 24, '#8fe3ff');
      [660, 880, 1100].forEach((fr, j) => setTimeout(() => beep(fr, 0.14, 'triangle', 0.05), j * 80));
    } else { toast('🎉 All daily orders done! Bonus +' + fmt(ev.reward) + ' 🪙'); [784, 988, 1175, 1568].forEach((fr, j) => setTimeout(() => beep(fr, 0.16, 'triangle', 0.05), j * 90)); }
    lastOrdersHtml = '';
  }
  updateWorld(dt);
  watchAutoHarvests(dt);
  saveT += dt; if (saveT > 5) { saveT = 0; save(); }
}

function render() {
  $('#coins').textContent = fmt(S.coins);
  const rate = Farm.autoRate(S);
  $('#rate').textContent = rate > 0 ? '🤖 ' + fmt(rate) + ' / sec' : 'Walk onto soil to start!';
  $('#forks').textContent = S.forks > 0 ? '🍴 ' + S.forks + ' forks (×' + Farm.forkMul(S).toFixed(2) + ')' : '';
  $('#hint').textContent = S.harvests < 6 ? '🧑‍🌾 Walk with WASD / arrow keys (or tap & drag on the field). Stand on soil to plant, water and harvest. Chase golden eggs and stars!' : '';
  drawWorld();
}

function frame(ts) {
  const dt = Math.min(0.25, (ts - last) / 1000 || 0);
  last = ts; clock += dt;
  step(dt); render();
  slowT += dt;
  if (slowT > 0.2) {
    slowT = 0;
    renderBoost(); renderOrders();
    const sig = panelSig();
    if (sig !== lastSig) { lastSig = sig; renderPanel(); }
  }
  requestAnimationFrame(frame);
}

// ── offline earnings / tab visibility ──
function welcomeBack(secs) {
  const gain = Farm.offline(S, secs);
  if (gain <= 0) return;
  const capped = secs > Farm.OFFLINE_CAP;
  modal(`<h2>Welcome back! 🌅</h2><p>You were away for <b>${fmtDur(secs)}</b>${capped ? ' (8h max)' : ''}. Your farmhands kept working:</p><div class="big">+${fmt(gain)} 🪙</div>
    <div class="row" style="margin-top:14px">${Ads.hasAds ? '<button class="buy alt" id="x2">📺 Collect ×2</button>' : ''}<button class="buy" id="ok">Collect</button></div>`, {
    '#ok': () => {},
    '#x2': () => Ads.rewarded(ok => { if (ok) { Farm.earn(S, gain); toast('📺 Doubled! +' + fmt(gain) + ' 🪙'); } })
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(); Ads.gameplayStop(); }
  else {
    const secs = (Date.now() - S.lastSeen) / 1000;
    last = performance.now();
    if (secs > 60) welcomeBack(secs);
    S.lastSeen = Date.now();
  }
});
window.addEventListener('pagehide', save);

// ── start ──
Ads.init();
setMuted(muted);
Farm.refreshOrders(S, todayKey());
sizeCanvas(); syncAnimals(); renderPlantbar(); renderBoost(); renderOrders(); renderPanel();
$('#amt').style.display = '';
{
  const secs = (Date.now() - S.lastSeen) / 1000;
  if (secs > 60) welcomeBack(secs);
  S.lastSeen = Date.now();
}
requestAnimationFrame(frame);
