/* Event Horizon: a scroll-driven space journey.
 * One full-screen WebGL fragment shader draws the sky, a lensed black hole with an accretion disk,
 * a wormhole tunnel and a calm "new universe". Scroll position (J: 0..1) drives everything.
 * Real page text stays in the HTML; this layer is decoration and can be switched off (calm mode).
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };

  const root = document.documentElement;
  const canvas = $('#bg');
  const toggle = $('#fxToggle');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  const sections = ['home', 'about', 'skills', 'projects', 'contact'].map((id) => document.getElementById(id));
  if (!canvas || sections.some((s) => !s)) return;

  /* ------------------------------------------------------------------ journey keyframes
     J = (section index + progress inside section) / 5
     [J, holeRadius, holeX, holeY (landscape), holeX, holeY (portrait), tunnel, exit, dim] */
  const KF = [
    [0.00, 0.110, 0.80, 0.86, 0.50, 0.84, 0.0, 0.0, 1.00],
    [0.15, 0.120, 0.82, 0.78, 0.50, 0.84, 0.0, 0.0, 0.90],
    [0.25, 0.125, 0.80, 0.62, 0.50, 0.82, 0.0, 0.0, 0.62],
    [0.45, 0.200, 0.80, 0.58, 0.50, 0.78, 0.0, 0.0, 0.55],
    [0.58, 0.300, 0.72, 0.55, 0.50, 0.70, 0.0, 0.0, 0.55],
    [0.615, 0.800, 0.50, 0.50, 0.50, 0.50, 0.6, 0.0, 0.55],
    [0.65, 1.800, 0.50, 0.50, 0.50, 0.50, 1.0, 0.0, 0.62],
    [0.78, 3.000, 0.50, 0.50, 0.50, 0.50, 1.0, 0.0, 0.60],
    [0.86, 3.000, 0.50, 0.50, 0.50, 0.50, 1.0, 0.8, 0.80],
    [0.93, 3.000, 0.50, 0.50, 0.50, 0.50, 1.0, 1.0, 0.92],
    [1.00, 3.000, 0.50, 0.50, 0.50, 0.50, 1.0, 1.0, 0.92],
  ];
  function sample(J) {
    let i = 0;
    while (i < KF.length - 2 && J > KF[i + 1][0]) i++;
    const a = KF[i], b = KF[i + 1];
    const t = smooth(clamp((J - a[0]) / (b[0] - a[0]), 0, 1));
    return a.map((v, k) => lerp(v, b[k], t));
  }

  /* ------------------------------------------------------------------ shaders */
  const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes, uHole;
