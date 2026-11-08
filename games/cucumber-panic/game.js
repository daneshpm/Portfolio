'use strict';
// ───────────────────────── Cucumber Panic ─────────────────────────
// A cat vs. endless cucumbers. Auto-attack survivors-like. No dependencies.

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const ov = document.getElementById('ov');
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
}
window.addEventListener('resize', resize);
resize();

// ── Portal / ads adapter ──
// Auto-detects a portal SDK injected by the host page (Poki: window.PokiSDK,
// CrazyGames: window.CrazyGames.SDK). With no SDK (itch.io, local) there are no ads:
// the revive is free and the ad-only buttons are hidden.
// NOTE: SDK call names below follow each portal's public docs as I understand them;
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
  // Mid-roll ad at a natural break (before a run starts). cb() always runs afterwards.
  interstitial(cb) {
    const s = this.sdk;
    if (!s) { cb(); return; }
    const was = muted;
    let fired = false;
    const fin = () => { if (fired) return; fired = true; muted = was; cb(); };
    muted = true;   // never play game audio over an ad
    try {
      if (s === 'poki') window.PokiSDK.commercialBreak().then(fin).catch(fin);
      else window.CrazyGames.SDK.ad.requestAd('midgame', { adStarted() {}, adFinished: fin, adError: fin });
    } catch (e) { fin(); }
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

// ── Save data ──
const save = (() => {
  const d = { coins: 0, best: 0, up: { hp: 0, pow: 0, spd: 0 }, chars: { tiger: false, lion: false }, char: 'cat' };
  try {
    const s = JSON.parse(localStorage.getItem('cucumber_panic_save') || '{}');
    if (typeof s.coins === 'number') d.coins = s.coins;
    if (typeof s.best === 'number') d.best = s.best;
    if (s.up) for (const k in d.up) if (typeof s.up[k] === 'number') d.up[k] = s.up[k];
    if (s.chars) for (const k in d.chars) d.chars[k] = !!s.chars[k];
    if (typeof s.char === 'string') d.char = s.char;
    if (d.char !== 'cat' && !d.chars[d.char]) d.char = 'cat';
  } catch (e) {}
  return { d, write() { try { localStorage.setItem('cucumber_panic_save', JSON.stringify(d)); } catch (e) {} } };
})();

// ── Audio (tiny WebAudio beeps) ──
let AC = null, muted = false, lastHitSnd = 0;
function beep(f, dur = 0.08, type = 'square', vol = 0.04, slide = 0) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) {}
}
const muteBtn = document.getElementById('mute');
function toggleMute() { muted = !muted; muteBtn.textContent = muted ? '🔇' : '🔊'; }
muteBtn.addEventListener('click', toggleMute);

// ── Music: tiny procedural chiptune loop (Am - F - C - G), speeds up as the run goes on ──
const Music = {
  on: false, step: 0, next: 0, timer: null,
  chords: [
    { root: 110.0, tri: [0, 3, 7] },   // Am
    { root: 87.31, tri: [0, 4, 7] },   // F
    { root: 130.81, tri: [0, 4, 7] },  // C
    { root: 98.0, tri: [0, 4, 7] }     // G
  ],
  start() {
    Ads.gameplayStart();   // portal gameplay events piggyback on the same start/stop points
    if (this.on) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
    } catch (e) { return; }
    this.on = true;
    this.next = AC.currentTime + 0.05;
    this.timer = setInterval(() => this.tick(), 100);
  },
  stop() { Ads.gameplayStop(); this.on = false; if (this.timer) clearInterval(this.timer); this.timer = null; },
  tick() {
    if (!this.on || !AC) return;
    if (muted) { this.next = AC.currentTime + 0.1; return; }
    while (this.next < AC.currentTime + 0.3) {
      this.note(this.step, this.next);
      this.next += (G && state !== 'menu') ? Math.max(0.11, 0.16 - G.t / 2400) : 0.16;
      this.step++;
    }
  },
  tone(f, t, dur, type, vol) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  note(s, t) {
    const c = this.chords[Math.floor(s / 16) % 4], i = s % 16;
    if (i % 4 === 0) this.tone(c.root, t, 0.4, 'triangle', 0.07);
    const n = c.tri[[0, 1, 2, 1][i % 4]] + (i % 8 >= 4 ? 12 : 0);
    this.tone(c.root * 4 * Math.pow(2, n / 12), t, 0.12, 'square', 0.012);
  }
};

// ── Emoji sprite cache (fast drawImage instead of fillText) ──
const spr = {};
function sprite(e, s) {
  const k = e + s;
  if (spr[k]) return spr[k];
  const n = Math.ceil(s * 2 * 1.4);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d');
  x.font = (s * 2) + 'px serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(e, n / 2, n / 2 + s * 0.1);
  return (spr[k] = c);
}
function drawSpr(e, s, x, y, sc = 1, flip = 1, rot = 0, sq = 1) {
  const c = sprite(e, s), n = (c.width / 2) * sc;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (flip < 0) ctx.scale(-1, 1);
  if (sq !== 1) ctx.scale(1, sq);
  ctx.drawImage(c, -n / 2, -n / 2, n, n);
  ctx.restore();
}

