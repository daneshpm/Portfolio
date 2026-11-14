(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };

  // Email is assembled at runtime so it isn't sitting in the HTML for scrapers.
  const EMAIL = ['danesh12112002', 'gmail.com'].join('@');
  const LINKS = {
    github: 'https://github.com/daneshpm',
    linkedin: 'https://www.linkedin.com/in/daneshpm',
    leetcode: 'https://leetcode.com/daneshpm',
    hackerrank: 'https://www.hackerrank.com/daneshpm',
  };

  /* ---------------- Smooth scroll (Lenis, optional) ---------------- */
  let lenis = null;
  function initLenis() {
    if (!window.Lenis || reduce) return;
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  function goTo(id, duration = 1.4) {
    const el = typeof id === 'string' ? $(id) : id;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: -10, duration });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute('data-copy')) return;
    const id = a.getAttribute('href');
    if (id.length > 1 && $(id)) { e.preventDefault(); goTo(id); history.replaceState(null, '', id); }
  });

  /* ---------------- Toast ---------------- */
  const toastEl = $('#toast');
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  window.__toast = toast;
  async function copyEmail() {
    try { await navigator.clipboard.writeText(EMAIL); toast('Email copied ✔'); }
    catch (_) { toast(EMAIL); }
  }

  /* ---------------- Boot sequence ---------------- */
  const boot = $('#boot');
  let heroStarted = false;
  function startHero() {
    if (heroStarted) return;
    heroStarted = true;
    document.documentElement.classList.add('ready');
    revealInit();
    startTerminalIntro();
  }
  async function runBoot() {
    const seen = safe(() => sessionStorage.getItem('booted'));
    if (reduce || seen) { boot.remove(); startHero(); return; }
    const pre = $('#bootText');
    const lines = [
      '$ ./launch --target wormhole',
      '> mission #1 initiated by danesh',
      '✔ build ........... java 21 · spring boot',
      '✔ scan ............ 0 critical',
      '✔ trajectory ...... locked',
      '✔ shields ......... up',
      '▸ igniting engines…',
    ];
    let skipped = false;
    const skip = () => { skipped = true; };
    boot.addEventListener('click', skip);
    window.addEventListener('keydown', skip, { once: true });
    for (const line of lines) {
      if (skipped) break;
      pre.textContent += line + '\n';
      await sleep(line.startsWith('$') ? 380 : 210);
    }
    if (!skipped) await sleep(380);
    safe(() => sessionStorage.setItem('booted', '1'));
    boot.classList.add('done');
    startHero();
    setTimeout(() => boot.remove(), 800);
  }

  /* ---------------- Reveal on scroll, counters, scramble ---------------- */
  const GLYPHS = '!<>-_\\/[]{}=+*^?#01';
  function scramble(el) {
    if (reduce) return;
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    const nodes = []; // keep <em> markup: scramble text nodes only
    const walk = (n) => n.childNodes.forEach((c) => (c.nodeType === 3 ? nodes.push(c) : walk(c)));
    walk(el);
    const originals = nodes.map((n) => n.textContent);
    const t0 = performance.now();
    const dur = 800;
    const tick = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      if (p >= 1) { nodes.forEach((n, i) => (n.textContent = originals[i])); return; }
      nodes.forEach((n, i) => {
        const o = originals[i];
        const reveal = Math.floor(p * o.length);
        n.textContent = o.split('').map((ch, k) => (ch === ' ' || k < reveal ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function countUp(el) {
    const target = +el.dataset.count;
    const suffix = el.dataset.suffix || '';
    const dec = +el.dataset.decimals || 0;
    if (reduce) { el.textContent = target.toFixed(dec) + suffix; return; }
    const t0 = performance.now();
    const dur = 1400;
    const step = (t) => {
      const p = clamp((t - t0) / dur, 0, 1);
      const v = (1 - Math.pow(1 - p, 3)) * target;
      el.textContent = (dec ? v.toFixed(dec) : Math.round(v)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function revealInit() {
    // stagger children of grouped containers
    $$('[data-stagger]').forEach((g) => $$('.reveal, .stat', g).forEach((c, i) => c.style.setProperty('--d', (i % 4) * 0.09 + 's')));
    // Scroll-position based (not IntersectionObserver): a block that was scrolled past
    // between frames is still revealed, so there are never blank gaps.
    pendingReveals = $$('.reveal');
    revealPass();
  }
  let pendingReveals = [];
  function showReveal(el) {
    el.classList.add('in');
    if (el.hasAttribute('data-scramble')) scramble(el);
    $$('[data-count]', el).forEach(countUp);
    if (el.id === 'deployBar') runDeploy();
  }
  function revealPass() {
    if (!pendingReveals.length) return;
    const limit = innerHeight * 0.94;
    pendingReveals = pendingReveals.filter((el) => {
      if (el.getBoundingClientRect().top < limit) { showReveal(el); return false; }
      return true;
    });
  }

  /* ---------------- Pipeline rail ---------------- */
  const railItems = $$('#rail li');
  const railSections = railItems.map((li) => $('#' + li.dataset.target));
  const STATE_LABEL = { queued: 'queued', running: 'running…', passed: 'passed ✔' };
  let railRaf = 0;
  function updateRail() {
    railRaf = 0;
    revealPass();
    const vh = innerHeight;
    let idx = 0;
    railSections.forEach((s, i) => { if (s.getBoundingClientRect().top <= vh * 0.5) idx = i; });
    const doc = document.documentElement;
    const maxScroll = doc.scrollHeight - vh;
    const atEnd = maxScroll - scrollY < 80;
    railItems.forEach((li, i) => {
      let st = i < idx ? 'passed' : i === idx ? 'running' : 'queued';
      if (atEnd && i === idx && i === railItems.length - 1) st = 'passed';
      if (li.dataset.state !== st) {
        li.dataset.state = st;
        $('.st', li).textContent = i === railItems.length - 1 && st === 'passed' ? 'live ✔' : STATE_LABEL[st];
      }
    });
    doc.style.setProperty('--p', clamp(scrollY / Math.max(1, maxScroll), 0, 1).toFixed(4));
  }
  const onScroll = () => { if (!railRaf) railRaf = requestAnimationFrame(updateRail); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);

  /* ---------------- Deploy bar ---------------- */
  let deployed = false;
  function runDeploy() {
    if (deployed) return;
    deployed = true;
    const bar = $('#deployBar');
    const status = $('#deployStatus');
    const mail = $('#mailLink');
    if (reduce) { bar.classList.add('go'); status.innerHTML = 'deployed to production · <b>LIVE ✔</b> · ready for new commits'; return; }
    bar.classList.add('go');
    const t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / 2200, 0, 1);
      status.textContent = 'deploying to production… ' + Math.round(p * 100) + '%';
      if (p < 1) requestAnimationFrame(step);
      else status.innerHTML = 'deployed to production · <b>LIVE ✔</b> · ready for new commits';
    };
    requestAnimationFrame(step);
    mail.classList.add('in');
  }

  /* ---------------- Contact ---------------- */
  function initContact() {
    const mail = $('#mailLink');
    mail.textContent = EMAIL;
    mail.addEventListener('click', (e) => { e.preventDefault(); copyEmail(); });
    $('#mailForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = `${f.get('msg')}\n\n— ${f.get('name')} (${f.get('email')})`;
      location.href = `mailto:${EMAIL}?subject=${encodeURIComponent('Hello Danesh — from your portfolio')}&body=${encodeURIComponent(body)}`;
      toast('Opening your email app…');
    });
  }

  /* ---------------- Terminal ---------------- */
  const termBody = $('#termBody');
  const termInput = $('#termInput');
  let userTyped = false;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function print(html, cls = '') {
    const d = document.createElement('div');
    d.className = 'line ' + cls;
    d.innerHTML = html;
    termBody.appendChild(d);
    termBody.scrollTop = termBody.scrollHeight;
  }
  const COMMANDS = {
    help: () => print(
      '<span class="info">commands</span>\n' +
      '  whoami        who am i\n  skills        tech stack\n  projects      what I\'ve built\n  experience    where I\'ve worked\n  contact       get in touch\n  ls / cat      poke around\n  pipeline      run the pipeline\n  play          play my games\n  warp          jump through the wormhole\n  clear         clean the screen\n  <span class="mute">…and a few secrets. Try sudo.</span>'),
    whoami: () => print('<span class="ok">danesh</span> — backend &amp; devops engineer · Bengaluru, India\nJava · Spring Boot · Docker · Kubernetes · Jenkins\nB.E. AI &amp; ML (VTU) · 9.04 CGPA · 3 internships'),
    skills: () => print(
      '<span class="info">languages</span>  Java, Python, JavaScript, TypeScript, SQL\n' +
      '<span class="info">backend</span>    Spring Boot, Spring Security, JPA, FastAPI\n' +
      '<span class="info">devops</span>     Docker, Kubernetes, Jenkins, SonarQube, Trivy, ZAP\n' +
      '<span class="info">cloud</span>      AWS EC2, Linux, Vercel\n' +
      '<span class="info">data</span>       MySQL, PostgreSQL, MongoDB, Redis'),
    projects: () => { print(
      '<span class="info">01</span> SlotFlow               Next.js · FastAPI · Postgres\n' +
      '<span class="info">02</span> ModuleForge            visual module builder <span class="ok">[live]</span>\n' +
      '<span class="info">03</span> DevSecOps Pipeline     Jenkins · K8s · Trivy\n' +
      '<span class="info">04</span> Network Security MLOps MLflow · Docker\n' +
      '<span class="info">05</span> Expense Tracker API    Java 21 · Spring Boot\n' +
      '<span class="info">06</span> Employee Mgmt · JWT    Spring Security · React\n' +
      '<span class="info">07</span> AI Resume Screening    Gemini · Streamlit\n' +
      '<span class="info">08</span> Cucumber Panic         browser game <span class="ok">[type: play]</span>\n' +
      '<span class="info">09</span> Pizza Orchard         idle farm game <span class="ok">[type: play pizza]</span>\n<span class="mute">scrolling to projects…</span>'); setTimeout(() => goTo('#projects'), 500); },
    experience: () => print(
      '<span class="warn">Sep–Dec 2024</span>  DevOps Intern @ IBM\n<span class="warn">Oct–Nov 2023</span>  ML Intern @ PRAGYAN AI\n<span class="warn">Oct–Nov 2022</span>  ML with Python Intern @ COMSOFT'),
    contact: () => { print(
      `email   <a href="#contact">${esc(EMAIL)}</a>\ngithub  <a href="${LINKS.github}" target="_blank" rel="noopener">github.com/daneshpm</a>\nlinkedin <a href="${LINKS.linkedin}" target="_blank" rel="noopener">linkedin.com/in/daneshpm</a>`); setTimeout(() => goTo('#contact'), 500); },
    ls: () => print('about.md   skills.json   contact.txt   projects/   <span class="mute">.secrets</span>'),
    cat: (a) => {
      const f = (a[0] || '').toLowerCase();
      if (f === 'about.md') return COMMANDS.whoami();
      if (f === 'skills.json') return COMMANDS.skills();
      if (f === 'contact.txt') return COMMANDS.contact();
      if (f === '.secrets') return print('<span class="warn">permission denied.</span> hint: sudo hire danesh');
      print(a.length ? `cat: ${esc(a[0])}: No such file` : 'usage: cat &lt;file&gt;');
    },
    warp: () => { print('<span class="ok">engaging warp drive…</span> hold on tight 🚀'); setTimeout(() => goTo('#contact', 6), 500); },
    pipeline: () => runPipelineOutput(),
    play: (a) => {
      const pizza = /pizza|orchard|farm/i.test((a || []).join(' '));
      print(pizza ? 'launching <span class="ok">Pizza Orchard</span>… 🍕' : 'launching <span class="ok">Cucumber Panic</span>… 🐱🥒 <span class="mute">(try: play pizza)</span>');
      setTimeout(() => openGame(pizza ? 'pizza-orchard' : 'cucumber-panic'), 400);
    },
    game: (a) => COMMANDS.play(a),
    clear: () => { termBody.innerHTML = ''; },
    sudo: async (a) => {
      const cmd = a.join(' ').toLowerCase();
      if (cmd.startsWith('hire')) {
        print('[sudo] password for recruiter: ********');
        await sleep(600);
        print('<span class="ok">✔ permission granted.</span> offer letter drafted… just kidding. Email me!');
        confetti();
        setTimeout(() => goTo('#contact'), 900);
      } else print(`sudo: ${esc(cmd || 'what')}: command not found. try <span class="info">sudo hire danesh</span>`);
    },
    rm: () => print('<span class="bad">rm: read-only file system.</span> nice try 😄'),
    exit: () => print('there is no escape. try <span class="info">contact</span> instead.'),
  };
  async function runPipelineOutput() {
    const steps = [
      ['checkout', 'ok'], ['build', 'java 21 · spring boot'], ['scan', '0 critical · 0 high'],
      ['test', 'all green'], ['deploy', 'live'],
    ];
    for (const [k, v] of steps) { print(`<span class="warn">▸</span> ${k.padEnd(9, '.')}<span class="ok"> ${v}</span>`); if (!reduce) await sleep(220); }
  }
  async function startTerminalIntro() {
    const typeLine = async (text) => {
      const d = document.createElement('div');
      d.className = 'line';
      d.innerHTML = '<span class="ok">$</span> <span></span><i class="caret"></i>';
      termBody.appendChild(d);
      const span = d.querySelector('span:nth-child(2)');
      for (const ch of text) { if (userTyped) { d.remove(); return false; } span.textContent += ch; await sleep(reduce ? 0 : 45); }
      d.querySelector('.caret').remove();
      return true;
    };
    if (!(await typeLine('./pipeline run --target danesh'))) return;
    await runPipelineOutput();
    if (userTyped) return;
    print('\n<span class="mute">type <span class="info">help</span> to explore, or press Ctrl+K</span>');
  }
  const history = []; let hIdx = 0;
  $('#termForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = termInput.value.trim();
    termInput.value = '';
    if (!raw) return;
    userTyped = true;
    history.push(raw); hIdx = history.length;
    print(`<span class="ok">$</span> ${esc(raw)}`);
    const [cmd, ...args] = raw.split(/\s+/);
    const fn = COMMANDS[cmd.toLowerCase()];
    if (fn) await fn(args);
    else print(`zsh: command not found: ${esc(cmd)} — try <span class="info">help</span>`);
  });
  termInput.addEventListener('focus', () => { userTyped = true; });
  termInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); hIdx = Math.max(0, hIdx - 1); termInput.value = history[hIdx] || ''; }
    if (e.key === 'ArrowDown') { e.preventDefault(); hIdx = Math.min(history.length, hIdx + 1); termInput.value = history[hIdx] || ''; }
    e.stopPropagation(); // keep the palette shortcut from firing while typing
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); }
  });

  /* ---------------- Command palette ---------------- */
  const pal = $('#palette'), palInput = $('#palInput'), palList = $('#palList');
  const ACTIONS = [
    { t: 'Warp through the wormhole to Contact', k: 'warp jump wormhole space fast', hint: 'warp', run: () => goTo('#contact', 6) },
    { t: 'Go to Commit (top)', k: 'home hero', run: () => goTo('#home') },
    { t: 'Go to Build — about & experience', k: 'about experience internship ibm', run: () => goTo('#about') },
    { t: 'Go to Scan — skills', k: 'skills stack tech java docker', run: () => goTo('#skills') },
    { t: 'Go to Test — projects', k: 'projects work portfolio', run: () => goTo('#projects') },
    { t: 'Go to Deploy — contact', k: 'contact hire email', run: () => goTo('#contact') },
    { t: 'Copy email address', k: 'mail copy', hint: 'clipboard', run: copyEmail },
    { t: 'Send me an email', k: 'mail write', hint: 'mailto', run: () => { location.href = 'mailto:' + EMAIL; } },
    { t: 'Open GitHub', k: 'github code repos', hint: '↗', run: () => open(LINKS.github, '_blank', 'noopener') },
    { t: 'Open LinkedIn', k: 'linkedin', hint: '↗', run: () => open(LINKS.linkedin, '_blank', 'noopener') },
    { t: 'Open LeetCode', k: 'leetcode dsa', hint: '↗', run: () => open(LINKS.leetcode, '_blank', 'noopener') },
    { t: 'Open HackerRank', k: 'hackerrank', hint: '↗', run: () => open(LINKS.hackerrank, '_blank', 'noopener') },
    { t: 'Play Cucumber Panic (browser game)', k: 'game play cat cucumber fun', hint: 'game', run: () => openGame('cucumber-panic') },
    { t: 'Play Pizza Orchard (idle farm game)', k: 'game play pizza farm idle fun', hint: 'game', run: () => openGame('pizza-orchard') },
    { t: 'sudo hire danesh', k: 'hire confetti party', hint: 'secret', run: () => { confetti(); toast('Permission granted ✔'); goTo('#contact'); } },
  ];
  let palItems = [], palSel = 0, lastFocus = null;
  function renderPal(q = '') {
    const s = q.toLowerCase().trim();
    palItems = ACTIONS.filter((a) => !s || (a.t + ' ' + a.k).toLowerCase().includes(s));
    palSel = 0;
    palList.innerHTML = palItems.length
      ? palItems.map((a, i) => `<li role="option" data-i="${i}" aria-selected="${i === 0}">${esc(a.t)}<span>${esc(a.hint || '')}</span></li>`).join('')
      : '<li class="empty">no matching command</li>';
  }
  function selectPal(i) {
    if (!palItems.length) return;
    palSel = (i + palItems.length) % palItems.length;
    $$('li', palList).forEach((li, n) => li.setAttribute('aria-selected', n === palSel));
    $$('li', palList)[palSel].scrollIntoView({ block: 'nearest' });
  }
  function openPalette() {
    lastFocus = document.activeElement;
    pal.hidden = false; renderPal(); palInput.value = ''; palInput.focus();
    if (lenis) lenis.stop();
  }
  function closePalette() {
    pal.hidden = true;
    if (lenis) lenis.start();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function runPal(i) { const a = palItems[i]; if (!a) return; closePalette(); setTimeout(a.run, 120); }
  $('#openPalette').addEventListener('click', openPalette);
  pal.addEventListener('click', (e) => {
    if (e.target === pal) return closePalette();
    const li = e.target.closest('li[data-i]');
    if (li) runPal(+li.dataset.i);
  });
  palInput.addEventListener('input', () => renderPal(palInput.value));
  palInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectPal(palSel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectPal(palSel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
  });
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
    else if (e.key === 'Escape' && !pal.hidden) closePalette();
    else if (e.key === 'Escape' && !gameModal.hidden) closeGame();
    else if (e.key === '/' && pal.hidden && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
  });

  /* ---------------- Game modal ---------------- */
  const gameModal = $('#gameModal'), gameFrame = $('#gameFrame');
  let gameFocus = null;
  const GAMES = {
    'cucumber-panic': { title: '🐱 Cucumber Panic', hint: 'WASD / arrows / drag to move · attacks are automatic · P pause · M mute', src: 'games/cucumber-panic/index.html' },
    'pizza-orchard': { title: '🍕 Pizza Orchard', hint: 'WASD / arrows / tap & drag to move · stand on soil to plant, water and harvest', src: 'games/pizza-orchard/index.html' },
  };
  function openGame(id) {
    const g = GAMES[id] || GAMES['cucumber-panic'];
    gameFocus = document.activeElement;
    $('#gameTitle').textContent = g.title;
    $('#gameHint').textContent = g.hint;
    gameFrame.title = g.title;
    gameModal.setAttribute('aria-label', g.title + ', a browser game');
    gameFrame.src = g.src;
    gameModal.hidden = false;
    if (lenis) lenis.stop();
    document.body.style.overflow = 'hidden';
    gameFrame.addEventListener('load', () => { try { gameFrame.contentWindow.focus(); } catch (_) {} }, { once: true });
    setTimeout(() => { try { gameFrame.contentWindow.focus(); } catch (_) {} }, 300);
  }
  function closeGame() {
    gameModal.hidden = true;
    gameFrame.removeAttribute('src'); // stops the game loop and audio
    document.body.style.overflow = '';
    if (lenis) lenis.start();
    if (gameFocus && gameFocus.focus) gameFocus.focus();
  }
  $('#gameClose').addEventListener('click', closeGame);
  gameModal.addEventListener('click', (e) => { if (e.target === gameModal) closeGame(); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-play]'); if (b) openGame(b.dataset.play); });

  /* ---------------- Cursor, magnet, tilt, spotlight ---------------- */
  function initPointerFx() {
    if (!finePointer || reduce) return;
    const dot = $('.cursor-dot'), ring = $('.cursor-ring');
    let x = 0, y = 0, rx = 0, ry = 0, shown = false;
    addEventListener('pointermove', (e) => {
      x = e.clientX; y = e.clientY;
      if (!shown) { shown = true; rx = x; ry = y; document.documentElement.classList.add('has-cursor'); }
      dot.style.transform = `translate(${x}px,${y}px)`;
    }, { passive: true });
    document.addEventListener('pointerleave', () => document.documentElement.classList.remove('has-cursor'));
    const loop = () => { rx += (x - rx) * 0.18; ry += (y - ry) * 0.18; ring.style.transform = `translate(${rx}px,${ry}px)`; requestAnimationFrame(loop); };
    loop();
    document.addEventListener('pointerover', (e) => ring.classList.toggle('hover', !!e.target.closest('a, button, input, textarea, .card, .chip, .entry')));

    $$('.mag').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
    $$('[data-tilt]').forEach((c) => {
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        c.style.setProperty('--mx', px * 100 + '%'); c.style.setProperty('--my', py * 100 + '%');
        c.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 5}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-3px)`;
      });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; });
    });
  }

  /* ---------------- Confetti ---------------- */
  function confetti() {
    if (reduce) return;
    const cv = document.createElement('canvas');
    cv.id = 'confetti'; cv.width = innerWidth; cv.height = innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const colors = ['#3dffa0', '#5cc8ff', '#ffb547', '#ff5c7a', '#ffffff'];
    const ps = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2, y: innerHeight * 0.55, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4,
      s: Math.random() * 7 + 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0],
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ps.forEach((p) => { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      if (++f < 150) requestAnimationFrame(tick); else cv.remove();
    })();
  }

  /* ---------------- Init ---------------- */
  initLenis();
  initContact();
  initPointerFx();
  updateRail();
  runBoot();
})();
