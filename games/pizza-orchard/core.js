'use strict';
// ───────────────────────── Pizza Orchard: core logic ─────────────────────────
// Pure game logic, no DOM. The UI (ui.js) and the balance simulator both use this.

const Farm = (() => {
  const MAX_PLOTS = 16, START_PLOTS = 3;
  const OFFLINE_CAP = 8 * 3600, OFFLINE_EFF = 0.5;
  const TAP_FRAC = 0.06;          // each tap on a growing crop skips 6% of its grow time
  const BOOST_LEN = 60, BOOST_CD = 90;
  const PRESTIGE_BASE = 2e6;      // coins earned in a run per "1 fork squared"
  const WATER_BONUS = 1.5;        // a farmer standing at a plot adds +150% growth speed to it
  const COMBO_WINDOW = 2.2;       // seconds to keep a hand-harvest combo alive
  const ORDER_MULT = [1.2, 2, 3.5], ORDER_SIZE = [1, 1.6, 2.6];   // daily orders: reward / size by tier
  const GOLD_MULT = 15;           // a golden crop pays this much on harvest
  const CROW_REWARD = 4;         // shooing a crow pays this many crop values (min 5 coins)

  const CROPS = [
    { id: 'carrot',   e: '🥕', name: 'Carrot',            value: 1,       grow: 2,   cost: 0 },
    { id: 'tomato',   e: '🍅', name: 'Tomato',            value: 4,       grow: 4,   cost: 60 },
    { id: 'pizza',    e: '🍕', name: 'Pizza Tree',        value: 18,      grow: 8,   cost: 700 },
    { id: 'burger',   e: '🍔', name: 'Burger Bush',       value: 85,      grow: 14,  cost: 9000 },
    { id: 'donut',    e: '🍩', name: 'Donut Vine',        value: 420,     grow: 24,  cost: 1.2e5 },
    { id: 'sushi',    e: '🍣', name: 'Sushi River',       value: 2300,    grow: 40,  cost: 2e6 },
    { id: 'taco',     e: '🌮', name: 'Taco Moon',         value: 15000,   grow: 70,  cost: 3.5e7 },
    { id: 'icecream', e: '🍦', name: 'Ice-Cream Volcano', value: 1e5,     grow: 120, cost: 6e8 },
    { id: 'cupcake',  e: '🧁', name: 'Cupcake Comet',     value: 7e5,     grow: 200, cost: 1e10 },
    { id: 'cosmic',   e: '🌌', name: 'Cosmic Pizza',      value: 5e6,     grow: 360, cost: 2e11 }
  ];

  const UPG = {
    grow:  { base: 25,  mult: 1.5, max: 40, name: 'Super Fertilizer', icon: '🧪', desc: '+12% growth speed' },
    yield: { base: 40,  mult: 1.6, max: 40, name: 'Bigger Harvest',   icon: '🌾', desc: '+25% crop value' },
    hands: { base: 120, mult: 2.1, max: 16, name: 'Farmhand',         icon: '🤖', desc: 'Automates 1 plot' }
  };

  const mkPlots = n => Array.from({ length: n }, () => ({ crop: null, t: 0, ready: false }));

  function newState() {
    return {
      v: 1, coins: 0, earnedRun: 0, earnedAll: 0, forks: 0, prestiges: 0, harvests: 0,
      plots: mkPlots(START_PLOTS), up: { grow: 0, yield: 0, hands: 0 },
      unlocked: 0, sel: 0, boostT: 0, boostCd: 0, goldenT: 25, golden: 0, lastSeen: Date.now(),
      combo: 0, comboT: 0,
      orders: { day: '', list: [], bonus: false }, shooed: 0,
      crowT: 50, digT: 40, events: []          // not saved
    };
  }

  // ── derived stats ──
  const growSpeed = S => 1 + 0.12 * S.up.grow;
  const yieldMul = S => 1 + 0.25 * S.up.yield;
  const forkMul = S => 1 + 0.15 * S.forks;
  const boostMul = S => (S.boostT > 0 ? 2 : 1);
  const valueOf = (S, i) => CROPS[i].value * yieldMul(S) * forkMul(S) * boostMul(S);
  const growTime = (S, i) => CROPS[i].grow / growSpeed(S);
  const handsActive = S => Math.min(S.up.hands, S.plots.length);
  const autoRate = S => handsActive(S) * valueOf(S, S.sel) / growTime(S, S.sel);
  // what the farm would make per second if every plot were tended all the time
  const potentialRate = S => S.plots.length * valueOf(S, S.sel) / growTime(S, S.sel);

  // ── costs ──
  const upCost = (k, lvl) => UPG[k].base * Math.pow(UPG[k].mult, lvl);
  const maxLevel = (S, k) => (k === 'hands' ? Math.min(UPG.hands.max, S.plots.length) : UPG[k].max);
  const plotCost = S => 30 * Math.pow(2.3, S.plots.length - START_PLOTS);

  // ── actions ──
  function earn(S, amt) { S.coins += amt; S.earnedRun += amt; S.earnedAll += amt; }

  function harvest(S, i) {
    const p = S.plots[i];
    if (p.crop === null || !p.ready) return 0;
    const amt = valueOf(S, p.crop) * (p.gold ? GOLD_MULT : 1);
    earn(S, amt);
    S.harvests++; bump(S, p.crop);
    p.crop = null; p.t = 0; p.ready = false; p.gold = false;
    return amt;
  }

  // ── buried treasure: dig up a glimmering spot for gold / a boost / a golden crop / a jackpot ──
  // rnd is injectable for tests. Returns {type, amt, plot}
  function digReward(S, rnd = Math.random) {
    const gold = Math.max(autoRate(S) * 45, valueOf(S, S.sel) * 15, 25), r = rnd();
    if (r < 0.04) { earn(S, gold * 6); return { type: 'jackpot', amt: gold * 6 }; }
    if (r < 0.24) { S.boostT = Math.max(S.boostT, 30); return { type: 'boost', amt: 30 }; }
    if (r < 0.40) {
      const cand = []; S.plots.forEach((p, i) => { if (p.crop !== null && !p.gold) cand.push(i); });
      if (cand.length) { const i = cand[Math.floor(rnd() * cand.length)]; S.plots[i].gold = true; return { type: 'golden', amt: GOLD_MULT, plot: i }; }
    }
    earn(S, gold); return { type: 'gold', amt: gold };
  }
  // ── daily orders: "harvest N of crop X today" for a coin bonus ──
  const baseValue = (S, i) => CROPS[i].value * yieldMul(S) * forkMul(S);   // boost not included
  const orderTarget = S => Math.min(3, S.unlocked + 1);
  // make sure today's orders exist (new day -> fresh list; newly unlocked crops add orders up to 3)
  function refreshOrders(S, day, rnd = Math.random) {
    const O = S.orders;
    if (O.day !== day) { O.day = day; O.list = []; O.bonus = false; }
    while (O.list.length < orderTarget(S)) {
      const pool = [];
      for (let c = Math.max(0, S.unlocked - 2); c <= S.unlocked; c++) if (!O.list.some(o => o.c === c)) pool.push(c);
      if (!pool.length) break;
      const c = pool[Math.floor(rnd() * pool.length)], tier = O.list.length;
      const need = Math.max(5, Math.round((6 + S.plots.length * 1.2) * ORDER_SIZE[tier]));
      O.list.push({ c, need, got: 0, tier, done: false, reward: 0 });
    }
    return O.list;
  }
  // called on every harvest of crop c
  function bump(S, c) {
    const O = S.orders;
    for (let k = 0; k < O.list.length; k++) {
      const o = O.list[k];
      if (o.done || o.c !== c) continue;
      o.got++;
      if (o.got >= o.need) {
        o.done = true; o.reward = o.need * baseValue(S, c) * ORDER_MULT[o.tier];
        earn(S, o.reward); S.events.push({ type: 'order', k, reward: o.reward });
        if (!O.bonus && O.list.length >= 3 && O.list.every(x => x.done)) {
          O.bonus = true; const b = O.list.reduce((a, x) => a + x.reward, 0) * 0.5;
          earn(S, b); S.events.push({ type: 'orderBonus', reward: b });
        }
      }
    }
  }

  // ── crows: land on a plot and freeze it until the farmer shoos them away ──
  const crowLand = (S, i) => { const p = S.plots[i]; if (!p || p.crow) return false; p.crow = true; return true; };
  function shoo(S, i) {
    const p = S.plots[i]; if (!p || !p.crow) return 0;
    p.crow = false; S.shooed++;
    const r = Math.max(5, baseValue(S, S.sel) * CROW_REWARD, autoRate(S) * 8);
    earn(S, r); return r;
  }
  const crowLeave = (S, i) => { const p = S.plots[i]; if (p) p.crow = false; };
  const maxCrows = S => (S.plots.length >= 8 ? 2 : 1);
  function plant(S, i) {
    const p = S.plots[i];
    if (p.crop !== null) return false;
    p.crop = S.sel; p.t = 0; p.ready = false;
    return true;
  }
  // what a tap does: plant / water / harvest. Returns {type, amt}
  function tap(S, i) {
    const p = S.plots[i];
    if (!p) return { type: 'none', amt: 0 };
    if (p.crop === null) { plant(S, i); return { type: 'plant', amt: 0 }; }
    if (p.ready) return { type: 'harvest', amt: harvest(S, i) };
    p.t += CROPS[p.crop].grow * TAP_FRAC;
    if (p.t >= CROPS[p.crop].grow) { p.t = CROPS[p.crop].grow; p.ready = true; }
    return { type: 'water', amt: 0 };
  }

  // ── the farmer: standing at a plot plants, waters and harvests it ──
  const comboMul = S => 1 + Math.min(1, 0.1 * Math.max(0, S.combo - 1));   // +10% per chained harvest, max x2
  // dt = seconds the farmer spent at this plot this frame. Returns {type, amt, combo}
  function farmerAct(S, i, dt) {
    const p = S.plots[i];
    if (!p) return { type: 'none', amt: 0 };
    if (p.crow) return { type: 'none', amt: 0 };      // a crow is sitting on it
    if (i < handsActive(S)) {
      // automated plot: the farmhand does the harvesting, the farmer only waters it
      if (p.crop !== null && !p.ready) p.t += dt * growSpeed(S) * WATER_BONUS;
      return { type: 'water', amt: 0 };
    }
    if (p.crop === null) { plant(S, i); return { type: 'plant', amt: 0 }; }
    if (p.ready) {
      S.combo++; S.comboT = COMBO_WINDOW;
      const amt = valueOf(S, p.crop) * comboMul(S) * (p.gold ? GOLD_MULT : 1);
      earn(S, amt); S.harvests++; bump(S, p.crop);
      p.crop = null; p.t = 0; p.ready = false; p.gold = false;
      return { type: 'harvest', amt, combo: S.combo };
    }
    p.t += dt * growSpeed(S) * WATER_BONUS;
    if (p.t >= CROPS[p.crop].grow) { p.t = CROPS[p.crop].grow; p.ready = true; }
    return { type: 'water', amt: 0 };
  }

  // advance the simulation. Returns {auto: coins auto-harvested, goldenDue: bool}
  function tick(S, dt) {
    let auto = 0;
    if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) { S.comboT = 0; S.combo = 0; } }
    if (S.boostT > 0) { S.boostT = Math.max(0, S.boostT - dt); if (S.boostT === 0) S.boostCd = BOOST_CD; }
    else if (S.boostCd > 0) S.boostCd = Math.max(0, S.boostCd - dt);
    S.goldenT -= dt; S.crowT -= dt; S.digT -= dt;

    const hands = handsActive(S), sp = growSpeed(S);
    for (let i = 0; i < S.plots.length; i++) {
      const p = S.plots[i];
      if (p.crow) continue;           // crow on the plot: nothing grows or gets harvested
      const isAuto = i < hands;
      if (p.crop === null) { if (!isAuto) continue; plant(S, i); }
      if (isAuto) {
        // carry leftover time across cycles so fast crops stay exact
        p.t += dt * sp;
        let guard = 0;
        while (p.crop !== null && p.t >= CROPS[p.crop].grow && guard++ < 10000) {
          const left = p.t - CROPS[p.crop].grow;
          p.ready = true;
          auto += harvest(S, i);
          plant(S, i);
          p.t = left;
        }
        if (guard >= 10000) p.t = 0;
      } else if (!p.ready) {
        p.t += dt * sp;
        if (p.t >= CROPS[p.crop].grow) { p.t = CROPS[p.crop].grow; p.ready = true; }
      }
    }
    return { auto, goldenDue: S.goldenT <= 0, crowDue: S.crowT <= 0, digDue: S.digT <= 0 };
  }

  // coins earned while away (automated plots only, reduced efficiency, capped)
  function offline(S, secs) {
    if (!(secs > 60)) return 0;
    const t = Math.min(secs, OFFLINE_CAP);
    const gain = autoRate(S) * t * OFFLINE_EFF;
    if (gain > 0) earn(S, gain);
    for (let i = handsActive(S); i < S.plots.length; i++) {
      const p = S.plots[i];
      if (p.crop !== null) { p.ready = true; p.t = CROPS[p.crop].grow; }
    }
    S.boostT = 0; S.boostCd = 0;
    return gain;
  }

  function buyUp(S, k, n) {
    let bought = 0;
    while (bought < n && S.up[k] < maxLevel(S, k)) {
      const c = upCost(k, S.up[k]);
      if (S.coins < c) break;
      S.coins -= c; S.up[k]++; bought++;
    }
    return bought;
  }
  // how many levels n would buy + their cost (for the button label). Always quotes at least the next level.
  function quoteUp(S, k, n) {
    let lvl = S.up[k], cost = 0, count = 0, coins = S.coins;
    const max = maxLevel(S, k);
    while (count < n && lvl < max) {
      const c = upCost(k, lvl);
      if (count > 0 && coins < c) break;
      if (count === 0 || coins >= c) { cost += c; coins -= c; lvl++; count++; } else break;
    }
    return { count, cost, maxed: S.up[k] >= max, afford: count > 0 && S.coins >= cost };
  }
  function buyPlot(S) {
    if (S.plots.length >= MAX_PLOTS) return false;
    const c = plotCost(S);
    if (S.coins < c) return false;
    S.coins -= c; S.plots.push({ crop: null, t: 0, ready: false });
    return true;
  }
  function unlockNext(S) {
    const i = S.unlocked + 1;
    if (i >= CROPS.length || S.coins < CROPS[i].cost) return false;
    S.coins -= CROPS[i].cost; S.unlocked = i; S.sel = i;
    return true;
  }
  function select(S, i) { if (i >= 0 && i <= S.unlocked) { S.sel = i; return true; } return false; }

  // ── boost / golden ──
  const boostCost = S => Math.max(100, autoRate(S) * 90);
  function startBoost(S) {
    if (S.boostT > 0 || S.boostCd > 0) return false;
    S.boostT = BOOST_LEN; return true;
  }
  const goldenReward = S => Math.max(autoRate(S) * 60, valueOf(S, S.sel) * 20, 25);
  function claimGolden(S) { const g = goldenReward(S); earn(S, g); S.golden++; S.goldenT = 50 + Math.random() * 50; return g; }

  // ── prestige ──
  const forkGain = S => Math.floor(Math.sqrt(S.earnedRun / PRESTIGE_BASE));
  function prestige(S) {
    const g = forkGain(S);
    if (g < 1) return 0;
    S.forks += g; S.prestiges++;
    S.coins = 0; S.earnedRun = 0; S.plots = mkPlots(START_PLOTS);
    S.up = { grow: 0, yield: 0, hands: 0 }; S.unlocked = 0; S.sel = 0;
    S.boostT = 0; S.boostCd = 0; S.goldenT = 25; S.combo = 0; S.comboT = 0; S.crowT = 50; S.digT = 40;
    S.orders.list = S.orders.list.filter(o => o.done);      // unfinished orders vanish; finished ones can't be farmed again today
    return g;
  }

  // ── save / load ──
  function sanitize(raw) {
    const S = newState();
    if (!raw || typeof raw !== 'object') return S;
    const num = (v, d, lo = 0, hi = Infinity) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    S.coins = num(raw.coins, 0); S.earnedRun = num(raw.earnedRun, 0); S.earnedAll = num(raw.earnedAll, 0);
    S.forks = Math.floor(num(raw.forks, 0)); S.prestiges = Math.floor(num(raw.prestiges, 0));
    S.harvests = Math.floor(num(raw.harvests, 0)); S.golden = Math.floor(num(raw.golden, 0));
    S.unlocked = Math.floor(num(raw.unlocked, 0, 0, CROPS.length - 1));
    S.sel = Math.floor(num(raw.sel, 0, 0, S.unlocked));
    S.boostT = num(raw.boostT, 0, 0, BOOST_LEN); S.boostCd = num(raw.boostCd, 0, 0, BOOST_CD);
    S.goldenT = num(raw.goldenT, 25, 0, 200); S.lastSeen = num(raw.lastSeen, Date.now());
    const n = Math.floor(num(Array.isArray(raw.plots) ? raw.plots.length : START_PLOTS, START_PLOTS, START_PLOTS, MAX_PLOTS));
    S.plots = mkPlots(n);
    if (Array.isArray(raw.plots)) raw.plots.slice(0, n).forEach((p, i) => {
      if (p && Number.isInteger(p.crop) && p.crop >= 0 && p.crop <= S.unlocked) {
        S.plots[i].crop = p.crop; S.plots[i].t = num(p.t, 0, 0, CROPS[p.crop].grow); S.plots[i].ready = !!p.ready || S.plots[i].t >= CROPS[p.crop].grow;
      }
    });
    S.shooed = Math.floor(num(raw.shooed, 0));
    if (raw.orders && typeof raw.orders === 'object' && Array.isArray(raw.orders.list)) {
      S.orders.day = typeof raw.orders.day === 'string' ? raw.orders.day.slice(0, 10) : '';
      S.orders.bonus = !!raw.orders.bonus;
      S.orders.list = raw.orders.list.filter(o => o && Number.isInteger(o.c) && o.c >= 0 && o.c < CROPS.length && Number.isInteger(o.tier) && o.tier >= 0 && o.tier < 3)
        .slice(0, 3).map(o => { const need = Math.floor(num(o.need, 10, 1, 100000)); return { c: o.c, tier: o.tier, need, got: Math.floor(num(o.got, 0, 0, need)), done: !!o.done, reward: num(o.reward, 0) }; });
    }
    if (raw.up) for (const k in S.up) S.up[k] = Math.floor(num(raw.up[k], 0, 0, UPG[k].max));
    S.up.hands = Math.min(S.up.hands, S.plots.length);
    return S;
  }

  return {
    CROPS, UPG, MAX_PLOTS, START_PLOTS, PRESTIGE_BASE, OFFLINE_CAP, OFFLINE_EFF, BOOST_LEN, BOOST_CD,
    WATER_BONUS, COMBO_WINDOW, ORDER_MULT, farmerAct, comboMul, refreshOrders, baseValue, digReward, GOLD_MULT, crowLand, shoo, crowLeave, maxCrows,
    newState, earn, growSpeed, yieldMul, forkMul, boostMul, valueOf, growTime, handsActive, autoRate, potentialRate,
    upCost, maxLevel, plotCost, harvest, plant, tap, tick, offline, buyUp, quoteUp, buyPlot, unlockNext, select,
    boostCost, startBoost, goldenReward, claimGolden, forkGain, prestige, sanitize
  };
})();

if (typeof module !== 'undefined') module.exports = Farm;