// ── Definitions ──
const WEAPONS = {
  fish: { icon: '🐟', name: 'Fish Toss', max: 5, d: ['Tosses a fish at the nearest cucumber', '+1 fish', 'Throws faster', '+1 fish, pierces enemies', '+1 fish, big damage'] },
  yarn: { icon: '🧶', name: 'Yarn Orbit', max: 5, d: ['A yarn ball circles you', '+1 yarn ball', 'Wider orbit', '+1 yarn ball', '+1 yarn ball, more damage'] },
  meow: { icon: '📣', name: 'Mighty Meow', max: 5, d: ['Shockwave knocks enemies back', 'Bigger wave', 'Meows more often', 'Bigger wave', 'Huge damage'] },
  claw: { icon: '🐾', name: 'Claw Swipe', max: 5, d: ['Slashes the cucumbers in front of you', 'Bigger slash', 'Slashes faster', 'Slashes both sides', 'Huge damage'] },
  bone: { icon: '🦴', name: 'Boomerang Bone', max: 5, d: ['Throws a bone that flies back to you', '+1 bone', 'Throws faster', '+1 bone, bigger bone', '+1 bone, huge damage'] },
  bolt: { icon: '⚡', name: 'Static Zap', max: 5, d: ['Zaps a random cucumber nearby', '+1 bolt', 'Zaps faster', '+1 bolt, bigger blast', '+1 bolt, huge damage'] }
};
const PASSIVES = {
  speed: { icon: '💨', name: 'Zoomies', d: '+8% move speed' },
  power: { icon: '🌿', name: 'Catnip', d: '+15% damage' },
  haste: { icon: '☕', name: 'Caffeine', d: '+12% attack speed' },
  magnet: { icon: '🧲', name: 'Magnet', d: 'Grab gems from farther away' },
  hp: { icon: '❤️', name: 'Nine Lives', d: '+15 max HP and heal 15' },
  armor: { icon: '🛡️', name: 'Thick Fur', d: '-8% damage taken' },
  regen: { icon: '💗', name: 'Purr Power', d: 'Slowly regenerate HP' }
};
const SHOP = [
  { k: 'hp', icon: '❤️', name: 'Tougher Cat', d: '+10 starting HP' },
  { k: 'pow', icon: '🌿', name: 'Sharp Claws', d: '+5% damage' },
  { k: 'spd', icon: '👟', name: 'Fast Paws', d: '+4% move speed' }
];
const SHOP_MAX = 10;
const REVIVE_COST = 50;
const CHARS = {
  cat:   { icon: '🐱', name: 'Tabby', cost: 0,   start: 'fish', hp: 0,  pow: 0,    spd: 0,    d: 'Starts with Fish Toss' },
  tiger: { icon: '🐯', name: 'Tigger', cost: 200, start: 'claw', hp: 30, pow: 0,    spd: 0,    d: 'Claw Swipe · +30 HP' },
  lion:  { icon: '🦁', name: 'Leo',   cost: 400, start: 'yarn', hp: 0,  pow: 0.15, spd: 0.05, d: 'Yarn Orbit · +15% dmg, +5% speed' }
};
const shopCost = k => 30 * (save.d.up[k] + 1);

const ETYPES = {
  cuke: { e: '🥒', hp: 14, spd: 55, r: 14, dmg: 8, xp: 1, s: 30 },
  leaf: { e: '🥬', hp: 9, spd: 100, r: 11, dmg: 6, xp: 1, s: 24 },
  melon: { e: '🍈', hp: 90, spd: 38, r: 24, dmg: 16, xp: 6, s: 52 },
  chili: { e: '🌶️', hp: 22, spd: 60, r: 12, dmg: 10, xp: 2, s: 26, dash: { cd: [2.5, 4], dur: 0.6, mult: 4 } },   // dashes at you
  corn: { e: '🌽', hp: 16, spd: 50, r: 12, dmg: 5, xp: 2, s: 26, ranged: true },                                  // keeps distance, shoots kernels
  boss: { e: '🥒', hp: 500, spd: 42, r: 52, dmg: 25, xp: 0, s: 120, boss: true, name: '👑 KING CUCUMBER' },
  boss2: { e: '🍉', hp: 800, spd: 40, r: 56, dmg: 30, xp: 0, s: 124, boss: true, name: '🍉 GIANT WATERMELON', dash: { cd: [3.5, 5], dur: 0.7, mult: 5 } }
};

// ── Game state ──
let state = 'menu';   // menu | play | levelup | dead
let G = null, shake = 0, last = 0, clock = 0;   // clock = animation time (runs in menus too)

const C = () => CHARS[G.char];
const maxHp = () => 100 + 15 * G.ps.hp + 10 * save.d.up.hp + C().hp;
const powMul = () => 1 + 0.15 * G.ps.power + 0.05 * save.d.up.pow + C().pow;
const hasteMul = () => 1 + 0.12 * G.ps.haste;
const armorMul = () => Math.max(0.4, 1 - 0.08 * G.ps.armor);
const moveSpd = () => 150 * (1 + 0.08 * G.ps.speed + 0.04 * save.d.up.spd + C().spd);
const magnetR = () => 60 + 45 * G.ps.magnet;
const xpNeed = () => 5 + (G.p.lvl - 1) * 6;

function newGame() {
  G = {
    t: 0, kills: 0, runCoins: 0, revived: false, doubled: false, committed: false,
    spawnT: 0, waveT: 45, bossT: 90, bossN: 0, pend: 0, orbit: 0, banner: null, char: save.d.char,
    p: { x: 0, y: 0, hp: 100, inv: 0, xp: 0, lvl: 1, face: 1 },
    ps: { speed: 0, power: 0, haste: 0, magnet: 0, hp: 0, armor: 0, regen: 0 },
    w: { [CHARS[save.d.char].start]: { lvl: 1, cd: 0 } },
    en: [], shots: [], eb: [], gems: [], coins: [], chests: [], rings: [], slashes: [], zaps: [], parts: [], txt: []
  };
  G.p.hp = maxHp();
  hideOv();
  state = 'play';
  Music.start();
}

function commit() {
  if (!G || G.committed) return;
  G.committed = true;
  save.d.coins += G.runCoins;
  save.d.best = Math.max(save.d.best, Math.floor(G.t));
  save.write();
}

// ── Input ──
const keys = {};
const stick = { on: false, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'm') toggleMute();
  if (k === 'p' || k === 'escape') togglePause();
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') togglePause(); });
cv.addEventListener('pointerdown', e => {
  stick.on = true; stick.ox = stick.x = e.clientX; stick.oy = stick.y = e.clientY; stick.dx = stick.dy = 0;
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
});
cv.addEventListener('pointermove', e => {
  if (!stick.on) return;
  stick.x = e.clientX; stick.y = e.clientY;
  let dx = (stick.x - stick.ox) / 50, dy = (stick.y - stick.oy) / 50;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  stick.dx = dx; stick.dy = dy;
});
const endStick = () => { stick.on = false; stick.dx = stick.dy = 0; };
cv.addEventListener('pointerup', endStick);
cv.addEventListener('pointercancel', endStick);