uniform float uTime, uJ, uRs, uTunnel, uExit, uDim, uAsp;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a*noise(p); p = p*2.03 + vec2(7.1, 3.3); a *= 0.5; }
  return v;
}
vec3 starLayer(vec2 p, float scale, float seed, float density){
  vec2 g = p*scale + seed*17.3;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float h = hash(id + seed);
  vec2 o = (vec2(hash(id+1.7+seed), hash(id+3.1+seed)) - 0.5)*0.6;
  float d = length(f - o);
  float tw = 0.65 + 0.35*sin(uTime*(1.0+h*3.0) + h*40.0);
  float b = step(density, h) * smoothstep(0.10, 0.0, d) * tw;
  vec3 tint = mix(vec3(0.65,0.8,1.0), vec3(1.0,0.82,0.62), fract(h*91.7));
  return tint*b;
}
vec3 starfield(vec2 p){
  return starLayer(p, 14.0, 1.0, 0.90) + starLayer(p, 28.0, 2.0, 0.93)*0.8 + starLayer(p, 55.0, 3.0, 0.95)*0.6;
}
vec3 nebula(vec2 p){
  float n = fbm(p*1.4 + vec2(uTime*0.01, 0.0));
  float m = fbm(p*2.2 - 3.7);
  vec3 c = mix(vec3(0.10,0.04,0.25), vec3(0.02,0.18,0.30), m);
  return c * smoothstep(0.35, 0.9, n) * 0.9;
}
vec3 tunnel(vec2 q){
  float r = length(q) + 1e-4;
  float a = atan(q.y, q.x);
  float z = 0.35/r + uTime*0.6 + uJ*26.0;
  float rings = pow(0.5 + 0.5*sin(z*7.5), 6.0) * smoothstep(0.03, 0.18, r);
  float streak = fbm(vec2(a*3.0 + z*0.3, z*1.5));
  float spokes = pow(0.5 + 0.5*sin(a*12.0 + z*1.5), 8.0)*0.5;
  vec3 c1 = vec3(0.05, 0.80, 1.0), c2 = vec3(0.45, 0.18, 1.0), c3 = vec3(1.0, 0.50, 0.10);
  vec3 base = mix(c2, c1, 0.5 + 0.5*sin(z*0.7));
  base = mix(base, c3, smoothstep(0.6, 1.0, streak)*0.7);
  float fade = smoothstep(0.0, 0.5, r);
  vec3 col = base*(rings*0.85 + streak*0.30 + spokes*1.1) * fade * 1.15;
  col += vec3(1.0, 0.95, 0.85) * exp(-r*r*14.0) * (0.25 + uExit);
  return col;
}
vec3 calmWorld(vec2 uv, vec2 p){
  vec3 sky = mix(vec3(0.02,0.04,0.12), vec3(0.10,0.20,0.40), pow(1.0-uv.y, 1.6));
  sky += vec3(0.32,0.14,0.42) * smoothstep(0.75, 0.0, length((uv-vec2(0.2,0.85))*vec2(uAsp,1.0)))*0.5;
  sky += nebula(p*0.8 + vec2(3.0,1.0))*0.8;
  sky += starfield(p + vec2(uJ*0.2, 0.0))*0.9;
  vec2 q = (uv - vec2(0.5, -1.55)) * vec2(uAsp, 1.0);
  float rp = length(q);
  float edge = rp - 2.0;
  float body = 1.0 - smoothstep(-0.004, 0.004, edge);
  vec3 surf = mix(vec3(0.01,0.05,0.09), vec3(0.04,0.18,0.24), fbm(q*3.0 + 4.0));
  float rim = exp(-abs(edge)*22.0);
  vec3 atmos = mix(vec3(0.25,0.85,1.0), vec3(1.0,0.7,0.35), smoothstep(0.4, -0.6, q.x)) * rim * 1.1;
  sky = mix(sky, surf, body);
  return sky + atmos;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 pc = (uv - 0.5) * vec2(uAsp, 1.0);
  vec2 p = (uv - uHole) * vec2(uAsp, 1.0);
  float r = length(p) + 1e-5;
  float rs = uRs;

  float k = rs*rs*2.0;
  vec2 src = p - (p/r)*(k/r);
  vec2 bgp = src + uHole*vec2(uAsp,1.0) + vec2(uTime*0.004, uJ*1.2);
  vec3 col = starfield(bgp) + nebula(bgp*0.7);

  float inside = 1.0 - smoothstep(rs*0.985, rs, r);
  float diskOn = 1.0 - smoothstep(0.7, 1.3, rs);

  if (diskOn > 0.001) {
    float tilt = 0.2;
    vec2 dp = vec2(p.x, p.y/tilt);
    float dr = length(dp) + 1e-5;
    float inner = rs*1.25, outer = rs*3.8;
    float ang = atan(dp.y, dp.x);
    float band = smoothstep(inner, inner + rs*0.35, dr) * (1.0 - smoothstep(outer*0.55, outer, dr));
    float n = fbm(vec2(dr/rs*3.0, ang*2.0 + (uTime*1.6)/(dr/rs + 0.4)));
    float dop = 1.0 - 0.5*(dp.x/dr);
    float heat = smoothstep(outer*0.7, inner, dr);
    vec3 hot = mix(vec3(0.9,0.25,0.06), vec3(1.0,0.78,0.38), heat);
    hot = mix(hot, vec3(1.0,0.96,0.88), smoothstep(0.7, 1.0, heat));
    vec3 disk = hot * band * (0.35 + 1.3*n) * dop * 1.6;

    float arcR = sqrt(k)*1.02;
    float arc = exp(-pow((r - arcR)/(rs*0.20), 2.0));
    float arcAng = pow(abs(p.y)/r, 1.2);
    float swirl = 0.6 + 0.8*fbm(vec2(atan(p.y, p.x)*3.0 + uTime*0.8, r/rs*2.0));
    vec3 arcCol = vec3(1.0, 0.68, 0.30) * arc * (0.25 + 0.9*arcAng) * swirl;
    float ring = exp(-pow((r - rs*1.03)/(rs*0.045), 2.0))*1.8;
    float glow = exp(-pow(r/(rs*2.6), 2.0))*0.25;

    col *= (1.0 - inside);
    float front = step(p.y, 0.0);
    col += disk * mix(1.0 - inside, 1.0, front) * diskOn;
    col += (arcCol + vec3(1.0,0.85,0.6)*ring + vec3(1.0,0.5,0.15)*glow) * (1.0 - inside) * diskOn;
  } else {
    col *= (1.0 - inside);
  }

  if (uTunnel > 0.001 && inside > 0.001) {
    col += tunnel(p/rs) * inside * uTunnel;
  }

  if (uExit > 0.001) {
    vec3 calm = calmWorld(uv, pc);
    col = mix(col, calm, smoothstep(0.55, 1.0, uExit));
    col += vec3(1.0,0.93,0.8) * exp(-dot(pc,pc)*3.0) * sin(3.14159*clamp(uExit,0.0,1.0)) * 1.4;
  }

  float vig = 1.0 - 0.5*smoothstep(0.45, 1.15, length(pc));
  col *= vig * uDim;
  col = 1.0 - exp(-col*1.25);
  col = pow(col, vec3(0.95));
  gl_FragColor = vec4(col, 1.0);
}`;

  /* ------------------------------------------------------------------ state */
  let gl = null, prog = null, loc = {};
  let running = false, raf = 0, last = 0, frame = 0, emaDt = 16, slowSince = 0;
  const qs = new URLSearchParams(location.search);          // ?fx=force&scale=0.4 lets you test without auto-throttling
  const FORCE = qs.get('fx') === 'force';
  let scale = parseFloat(qs.get('scale')) || (isMobile ? 0.5 : 0.7);
  const MIN_SCALE = 0.35;
  let Jtarget = 0, Jcur = 0, t0 = performance.now();
  let mouseX = 0.5, mouseY = 0.5;
  let enabled = false;

  function initGL() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'default' });
    if (!gl) return false;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('link:', gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    ['uRes', 'uHole', 'uTime', 'uJ', 'uRs', 'uTunnel', 'uExit', 'uDim', 'uAsp'].forEach((n) => (loc[n] = gl.getUniformLocation(prog, n)));
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setEnabled(false, true); });
    return true;
  }

  function resize() {
    if (!gl) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(2, Math.floor(innerWidth * dpr * scale));
    canvas.height = Math.max(2, Math.floor(innerHeight * dpr * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /* ------------------------------------------------------------------ layout cache (transform-proof) */
  let layout = []; // { el, kind, left, top, w, h, i }
  function docPos(el) {
    let x = 0, y = 0, n = el;
    while (n && n !== document.body) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y };
  }
  function buildLayout() {
    layout = [];
    const add = (el, kind, i) => {
      const p = docPos(el);
      layout.push({ el, kind, left: p.x, top: p.y, w: el.offsetWidth, h: el.offsetHeight, i });
    };
    ['home', 'about', 'skills'].forEach((id) => Array.from(document.getElementById(id).children).forEach((c, i) => add(c, 'suck', i)));
    const em = $$('#projects .card, #projects .tests, #contact .big-mail, #contact .form, #contact .socials');
    em.forEach((el, i) => add(el, 'emerge', i));
  }
  function clearFx() {
    layout.forEach(({ el }) => { el.style.scale = ''; el.style.rotate = ''; el.style.translate = ''; el.style.transformOrigin = ''; el.style.visibility = ''; });
  }

  /* ------------------------------------------------------------------ scroll to journey */
  function computeJ() {
    const vh = innerHeight;
    const maxScroll = Math.max(1, root.scrollHeight - vh);
    const pos = scrollY + vh * 0.5;
    const tops = sections.map((s) => s.offsetTop);
    let i = 0;
    for (let k = 0; k < tops.length; k++) if (pos >= tops[k]) i = k;
    const end = i < tops.length - 1 ? tops[i + 1] : maxScroll + vh * 0.5;
    const t = clamp((pos - tops[i]) / Math.max(1, end - tops[i]), 0, 1);
    return (i + t) / sections.length;
  }

  /* ------------------------------------------------------------------ DOM effects: pulled in, then emerging */
  function applyDom(state) {
    const vw = innerWidth, vh = innerHeight;
    const portrait = vh > vw;
    const hx = (portrait ? state[4] : state[2]) * vw;
    const hy = (1 - (portrait ? state[5] : state[3])) * vh;
    for (const L of layout) {
      const top = L.top - scrollY, bottom = top + L.h;
      const el = L.el;
      if (L.kind === 'suck') {
        // Only the last stretch before a block leaves the top edge: anything still being read stays untouched.
        const zone = clamp(vh * 0.16, 90, 150);
        const t = clamp((zone - bottom) / zone, 0, 1);
        if (t <= 0.001) {
          if (el.style.scale) { el.style.scale = ''; el.style.rotate = ''; el.style.transformOrigin = ''; el.style.visibility = ''; }
          continue;
        }
        if (t >= 0.995) { el.style.visibility = 'hidden'; continue; } // fully swallowed by the hole
        const e = Math.pow(t, 1.3);
        el.style.visibility = '';
        el.style.transformOrigin = (hx - L.left) + 'px ' + (hy - top) + 'px';
        el.style.scale = String(Math.max(0.02, 1 - 0.99 * e));
        el.style.rotate = (-40 * e).toFixed(1) + 'deg';
      } else {
        const t = clamp((top - vh * 0.38) / (vh * 0.6), 0, 1);
        if (t <= 0.001 || top > vh * 1.4) {
          if (el.style.scale) { el.style.scale = ''; el.style.rotate = ''; el.style.translate = ''; }
          continue;
        }
        const cx = L.left + L.w / 2, cy = top + L.h / 2;
        el.style.scale = String(1 - 0.4 * t);
        el.style.translate = ((vw / 2 - cx) * t * 0.4).toFixed(1) + 'px ' + ((vh / 2 - cy) * t * 0.3).toFixed(1) + 'px';
        el.style.rotate = ((L.i % 2 ? 1 : -1) * t * 6).toFixed(2) + 'deg';
      }
    }
  }

  /* ------------------------------------------------------------------ HUD */
  const hudPhase = $('#hudPhase'), hudDist = $('#hudDist'), hudVel = $('#hudVel');
  const PHASES = ['LAUNCH', 'ORBIT', 'APPROACH', 'WORMHOLE', 'LANDING'];
  function updateHud(J) {
    if (!hudPhase) return;
    const phase = J >= 0.93 ? 'NEW UNIVERSE' : PHASES[Math.min(4, Math.floor(J * 5))];
    hudPhase.textContent = phase;
    hudDist.textContent = J < 0.65 ? (Math.max(0, 1 - J / 0.65) * 42.0).toFixed(1) + ' AU' : J < 0.9 ? 'INSIDE' : 'ARRIVED';
    const v = J < 0.7 ? 0.05 + 0.6 * smooth(J / 0.7) : J < 0.9 ? 0.99 : 0.0;
    hudVel.textContent = v.toFixed(2) + 'c';
  }

  /* ------------------------------------------------------------------ loop */
  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (document.hidden) return;
    frame++;
    if (isMobile && frame % 2) return; // 30 fps on phones

    const dt = Math.min(100, now - last || 16); last = now;
    emaDt = lerp(emaDt, dt / (isMobile ? 2 : 1), 0.08);
    if (!FORCE && emaDt > 30 && frame > 12) {
      if (!slowSince) slowSince = now;
      if (now - slowSince > 1000) {
        slowSince = 0;
        if (scale > MIN_SCALE) { scale = Math.max(MIN_SCALE, scale - 0.1); resize(); emaDt = 20; }
        else if (now - t0 > 5000 && emaDt > 55) { setEnabled(false, true, 'Effects paused to save battery. Toggle ✦ to bring them back.'); return; }
      }
    } else slowSince = 0;

    Jtarget = computeJ();
    Jcur = lerp(Jcur, Jtarget, 1 - Math.exp(-dt * 0.006)); // frame-rate independent easing (~0.17s)
    if (Math.abs(Jcur - Jtarget) < 0.0004) Jcur = Jtarget;
    const s = sample(Jcur);
    const portrait = innerHeight > innerWidth;
    const hx = (portrait ? s[4] : s[2]) + (mouseX - 0.5) * 0.018;
    const hy = (portrait ? s[5] : s[3]) - (mouseY - 0.5) * 0.018;

    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(loc.uHole, hx, hy);
    gl.uniform1f(loc.uTime, (now - t0) / 1000);
    gl.uniform1f(loc.uJ, Jcur);
    gl.uniform1f(loc.uRs, portrait && s[1] < 1.2 ? s[1] * 0.85 : s[1]);
    gl.uniform1f(loc.uTunnel, s[6]);
    gl.uniform1f(loc.uExit, s[7]);
    gl.uniform1f(loc.uDim, s[8]);
    gl.uniform1f(loc.uAsp, canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    applyDom(s);
    if (frame % 6 === 0) updateHud(Jcur);
  }

  function setEnabled(on, silent, msg) {
    enabled = on;
    if (on) {
      if (!gl && !initGL()) { root.classList.add('no-gl'); enabled = false; if (toggle) toggle.hidden = true; return; }
      root.classList.remove('calm');
      canvas.style.display = '';
      resize(); buildLayout();
      if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(draw); }
    } else {
      running = false; cancelAnimationFrame(raf);
      root.classList.add('calm');
      canvas.style.display = 'none';
      clearFx();
    }
    if (toggle) { toggle.setAttribute('aria-pressed', String(on)); toggle.innerHTML = '✦<span class="fx-text"> effects: ' + (on ? 'on' : 'off') + '</span>'; }
    if (!silent) safe(() => localStorage.setItem('fx', on ? 'on' : 'off'));
    if (msg && window.__toast) window.__toast(msg);
  }

  /* ------------------------------------------------------------------ init */
  const saved = safe(() => localStorage.getItem('fx'));
  const startOn = saved ? saved === 'on' : !reduceMotion;
  if (toggle) toggle.addEventListener('click', () => setEnabled(!enabled));
  addEventListener('resize', () => { if (!enabled) return; resize(); buildLayout(); });
  addEventListener('load', () => { if (enabled) buildLayout(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (enabled) buildLayout(); }).observe(document.body);
  addEventListener('pointermove', (e) => { mouseX = e.clientX / innerWidth; mouseY = e.clientY / innerHeight; }, { passive: true });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  setEnabled(startOn, true);
})();
