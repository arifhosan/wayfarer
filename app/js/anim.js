// All motion lives here (GSAP + ScrollTrigger + MotionPath). Everything degrades to static
// content when GSAP is unavailable or the user prefers reduced motion.
const Anim = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = () => !!window.gsap && !reduced;
  if (window.gsap) {
    if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
    if (window.MotionPathPlugin) gsap.registerPlugin(MotionPathPlugin);
  }
  const prevCounts = new Map();

  // ------------------------------------------------------------- landing globe
  let landingTl = null, arcTimer = null;
  function landing() {
    const svg = document.getElementById('world-dots');
    if (svg && window.GEO_COUNTRIES) {
      try {
        Geo.init();
        const W = 1000, H = 500, step = 2.4;
        const X = lng => (lng + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
        let dots = '';
        for (let lat = 80; lat > -58; lat -= step) for (let lng = -178; lng < 180; lng += step * 1.0) {
          if (Geo.country(lat, lng)) dots += `<circle cx="${X(lng).toFixed(1)}" cy="${Y(lat).toFixed(1)}" r="1.5"/>`;
        }
        svg.innerHTML = `<g class="dots">${dots}</g><g class="arcs"></g>`;
        const C = window.GEO_CITIES;
        const hubs = Array.from({ length: 120 }, (_, i) => [C.la[i], C.lo[i]]);
        const arcs = svg.querySelector('.arcs');
        const fire = () => {
          if (document.getElementById('landing').hidden) return;
          const a = hubs[Math.floor(Math.random() * hubs.length)], b = hubs[Math.floor(Math.random() * hubs.length)];
          const x1 = X(a[1]), y1 = Y(a[0]), x2 = X(b[1]), y2 = Y(b[0]);
          const dist = Math.hypot(x2 - x1, y2 - y1); if (dist < 60 || dist > 520) return;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - dist * 0.32;
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.innerHTML = `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" class="arc"/><circle r="3" class="plane"/><circle cx="${x1}" cy="${y1}" r="2.5" class="pin"/><circle cx="${x2}" cy="${y2}" r="2.5" class="pin"/>`;
          arcs.appendChild(g);
          const path = g.querySelector('path'), len = path.getTotalLength();
          gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
          const tl = gsap.timeline({ onComplete: () => g.remove() });
          tl.from(g.querySelectorAll('.pin'), { scale: 0, transformOrigin: 'center', duration: .4, stagger: .9, ease: 'back.out(3)' }, 0)
            .to(path, { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut' }, 0)
            .to(g.querySelector('.plane'), { duration: 1.6, ease: 'power2.inOut', motionPath: { path, align: path, alignOrigin: [0.5, 0.5] } }, 0)
            .to(g, { opacity: 0, duration: .8 }, '+=0.6');
        };
        if (on()) {
          gsap.from(svg.querySelectorAll('.dots circle'), { opacity: 0, duration: 1.2, stagger: { each: 0.0006, from: 'random' }, ease: 'power1.out' });
          arcTimer = setInterval(fire, 550);
        }
      } catch (e) { console.warn('landing globe', e); }
    }
    if (!on()) return;
    landingTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    landingTl
      .fromTo('.landing-inner .brand-big', { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: .6 })
      .fromTo('#landing h1 .w', { yPercent: 110, opacity: 0, rotate: 4 }, { yPercent: 0, opacity: 1, rotate: 0, duration: 1, stagger: .08 }, '-=.3')
      .fromTo('.landing-inner .lede', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, '-=.6')
      .fromTo('.landing-actions > *', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: .6, stagger: .1 }, '-=.4')
      .fromTo('.feature-chips span', { y: 12, opacity: 0, scale: .9 }, { y: 0, opacity: 1, scale: 1, duration: .4, stagger: .04 }, '-=.3')
      .fromTo('.landing-inner .how, .privacy', { opacity: 0 }, { opacity: 1, duration: .8, stagger: .1 }, '-=.2');
    gsap.to('.orb', { x: 'random(-80, 80)', y: 'random(-60, 60)', scale: 'random(.85, 1.2)', duration: 'random(6, 10)', ease: 'sine.inOut', repeat: -1, yoyo: true, repeatRefresh: true, stagger: .5 });
    gsap.to('.drop-icon', { y: -6, duration: 1.1, ease: 'sine.inOut', repeat: -1, yoyo: true });
  }

  function loadingStart() {
    if (!on()) return;
    gsap.to('.landing-actions, .feature-chips, .how', { opacity: .25, duration: .4 });
    gsap.from('#progress', { y: 10, opacity: 0, duration: .4 });
  }
  function loadingStop() {
    if (!on()) return;
    gsap.to('.landing-actions, .feature-chips, .how', { opacity: 1, duration: .4 });
  }

  function toApp(done) {
    clearInterval(arcTimer);
    if (!on()) { done(); return; }
    gsap.timeline()
      .to('.landing-inner', { y: -30, opacity: 0, duration: .5, ease: 'power2.in' })
      .to('#world-dots', { scale: 1.6, opacity: 0, duration: .8, ease: 'power2.in' }, 0)
      .to('#landing', { opacity: 0, duration: .3 }, '-=.2')
      .add(done);
  }

  function appIntro() {
    if (!on()) return;
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from('.topbar', { y: -70, opacity: 0, duration: .7 })
      .from('#years button', { y: -12, opacity: 0, duration: .4, stagger: .03 }, '-=.4')
      .from('.sidenav a', { x: -24, opacity: 0, duration: .45, stagger: .025 }, '-=.5');
    const bar = document.getElementById('scroll-progress');
    if (bar && window.ScrollTrigger) gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: .3 } });
    if (window.ScrollTrigger && window.ResizeObserver) {
      let t; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => ScrollTrigger.refresh(), 200); }).observe(document.getElementById('main'));
    }
  }

  // ------------------------------------------------------------- hero + counters
  function hero() {
    if (!on()) return;
    gsap.fromTo('#hero-title .w', { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: .9, stagger: .06, ease: 'power4.out' });
    gsap.fromTo(['#hero-range', '#hero-sub'], { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .7, stagger: .12, delay: .15, ease: 'power3.out' });
  }

  function formatCount(el, v) {
    const dec = +(el.dataset.dec || 0);
    el.textContent = v.toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function count(el) {
    const target = +el.dataset.count, key = el.dataset.key;
    const from = prevCounts.has(key) ? prevCounts.get(key) : 0;
    prevCounts.set(key, target);
    if (!on() || from === target) { formatCount(el, target); return; }
    const o = { v: from };
    gsap.to(o, { v: target, duration: 1.4, ease: 'power3.out', onUpdate: () => formatCount(el, o.v) });
  }

  // ------------------------------------------------------------- scroll reveals
  // IntersectionObserver instead of ScrollTrigger positions: layout keeps changing as charts,
  // maps and fonts load, and IO needs no measuring/refreshing.
  const inView = el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
  const below = el => el.getBoundingClientRect().top >= innerHeight;
  function whenVisible(el, fn, margin = '0px 0px -8% 0px') {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: margin });
    io.observe(el);
  }
  let revealIO = null;
  function revealer() {
    if (revealIO) return revealIO;
    revealIO = new IntersectionObserver(entries => {
      const hits = entries.filter(e => e.isIntersecting).map(e => e.target);
      if (!hits.length) return;
      hits.forEach(el => revealIO.unobserve(el));
      gsap.to(hits, { y: 0, opacity: 1, duration: .8, ease: 'power3.out', clearProps: 'transform,opacity', stagger: { each: .07 } });
    }, { rootMargin: '0px 0px -6% 0px' });
    return revealIO;
  }
  function refresh(root = document) {
    const counters = [...root.querySelectorAll('[data-count]:not([data-counted])')];
    counters.forEach(el => {
      el.dataset.counted = '1';
      if (!on() || inView(el)) { count(el); return; }
      formatCount(el, prevCounts.get(el.dataset.key) || 0);
      whenVisible(el, () => count(el));
    });
    if (!on()) return;
    const els = [...root.querySelectorAll('.sec-head, .card, .tile, .record, .wrap, .trip')].filter(el => !el.dataset.rv);
    els.forEach(el => { el.dataset.rv = '1'; });
    const visible = els.filter(inView);
    if (visible.length) gsap.fromTo(visible, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .6, stagger: .035, ease: 'power3.out', clearProps: 'transform,opacity' });
    const fresh = els.filter(below);
    if (!fresh.length) return;
    gsap.set(fresh, { y: 46, opacity: 0 });
    const io = revealer();
    fresh.forEach(el => io.observe(el));
  }

  function switchYear(run) {
    if (!on()) { run(); return; }
    gsap.to('#main', { opacity: .35, duration: .15, ease: 'power1.out', onComplete: () => {
      run();
      gsap.to('#main', { opacity: 1, duration: .35, ease: 'power2.out' });
    } });
  }

  // ------------------------------------------------------------- nav indicator
  function navTo(a) {
    const ind = document.getElementById('nav-ind');
    if (!ind || !a) return;
    const y = a.offsetTop, h = a.offsetHeight;
    if (on()) gsap.to(ind, { y, height: h, opacity: 1, duration: .45, ease: 'power3.out' });
    else Object.assign(ind.style, { transform: `translateY(${y}px)`, height: h + 'px', opacity: 1 });
  }

  // ------------------------------------------------------------- map paths
  // Draws SVG paths (Leaflet polylines rendered with L.svg) like a pen stroke.
  function drawPaths(layers, { stagger = .08, duration = 1.2, delay = 0, trigger } = {}) {
    const paths = layers.map(l => l._path).filter(Boolean);
    if (!on() || !paths.length) return;
    const go = () => paths.forEach((p, i) => {
      const len = p.getTotalLength ? p.getTotalLength() : 0;
      if (!len) return;
      const dashed = p.getAttribute('stroke-dasharray');
      if (dashed) { gsap.fromTo(p, { opacity: 0 }, { opacity: 1, duration: .6, delay: delay + i * stagger }); return; }
      gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration, delay: delay + i * stagger, ease: 'power2.inOut',
        onComplete: () => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; } });
    });
    if (trigger && !inView(trigger)) whenVisible(trigger, go, '0px 0px -25% 0px');
    else go();
  }
  function pop(els, delay = 0) {
    if (!on() || !els.length) return;
    gsap.fromTo(els, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .5, ease: 'back.out(2.5)', stagger: .03, delay, transformOrigin: 'center' });
  }

  // ------------------------------------------------------------- hover tilt
  function tilt(selector) {
    if (!on()) return;
    document.querySelectorAll(selector).forEach(el => {
      if (el.dataset.tilt) return; el.dataset.tilt = '1';
      gsap.set(el, { transformPerspective: 700 });
      const rx = gsap.quickTo(el, 'rotationX', { duration: .5, ease: 'power3' });
      const ry = gsap.quickTo(el, 'rotationY', { duration: .5, ease: 'power3' });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - .5) * 10);
        rx(-((e.clientY - r.top) / r.height - .5) * 10);
      });
      el.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  }

  function flash(el) {
    if (!on() || !el) return;
    gsap.fromTo(el, { boxShadow: '0 0 0 0 var(--accent)' }, { boxShadow: '0 0 0 6px transparent', duration: .8, ease: 'power2.out' });
  }

  return { on, landing, loadingStart, loadingStop, toApp, appIntro, hero, refresh, count, switchYear, navTo, drawPaths, pop, tilt, flash };
})();