// ── Helpers ──
const rnd = (a, b) => a + Math.random() * (b - a);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmtTime = s => { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

// ── Spawning ──
function pickType() {
  const r = Math.random(), t = G.t;
  const m = t > 60 ? 0.08 + Math.min(0.12, (t - 60) / 600) : 0;
  if (r < m) return 'melon';
  if (t > 90 && r < m + 0.12) return 'chili';
  if (t > 120 && r < m + 0.2) return 'corn';
  if (t > 20 && r < 0.35) return 'leaf';
  return 'cuke';
}
function spawnEnemy(type, ang) {
  const T = ETYPES[type], d = Math.max(W, H) * 0.6 + 40, a = ang === undefined ? Math.random() * 6.283 : ang;
  const hs = T.boss ? 1 + G.t / 90 : 1 + G.t / 55;
  G.en.push({
    x: G.p.x + Math.cos(a) * d, y: G.p.y + Math.sin(a) * d, type,
    hp: T.hp * hs, maxHp: T.hp * hs, spd: T.spd * rnd(0.9, 1.1), r: T.r, dmg: T.dmg, kx: 0, ky: 0, f: 0, yt: 0,
    dc: rnd(1, 3), dashT: 0, sc: rnd(1, 2.5), ph: rnd(0, 6.283), dead: false
  });
}
function spawnLogic(dt) {
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    G.spawnT = Math.max(0.15, 0.9 - G.t / 160);
    const n = 1 + Math.floor(G.t / 40);
    for (let i = 0; i < n; i++) if (G.en.length < 350) spawnEnemy(pickType());
  }
  G.waveT -= dt;
  if (G.waveT <= 0) {
    G.waveT = 40;
    const n = 20 + Math.floor(G.t / 10);
    for (let i = 0; i < n; i++) if (G.en.length < 400) spawnEnemy(pickType(), (i / n) * 6.283);
    G.banner = { text: '🥒 CUCUMBER WAVE! 🥒', t: 2.5 };
    beep(180, 0.4, 'sawtooth', 0.05, -80);
  }
  G.bossT -= dt;
  if (G.bossT <= 0) {
    G.bossT = 120;
    const bt = G.bossN % 2 === 0 ? 'boss' : 'boss2';   // alternate King Cucumber / Giant Watermelon
    G.bossN++;
    spawnEnemy(bt);
    if (bt === 'boss2') for (let i = 0; i < 12; i++) spawnEnemy('leaf');
    G.banner = { text: ETYPES[bt].name + '!', t: 3 };
    shake = 14;
    beep(90, 0.8, 'sawtooth', 0.07, -30);
  }
}

// ── Combat ──
function hitEnemy(e, dmg, kx, ky, kb) {
  const m = Math.hypot(kx, ky) || 1;
  if (ETYPES[e.type].boss) kb *= 0.1;
  e.kx += (kx / m) * kb; e.ky += (ky / m) * kb;
  e.hp -= dmg; e.f = 0.1;
  if (G.txt.length < 60) G.txt.push({ x: e.x + rnd(-8, 8), y: e.y - e.r, v: Math.round(dmg), t: 0.6 });
  const now = performance.now();
  if (now - lastHitSnd > 60) { lastHitSnd = now; beep(rnd(260, 340), 0.05, 'square', 0.025); }
  if (e.hp <= 0 && !e.dead) killEnemy(e);
}
function killEnemy(e) {
  e.dead = true; G.kills++;
  const T = ETYPES[e.type];
  if (T.xp > 0) G.gems.push({ x: e.x, y: e.y, v: T.xp });
  if (T.boss) {
    G.chests.push({ x: e.x, y: e.y });
    G.banner = { text: '👑 BOSS DEFEATED! Grab the chest!', t: 3 };
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.283, s = rnd(60, 260);
      G.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.7, c: ECOL[e.type] });
    }
    beep(660, 0.5, 'triangle', 0.06, 500);
  }
  if (Math.random() < 0.1) G.coins.push({ x: e.x + rnd(-10, 10), y: e.y + rnd(-10, 10) });
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * 6.283, s = rnd(40, 130);
    G.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.4, c: ECOL[e.type] });
  }
}
function nearestEnemies() {
  const p = G.p;
  return G.en.filter(e => !e.dead)
    .map(e => ({ e, d: (e.x - p.x) ** 2 + (e.y - p.y) ** 2 }))
    .sort((a, b) => a.d - b.d).map(o => o.e);
}
function fireFish(l) {
  const list = nearestEnemies();
  if (!list.length) return false;
  const p = G.p, n = 1 + (l >= 2) + (l >= 4) + (l >= 5);
  for (let i = 0; i < n; i++) {
    const t = list[i % list.length];
    const a = Math.atan2(t.y - p.y, t.x - p.x) + (n > 1 ? (i - (n - 1) / 2) * 0.12 : 0);
    G.shots.push({
      x: p.x, y: p.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, a, r: 9, life: 1.4, hit: [],
      dmg: 12 * (l >= 5 ? 1.5 : 1) * powMul(), pierce: l >= 4 ? 3 : 1
    });
  }
  beep(520, 0.06, 'triangle', 0.03, 200);
  return true;
}
function yarnPos(i, n, l) {
  const R = 50 + (l >= 3 ? 30 : 0), a = G.orbit + (i * 6.283) / n;
  return { x: G.p.x + Math.cos(a) * R, y: G.p.y + Math.sin(a) * R };
}
function fireBone(l) {
  const list = nearestEnemies();
  if (!list.length) return false;
  const p = G.p, n = 1 + (l >= 2) + (l >= 4) + (l >= 5);
  for (let i = 0; i < n; i++) {
    const t = list[i % list.length];
    const a = Math.atan2(t.y - p.y, t.x - p.x) + (n > 1 ? (i - (n - 1) / 2) * 0.35 : 0);
    G.shots.push({
      x: p.x, y: p.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, a, r: 12 + (l >= 4 ? 5 : 0), life: 3, hit: [],
      bone: true, t: 0, out: 0.55, back: false, dmg: 14 * (l >= 5 ? 1.5 : 1) * powMul(), pierce: 9999
    });
  }
  beep(300, 0.08, 'triangle', 0.03, 150);
  return true;
}
function doZap(l) {
  const p = G.p;
  const c = G.en.filter(e => !e.dead && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 380 * 380);
  if (!c.length) return false;
  shuffle(c);
  const n = 1 + (l >= 2) + (l >= 4) + (l >= 5), aoe = 40 + (l >= 4 ? 25 : 0);
  const dmg = 22 * (l >= 5 ? 1.5 : 1) * powMul();
  for (let i = 0; i < Math.min(n, c.length); i++) {
    const t = c[i];
    G.zaps.push({ x: t.x, y: t.y, ox: rnd(-30, 30), r: aoe, t: 0.22 });
    for (const e of G.en) {
      if (e.dead) continue;
      if (e === t) hitEnemy(e, dmg, 0, 0, 0);
      else if (Math.hypot(e.x - t.x, e.y - t.y) < aoe + e.r) hitEnemy(e, dmg * 0.5, e.x - t.x, e.y - t.y, 80);
    }
  }
  beep(1200, 0.12, 'sawtooth', 0.04, -900);
  return true;
}
function angDiff(a, b) { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); }
function doClaw(l) {
  const p = G.p, list = nearestEnemies();
  if (!list.length) return false;
  const t = list[0];
  if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 > 300 * 300) return false;
  const a = Math.atan2(t.y - p.y, t.x - p.x), R = 80 + 14 * (l - 1), both = l >= 4;
  const dmg = 16 * (1 + 0.25 * (l - 1)) * powMul();
  for (const e of G.en) {
    if (e.dead) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) > R + e.r) continue;
    const ea = Math.atan2(e.y - p.y, e.x - p.x);
    let da = Math.abs(angDiff(ea, a));
    if (both) da = Math.min(da, Math.abs(angDiff(ea, a + Math.PI)));
    if (da < 0.95) hitEnemy(e, dmg, e.x - p.x, e.y - p.y, 160);
  }
  G.slashes.push({ x: p.x, y: p.y, a, r: R, both, t: 0.18 });
  beep(380, 0.09, 'sawtooth', 0.035, -200);
  return true;
}
function weaponsUpdate(dt) {
  const w = G.w, p = G.p;
  if (w.fish) {
    w.fish.cd -= dt;
    if (w.fish.cd <= 0) {
      if (fireFish(w.fish.lvl)) w.fish.cd = (0.9 * (w.fish.lvl >= 3 ? 0.75 : 1)) / hasteMul();
      else w.fish.cd = 0.1;
    }
  }
  if (w.yarn) {
    const l = w.yarn.lvl, n = 1 + (l >= 2) + (l >= 4) + (l >= 5);
    G.orbit += dt * 3.2 * hasteMul();
    const dmg = 12 * (1 + 0.15 * (l - 1)) * powMul();
    for (let i = 0; i < n; i++) {
      const yp = yarnPos(i, n, l);
      for (const e of G.en) {
        if (e.dead || e.yt > 0) continue;
        if (Math.hypot(e.x - yp.x, e.y - yp.y) < e.r + 14) { e.yt = 0.35; hitEnemy(e, dmg, e.x - p.x, e.y - p.y, 90); }
      }
    }
  }
  if (w.bone) {
    w.bone.cd -= dt;
    if (w.bone.cd <= 0) {
      if (fireBone(w.bone.lvl)) w.bone.cd = (1.7 * (w.bone.lvl >= 3 ? 0.75 : 1)) / hasteMul();
      else w.bone.cd = 0.1;
    }
  }
  if (w.bolt) {
    w.bolt.cd -= dt;
    if (w.bolt.cd <= 0) {
      if (doZap(w.bolt.lvl)) w.bolt.cd = (1.8 * (w.bolt.lvl >= 3 ? 0.75 : 1)) / hasteMul();
      else w.bolt.cd = 0.15;
    }
  }
  if (w.claw) {
    w.claw.cd -= dt;
    if (w.claw.cd <= 0) {
      if (doClaw(w.claw.lvl)) w.claw.cd = (1.3 * (w.claw.lvl >= 3 ? 0.75 : 1)) / hasteMul();
      else w.claw.cd = 0.1;
    }
  }
  if (w.meow) {
    const l = w.meow.lvl;
    w.meow.cd -= dt;
    if (w.meow.cd <= 0) {
      w.meow.cd = (3.6 * (1 - 0.08 * (l - 1))) / hasteMul();
      G.rings.push({ x: p.x, y: p.y, r: 0, max: 120 + 25 * (l - 1), dmg: 14 * (1 + 0.3 * (l - 1)) * powMul(), hit: new Set() });
      beep(200, 0.25, 'sawtooth', 0.04, -100);
    }
  }
  for (const rg of G.rings) {
    rg.r += 380 * dt;
    for (const e of G.en) {
      if (e.dead || rg.hit.has(e)) continue;
      const d = Math.hypot(e.x - rg.x, e.y - rg.y);
      if (d < rg.r + 12 && d > rg.r - 30) { rg.hit.add(e); hitEnemy(e, rg.dmg, e.x - rg.x, e.y - rg.y, 260); }
    }
  }
  G.rings = G.rings.filter(r => r.r < r.max);
}

// ── Update ──
function update(dt) {
  const p = G.p;
  G.t += dt;

  let dx = 0, dy = 0;
  if (keys['a'] || keys['arrowleft']) dx--;
  if (keys['d'] || keys['arrowright']) dx++;
  if (keys['w'] || keys['arrowup']) dy--;
  if (keys['s'] || keys['arrowdown']) dy++;
  if (stick.on) { dx = stick.dx; dy = stick.dy; }
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  p.mv = m > 0.05;
  p.x += dx * moveSpd() * dt; p.y += dy * moveSpd() * dt;
  if (dx) p.face = dx > 0 ? 1 : -1;
  p.inv -= dt;
  if (G.ps.regen) p.hp = Math.min(maxHp(), p.hp + 0.6 * G.ps.regen * dt);

  spawnLogic(dt);
  weaponsUpdate(dt);

  for (const e of G.en) {
    if (e.dead) continue;
    const ex = p.x - e.x, ey = p.y - e.y, d = Math.hypot(ex, ey) || 1;
    const T = ETYPES[e.type];
    let sp = e.spd;
    if (T.dash) {
      e.dc -= dt;
      if (e.dc <= 0) { e.dashT = T.dash.dur; e.dc = rnd(T.dash.cd[0], T.dash.cd[1]); }
      if (e.dashT > 0) { e.dashT -= dt; sp *= T.dash.mult; }
    }
    if (T.ranged) {
      e.sc -= dt;
      if (e.sc <= 0 && d < 450) { e.sc = 2.2; G.eb.push({ x: e.x, y: e.y, vx: (ex / d) * 160, vy: (ey / d) * 160, life: 4, dmg: 7 }); }
    }
    const stop = T.ranged ? 230 : e.r + 8;   // melee stop at contact range so they surround you instead of stacking
    const chase = d > stop ? sp : 0;
    e.x += (ex / d) * chase * dt + e.kx * dt;
    e.y += (ey / d) * chase * dt + e.ky * dt;
    const decay = Math.pow(0.02, dt);
    e.kx *= decay; e.ky *= decay;
    e.f -= dt; e.yt -= dt;
    if (d < e.r + 14 && p.inv <= 0) {
      p.hp -= e.dmg * armorMul(); p.inv = 0.5; shake = 8;
      beep(110, 0.18, 'sawtooth', 0.06, -50);
    }
  }

  for (const s of G.shots) {
    if (s.bone) {
      // boomerang: fly out, then home back to the player; hit list resets on the way back
      s.t += dt;
      if (s.t < s.out) { s.x += s.vx * dt; s.y += s.vy * dt; }
      else {
        if (!s.back) { s.back = true; s.hit = []; }
        const bx = p.x - s.x, by = p.y - s.y, bd = Math.hypot(bx, by) || 1;
        s.x += (bx / bd) * 380 * dt; s.y += (by / bd) * 380 * dt;
        if (bd < 22) s.life = 0;
      }
      s.life -= dt;
    } else { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
    for (const e of G.en) {
      if (e.dead || s.life <= 0 || s.hit.includes(e)) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + s.r) {
        hitEnemy(e, s.dmg, s.vx, s.vy, 120);
        s.hit.push(e);
        if (--s.pierce <= 0) s.life = 0;
      }
    }
  }
  G.shots = G.shots.filter(s => s.life > 0);
  for (const b of G.eb) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (p.inv <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < 20) {
      p.hp -= b.dmg * armorMul(); p.inv = 0.5; shake = 8; b.life = 0;
      beep(110, 0.18, 'sawtooth', 0.06, -50);
    }
  }
  G.eb = G.eb.filter(b => b.life > 0);
  G.en = G.en.filter(e => !e.dead);

  const mr = magnetR();
  for (const g of G.gems) {
    const gx = p.x - g.x, gy = p.y - g.y, d = Math.hypot(gx, gy);
    if (d < mr || g.pull) { g.pull = true; g.x += (gx / (d || 1)) * 320 * dt; g.y += (gy / (d || 1)) * 320 * dt; }
    if (d < 18) { g.done = true; addXp(g.v); beep(700 + Math.min(G.p.xp, 10) * 40, 0.05, 'sine', 0.03); }
  }
  G.gems = G.gems.filter(g => !g.done);
  for (const c of G.coins) {
    const cx = p.x - c.x, cy = p.y - c.y, d = Math.hypot(cx, cy);
    if (d < mr) { c.x += (cx / (d || 1)) * 320 * dt; c.y += (cy / (d || 1)) * 320 * dt; }
    if (d < 18) { c.done = true; G.runCoins++; beep(1100, 0.06, 'square', 0.03); }
  }
  G.coins = G.coins.filter(c => !c.done);
  for (const c of G.chests) {
    if (Math.hypot(p.x - c.x, p.y - c.y) < 36) {
      c.done = true; G.pend++; G.runCoins += 10; p.hp = Math.min(maxHp(), p.hp + 30);
      G.banner = { text: '🎁 Free level up!', t: 2 }; beep(990, 0.3, 'triangle', 0.06, 400);
    }
  }
  G.chests = G.chests.filter(c => !c.done);
  for (const s of G.slashes) s.t -= dt;
  G.slashes = G.slashes.filter(s => s.t > 0);
  for (const z of G.zaps) z.t -= dt;
  G.zaps = G.zaps.filter(z => z.t > 0);

  for (const q of G.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.t -= dt; }
  G.parts = G.parts.filter(q => q.t > 0);
  for (const q of G.txt) { q.y -= 30 * dt; q.t -= dt; }
  G.txt = G.txt.filter(q => q.t > 0);
  if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
  shake = Math.max(0, shake - 30 * dt);

  if (p.hp <= 0) { p.hp = 0; die(); return; }
  if (G.pend > 0 && state === 'play') { state = 'levelup'; showLevelUp(); }
}

function addXp(v) {
  const p = G.p;
  p.xp += v;
  while (p.xp >= xpNeed()) { p.xp -= xpNeed(); p.lvl++; G.pend++; }
}

// ── Overlays (DOM) ──
function hideOv() { ov.classList.add('hidden'); ov.classList.remove('menu'); ov.innerHTML = ''; }
function showOv(html) { ov.innerHTML = html; ov.classList.remove('hidden'); ov.classList.remove('menu'); }
function on(sel, fn) { const el = ov.querySelector(sel); if (el) el.addEventListener('click', fn); }

function showMenu() {
  state = 'menu';
  Music.stop();
  const shop = SHOP.map(s => {
    const lv = save.d.up[s.k], maxed = lv >= SHOP_MAX, cost = shopCost(s.k);
    return `<button data-shop="${s.k}" ${maxed || save.d.coins < cost ? 'disabled' : ''}>${s.icon} ${s.name} Lv${lv}<br><small>${s.d}</small><br>${maxed ? 'MAX' : '🪙 ' + cost}</button>`;
  }).join('');
  const chars = Object.keys(CHARS).map(k => {
    const c = CHARS[k], owned = k === 'cat' || save.d.chars[k], cur = save.d.char === k;
    const label = owned ? (cur ? '✔ Selected' : 'Select') : '🪙 ' + c.cost;
    return `<button data-char="${k}" class="${cur ? 'sel' : ''}" ${!owned && save.d.coins < c.cost ? 'disabled' : ''}>${c.icon} ${c.name}<br><small>${c.d}</small><br>${label}</button>`;
  }).join('');
  showOv(`
    <h1>🐱 Cucumber Panic 🥒</h1>
    <p class="sub">Survive the cucumbers. Move: WASD / arrows / drag. Attacks are automatic.</p>
    <button class="big" id="play">▶ PLAY</button>
    <p class="sub">🪙 ${save.d.coins} coins &nbsp;·&nbsp; 🏆 Best: ${fmtTime(save.d.best)}</p>
    <h2>Your cat</h2>
    <div class="shop">${chars}</div>
    <h2>Upgrades</h2>
    <div class="shop">${shop}</div>`);
  ov.classList.add('menu');   // lighter overlay so the animated backdrop shows through
  on('#play', () => Ads.interstitial(newGame));
  ov.querySelectorAll('[data-char]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.char, c = CHARS[k], owned = k === 'cat' || save.d.chars[k];
    if (!owned) { if (save.d.coins < c.cost) return; save.d.coins -= c.cost; save.d.chars[k] = true; }
    save.d.char = k; save.write(); beep(900, 0.1, 'square', 0.04); showMenu();
  }));
  ov.querySelectorAll('[data-shop]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.shop, cost = shopCost(k);
    if (save.d.up[k] < SHOP_MAX && save.d.coins >= cost) { save.d.coins -= cost; save.d.up[k]++; save.write(); beep(900, 0.1, 'square', 0.04); showMenu(); }
  }));
}

function levelOptions() {
  const o = [];
  for (const k in WEAPONS) { const l = G.w[k] ? G.w[k].lvl : 0; if (l < WEAPONS[k].max) o.push({ kind: 'w', k, l: l + 1 }); }
  for (const k in PASSIVES) { const l = G.ps[k]; if (l < 5) o.push({ kind: 'p', k, l: l + 1 }); }
  shuffle(o);
  const pick = o.slice(0, 3);
  if (!pick.length) pick.push({ kind: 'heal' });
  return pick;
}
function showLevelUp() {
  Ads.gameplayStop();
  const opts = levelOptions();
  beep(880, 0.25, 'triangle', 0.05, 400);
  const cards = opts.map((o, i) => {
    if (o.kind === 'heal') return `<button class="card" data-i="${i}"><span class="ic">🍗</span><b>Snack</b><small>Heal 50 HP</small></button>`;
    const def = o.kind === 'w' ? WEAPONS[o.k] : PASSIVES[o.k];
    const desc = o.kind === 'w' ? def.d[o.l - 1] : def.d;
    return `<button class="card" data-i="${i}"><span class="ic">${def.icon}</span><b>${def.name}</b><small>${o.l === 1 ? 'NEW!' : 'Lv ' + o.l}</small><small>${desc}</small></button>`;
  }).join('');
  showOv(`<h2>⬆ Level ${G.p.lvl}!</h2><div class="row">${cards}</div>`);
  ov.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
    const o = opts[+b.dataset.i];
    applyOption(o);
    G.pend--;
    if (G.pend > 0) showLevelUp(); else { hideOv(); state = 'play'; Ads.gameplayStart(); }
  }));
}
function applyOption(o) {
  const p = G.p;
  if (o.kind === 'heal') p.hp = Math.min(maxHp(), p.hp + 50);
  else if (o.kind === 'w') { G.w[o.k] = G.w[o.k] || { lvl: 0, cd: 0 }; G.w[o.k].lvl++; }
  else { G.ps[o.k]++; if (o.k === 'hp') p.hp = Math.min(maxHp(), p.hp + 15); }
}

function togglePause() {
  if (state === 'play') {
    state = 'paused';
    Music.stop();
    showOv('<h2>⏸ Paused</h2><div class="row"><button class="big" id="resume">▶ Resume</button><button class="ghost" id="quit">Quit run</button></div>');
    on('#resume', togglePause);
    on('#quit', () => { commit(); G = null; showMenu(); });
  } else if (state === 'paused') { hideOv(); state = 'play'; Music.start(); }
}

function die() {
  state = 'dead';
  Music.stop();
  beep(150, 0.6, 'sawtooth', 0.07, -100);
  showDead();
}
function showDead() {
  showOv(`
    <h2>💀 The cucumbers got you</h2>
    <p class="sub">⏱ ${fmtTime(G.t)} &nbsp;·&nbsp; 🥒 ${G.kills} squashed &nbsp;·&nbsp; 🪙 +${G.runCoins}</p>
    <div class="row">
      ${G.revived ? '' : `<button class="alt" id="revive">${Ads.hasAds ? '📺 Watch ad: Revive' : '💖 Revive'}</button>`}
      ${G.revived || !Ads.hasAds ? '' : `<button class="alt" id="revivec" ${save.d.coins < REVIVE_COST ? 'disabled' : ''}>🪙 ${REVIVE_COST}: Revive</button>`}
      ${G.doubled || !G.runCoins || !Ads.hasAds ? '' : '<button class="alt" id="double">📺 Watch ad: Double coins</button>'}
    </div>
    <div class="row">
      <button class="big" id="again">↻ Play again</button>
      <button class="ghost" id="menu">Menu</button>
    </div>`);
  const doRevive = () => {
    G.revived = true; G.p.hp = maxHp() / 2; G.p.inv = 2.5;
    const p = G.p;
    for (const e of G.en) { const d = Math.hypot(e.x - p.x, e.y - p.y) || 1; if (d < 260) { e.kx += ((e.x - p.x) / d) * 700; e.ky += ((e.y - p.y) / d) * 700; } }
    hideOv(); state = 'play'; Music.start();
  };
  on('#revive', () => Ads.rewarded(ok => { if (ok) doRevive(); }));
  // Non-ad alternative (portals require one): pay banked coins instead of watching an ad.
  on('#revivec', () => { if (save.d.coins >= REVIVE_COST) { save.d.coins -= REVIVE_COST; save.write(); doRevive(); } });
  on('#double', () => Ads.rewarded(ok => { if (ok) { G.runCoins *= 2; G.doubled = true; showDead(); } }));
  on('#again', () => { commit(); Ads.interstitial(newGame); });
  on('#menu', () => { commit(); G = null; showMenu(); });
}

// ── Render ──
const ECOL = { cuke: '#7ed957', leaf: '#a6e05a', melon: '#d9f27a', chili: '#ff5a3c', corn: '#ffd84a', boss: '#7ed957', boss2: '#ff6b81' };
const DECOR = ['🌼', '🌱', '🍄', '🌿', '🪨', '🌸'];

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// deterministic pseudo-random 0..1 per grid cell (so the world looks the same every time)
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function pill(x, y, w, h) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; rr(x, y, w, h, h / 2); ctx.fill(); }
function shadow(x, y, rx, ry) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.283); ctx.fill(); }
function strokeFill(txt, x, y) {
  ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(txt, x, y); ctx.fillText(txt, x, y);
}
function iconBox(icon, lvl, x, y, s) {
  ctx.fillStyle = 'rgba(0,0,0,0.42)'; rr(x, y, s, s, 7); ctx.fill();
  drawSpr(icon, s * 0.55, x + s / 2, y + s / 2 - 1);
  ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
  ctx.fillText(lvl, x + s - 3, y + s - 3);
}

function drawGround(cx, cy) {
  const S = 96;
  const ix0 = Math.floor(cx / S), iy0 = Math.floor(cy / S);
  const nx = Math.ceil(W / S) + 2, ny = Math.ceil(H / S) + 2;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const ix = ix0 + i, iy = iy0 + j;
    ctx.fillStyle = ((ix + iy) & 1) ? '#27402d' : '#2a4532';
    ctx.fillRect(ix * S - cx, iy * S - cy, S + 1, S + 1);
  }
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const ix = ix0 + i, iy = iy0 + j;
    if (hash2(ix, iy) > 0.4) continue;
    const dx = hash2(ix + 11, iy) * 80 + 8, dy = hash2(ix, iy + 17) * 80 + 8;
    const k = Math.min(DECOR.length - 1, Math.floor(hash2(ix + 5, iy + 9) * DECOR.length));
    drawSpr(DECOR[k], 14 + Math.floor(hash2(ix + 3, iy + 3) * 8), ix * S + dx - cx, iy * S + dy - cy);
  }
  ctx.globalAlpha = 1;
}

function vignette() {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// Title-screen backdrop: cucumbers drifting past while a cat runs for its life
function drawMenuFx() {
  const em = ['🥒', '🥬', '🌶️', '🌽', '🍈'];
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 16; i++) {
    const sp = 18 + (i % 5) * 7, x = ((i * 197 + clock * sp) % (W + 160)) - 80;
    const y = H * (0.1 + 0.75 * hash2(i, 3)) + Math.sin(clock * 1.6 + i) * 16;
    drawSpr(em[i % 5], 34 + (i % 3) * 8, x, y, 1, 1, Math.sin(clock * 2 + i) * 0.25);
  }
  ctx.globalAlpha = 1;
  const catX = ((clock * 110) % (W + 240)) - 120, catY = H * 0.92;
  shadow(catX, catY + 18, 18, 6);
  drawSpr('🐱', 44, catX, catY + Math.abs(Math.sin(clock * 12)) * -10, 1, 1, Math.sin(clock * 12) * 0.12);
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#24352a';
  ctx.fillRect(0, 0, W, H);

  const px = G ? G.p.x : clock * 30, py = G ? G.p.y : 0;
  const sx = shake ? rnd(-shake, shake) * 0.5 : 0, sy = shake ? rnd(-shake, shake) * 0.5 : 0;
  const cx = px - W / 2 - sx, cy = py - H / 2 - sy;

  drawGround(cx, cy);
  if (!G) { drawMenuFx(); vignette(); return; }

  const p = G.p;
  ctx.save();
  ctx.translate(-cx, -cy);

  // pickups
  for (const g of G.gems) {
    const bob = Math.sin(clock * 5 + g.x) * 1.5;
    ctx.fillStyle = 'rgba(95,227,255,0.22)'; ctx.beginPath(); ctx.arc(g.x, g.y + bob, 10, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#5fe3ff'; ctx.beginPath();
    ctx.moveTo(g.x, g.y + bob - 6); ctx.lineTo(g.x + 5, g.y + bob); ctx.lineTo(g.x, g.y + bob + 6); ctx.lineTo(g.x - 5, g.y + bob); ctx.fill();
  }
  for (const c of G.coins) drawSpr('🪙', 16, c.x, c.y + Math.sin(clock * 6 + c.x) * 2);
  for (const c of G.chests) { shadow(c.x, c.y + 18, 18, 6); drawSpr('🎁', 36, c.x, c.y + Math.sin(G.t * 5) * 3); }

  for (const r of G.rings) {
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - r.r / r.max)})`; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.283); ctx.stroke();
  }
  for (const s of G.slashes) {
    ctx.strokeStyle = `rgba(255,255,255,${s.t / 0.18})`; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.9, s.a - 0.9, s.a + 0.9); ctx.stroke();
    if (s.both) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.9, s.a + Math.PI - 0.9, s.a + Math.PI + 0.9); ctx.stroke(); }
  }

  // shadows first, then sprites sorted by y so lower things overlap higher things
  G.en.sort((a, b) => a.y - b.y);
  const vis = [];
  for (const e of G.en) {
    if (e.x < cx - 80 || e.x > cx + W + 80 || e.y < cy - 80 || e.y > cy + H + 80) continue;
    vis.push(e);
    shadow(e.x, e.y + e.r * 0.75, e.r * 0.95, e.r * 0.35);
  }
  shadow(p.x, p.y + 16, 15, 5);
  for (const e of vis) {
    const T = ETYPES[e.type], ph = clock * 9 + e.ph;
    if (T.boss) {
      ctx.fillStyle = `rgba(255,70,70,${0.12 + 0.06 * Math.sin(clock * 4)})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 16 + Math.sin(clock * 4) * 4, 0, 6.283); ctx.fill();
    }
    drawSpr(T.e, T.s, e.x, e.y + Math.sin(ph) * 2, e.f > 0 ? 1.25 : 1, e.x > p.x ? -1 : 1, 0, 1 + 0.06 * Math.sin(ph + 1.5));
  }

  // projectiles & weapon effects
  if (G.w.yarn) {
    const l = G.w.yarn.lvl, n = 1 + (l >= 2) + (l >= 4) + (l >= 5);
    for (let i = 0; i < n; i++) { const yp = yarnPos(i, n, l); drawSpr('🧶', 24, yp.x, yp.y, 1, 1, G.orbit * 3); }
  }
  for (const z of G.zaps) {
    const a = Math.max(0, z.t / 0.22);
    ctx.strokeStyle = `rgba(255,240,120,${a})`; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(z.x + z.ox, z.y - 320); ctx.lineTo(z.x + z.ox * 0.3, z.y - 120); ctx.lineTo(z.x, z.y); ctx.stroke();
    ctx.fillStyle = `rgba(255,240,120,${a * 0.5})`; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 6.283); ctx.fill();
  }
  for (const b of G.eb) {
    ctx.fillStyle = 'rgba(255,176,46,0.3)'; ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 6.283); ctx.fill();
  }
  for (const s of G.shots) {
    if (s.bone) drawSpr('🦴', 28, s.x, s.y, 1, 1, G.t * 14);
    else drawSpr('🐟', 22, s.x, s.y, 1, 1, s.a);
  }

  // player: squash & tilt while running, gentle breathing when idle
  if (!(p.inv > 0 && Math.floor(p.inv * 20) % 2 === 0)) {
    const sq = p.mv ? 1 + 0.07 * Math.sin(clock * 14) : 1 + 0.03 * Math.sin(clock * 3);
    drawSpr(C().icon, 36, p.x, p.y + (p.mv ? Math.sin(clock * 14) * -2 : 0), 1, p.face, p.mv ? Math.sin(clock * 14) * 0.1 : 0, sq);
  }
  if (p.hp < maxHp()) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(p.x - 25, p.y + 26, 50, 7, 3.5); ctx.fill();
    ctx.fillStyle = '#e24a4a'; rr(p.x - 25, p.y + 26, Math.max(7, 50 * Math.max(0, p.hp / maxHp())), 7, 3.5); ctx.fill();
  }

  // particles & damage numbers
  for (const q of G.parts) {
    const a = Math.min(1, q.t / 0.4);
    ctx.globalAlpha = a; ctx.fillStyle = q.c || '#8bd36a';
    ctx.beginPath(); ctx.arc(q.x, q.y, 2 + 2 * a, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const q of G.txt) {
    ctx.globalAlpha = Math.min(1, q.t * 3); ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + (13 + Math.min(10, q.v / 12)) + 'px system-ui';
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(q.v, q.x, q.y); ctx.fillText(q.v, q.x, q.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  vignette();

  // ── HUD ──
  const hpf = Math.max(0, p.hp / maxHp());
  if (hpf < 0.3) { ctx.fillStyle = `rgba(255,0,0,${0.07 + 0.06 * Math.sin(clock * 6)})`; ctx.fillRect(0, 0, W, H); }
  if (shake > 0.5) { ctx.fillStyle = `rgba(255,0,0,${shake / 40})`; ctx.fillRect(0, 0, W, H); }

  // XP bar
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, 9);
  const xg = ctx.createLinearGradient(0, 0, W, 0); xg.addColorStop(0, '#5fe3ff'); xg.addColorStop(1, '#7a8bff');
  ctx.fillStyle = xg; ctx.fillRect(0, 0, W * Math.min(1, p.xp / xpNeed()), 9);

  // level + HP
  const bwid = Math.min(200, Math.max(110, W / 2 - 70));
  pill(12, 18, 62, 28);
  ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.fillText('Lv ' + p.lvl, 43, 33);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(12, 52, bwid, 20, 10); ctx.fill();
  if (hpf > 0) {
    const hg = ctx.createLinearGradient(0, 52, 0, 72); hg.addColorStop(0, '#ff6b6b'); hg.addColorStop(1, '#c92f2f');
    ctx.fillStyle = hg; rr(12, 52, Math.max(20, bwid * hpf), 20, 10); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui';
  ctx.fillText('❤ ' + Math.ceil(p.hp) + ' / ' + maxHp(), 12 + bwid / 2, 62);

  // owned weapons + passives
  let hx = 12;
  for (const k in G.w) { iconBox(WEAPONS[k].icon, G.w[k].lvl, hx, 80, 34); hx += 38; }
  hx = 12;
  for (const k in G.ps) if (G.ps[k] > 0) { iconBox(PASSIVES[k].icon, G.ps[k], hx, 120, 28); hx += 32; }

  // timer + kills/coins
  pill(W / 2 - 48, 16, 96, 32);
  ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.fillText(fmtTime(G.t), W / 2, 33);
  const stat = '🥒 ' + G.kills + '   🪙 ' + G.runCoins;
  ctx.font = 'bold 16px system-ui';
  const sw = ctx.measureText(stat).width + 24;
  pill(W - 12 - sw, 16, sw, 32);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(stat, W - 24, 33);

  if (G.banner) {
    ctx.globalAlpha = Math.min(1, G.banner.t * 2);
    ctx.font = 'bold 32px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffe14a';
    strokeFill(G.banner.text, W / 2, H * 0.27);
    ctx.globalAlpha = 1;
  }

  const boss = G.en.find(e => ETYPES[e.type].boss);
  if (boss) {
    const bw2 = Math.min(360, W - 40), bx2 = W / 2 - bw2 / 2, bf = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(bx2 - 3, 54, bw2 + 6, 20, 10); ctx.fill();
    if (bf > 0) { ctx.fillStyle = ECOL[boss.type]; rr(bx2, 57, Math.max(14, bw2 * bf), 14, 7); ctx.fill(); }
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
    strokeFill(ETYPES[boss.type].name, W / 2, 78);
  }

  if (stick.on && state === 'play') {
    ctx.strokeStyle = '#fff5'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 50, 0, 6.283); ctx.stroke();
    ctx.fillStyle = '#fff6'; ctx.beginPath(); ctx.arc(stick.ox + stick.dx * 50, stick.oy + stick.dy * 50, 20, 0, 6.283); ctx.fill();
  }
}

// ── Main loop ──
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  clock += dt;
  if (state === 'play') update(dt);
  render();
  requestAnimationFrame(frame);
}
Ads.init();
showMenu();
requestAnimationFrame(frame);
