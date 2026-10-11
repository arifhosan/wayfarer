// Shareable achievement card rendered on a <canvas> and exported as PNG.
// Deliberately contains only totals and achievements: no places, home city, routes or dates.
const Share = (() => {
  const FORMATS = { post: [1080, 1350], story: [1080, 1920] };
  const THEMES = {
    night: { bg: ['#0e0e0d', '#121a24'], orbs: ['rgba(57,135,229,.35)', 'rgba(25,158,112,.22)'], text: '#f0efec', muted: '#9a998f', accent: '#5598e7', card: 'rgba(255,255,255,.05)', cardLine: 'rgba(255,255,255,.08)', dot: 'rgba(240,239,236,.13)', on: '#5598e7' },
    aurora: { bg: ['#0d1b3d', '#3a1f6b'], orbs: ['rgba(27,175,122,.40)', 'rgba(232,123,164,.30)'], text: '#ffffff', muted: 'rgba(255,255,255,.66)', accent: '#7fe0c0', card: 'rgba(255,255,255,.08)', cardLine: 'rgba(255,255,255,.12)', dot: 'rgba(255,255,255,.16)', on: '#7fe0c0' },
    paper: { bg: ['#f6f4ee', '#ece9e0'], orbs: ['rgba(42,120,214,.16)', 'rgba(235,104,52,.12)'], text: '#111110', muted: '#6b6a64', accent: '#2a78d6', card: 'rgba(255,255,255,.75)', cardLine: 'rgba(0,0,0,.07)', dot: 'rgba(17,17,16,.12)', on: '#2a78d6' },
  };
  const opts = { period: 'all', format: 'post', theme: 'night', countries: true };
  const cache = new Map();
  let dots = null, blob = null;
  const SERIF = '"Instrument Serif", Georgia, serif';
  const SANS = 'Inter, system-ui, "Segoe UI", sans-serif';
  const FLAGS = '"Twemoji Country Flags", "Segoe UI Emoji", "Apple Color Emoji", sans-serif';

  const statsFor = p => { if (!cache.has(p)) cache.set(p, Stats.compute(M, p)); return cache.get(p); };

  // ---------------------------------------------------------------- achievements
  function badges(s) {
    const km = s.totalDist / 1000;
    const newPlaces = Object.values(s.newPlacesByMonth).reduce((a, b) => a + b, 0);
    const list = [
      { icon: '🌍', name: 'Globetrotter', v: s.countryList.length, tiers: [3, 5, 10, 20, 30, 50], txt: v => `${v} countries` },
      { icon: '✈️', name: 'Frequent flyer', v: s.flights.length, tiers: [3, 10, 25, 50, 100], txt: v => `${v} flights` },
      { icon: '🌐', name: 'Around the world', v: km / 40075, tiers: [1, 2, 5, 10, 20], txt: v => `${fmt.n(v, 1)}× the Earth` },
      { icon: '🌙', name: 'Moonshot', v: km / 384400, tiers: [.1, .25, .5, 1], txt: v => `${fmt.n(v * 100)}% of the way to the Moon` },
      { icon: '🚆', name: 'Rail rider', v: s.modes.train.n, tiers: [25, 100, 250, 500, 1000], txt: v => `${fmt.n(v)} train rides` },
      { icon: '🚶', name: 'Long walker', v: s.modes.walk.dist / 1000, tiers: [100, 500, 1000, 2500, 5000], txt: v => `${fmt.n(v)} km on foot` },
      { icon: '🚲', name: 'Pedal power', v: s.modes.cycle.dist / 1000, tiers: [100, 500, 1000, 2500, 5000], txt: v => `${fmt.n(v)} km cycled` },
      { icon: '🔥', name: 'On a streak', v: s.streaks.walk.len || 0, tiers: [7, 14, 30, 60, 100], txt: v => `${v}-day walking streak` },
      { icon: '🧭', name: 'Explorer', v: newPlaces, tiers: [50, 100, 250, 500, 1000, 2000], txt: v => `${fmt.n(v)} new places` },
      { icon: '🗺️', name: 'Continental', v: s.continents.size, tiers: [2, 3, 4, 5, 6], txt: v => `${v} continents` },
      { icon: '🏙️', name: 'City hopper', v: s.cities.length, tiers: [25, 50, 100, 200, 400], txt: v => `${fmt.n(v)} cities` },
      { icon: '⛴️', name: 'Seafarer', v: s.modes.boat.n, tiers: [5, 10, 25, 50], txt: v => `${v} boat trips` },
      { icon: '🚌', name: 'Bus regular', v: s.modes.bus.n, tiers: [100, 500, 1000, 2500, 5000], txt: v => `${fmt.n(v)} bus rides` },
    ];
    return list.map(b => {
      const tier = b.tiers.filter(t => b.v >= t).length;
      return { ...b, tier, score: tier / b.tiers.length + (tier ? b.v / b.tiers[tier - 1] / 100 : 0) };
    }).filter(b => b.tier > 0).sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------- drawing helpers
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function text(c, str, x, y, font, color, align = 'left', spacing = 0) {
    c.font = font; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
    if ('letterSpacing' in c) c.letterSpacing = spacing + 'px';
    c.fillText(str, x, y);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    return c.measureText(str).width;
  }
  function fit(c, str, font, maxW) { c.font = font; let s = str; while (c.measureText(s).width > maxW && s.length > 3) s = s.slice(0, -2) + '…'; return s; }

  function worldDots() {
    if (dots) return dots;
    dots = [];
    const step = 2.25;
    for (let lat = 78; lat > -56; lat -= step) for (let lng = -178; lng < 180; lng += step) {
      const cc = Geo.country(lat, lng);
      if (cc) dots.push([lng, lat, cc]);
    }
    return dots;
  }
  function drawMap(c, x, y, w, h, visited, T) {
    const s = Math.min(w / 356, h / 134), mw = 356 * s, mh = 134 * s;
    const ox = x + (w - mw) / 2, oy = y + (h - mh) / 2;
    const r = s * .78;
    const on = [];
    c.fillStyle = T.dot;
    for (const [lng, lat, cc] of worldDots()) {
      const px = ox + (lng + 178) * s, py = oy + (78 - lat) * s;
      if (visited.has(cc)) { on.push([px, py]); continue; }
      c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
    }
    c.save(); c.fillStyle = T.on; c.shadowColor = T.on; c.shadowBlur = r * 4;
    for (const [px, py] of on) { c.beginPath(); c.arc(px, py, r * 1.08, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }
  function background(c, W, H, T) {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const orb = (x, y, r, col) => { const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = rg; c.fillRect(0, 0, W, H); };
    orb(W * .92, H * .05, W * .7, T.orbs[0]);
    orb(W * .02, H * .98, W * .65, T.orbs[1]);
  }
  function logo(c, x, y, r) {
    const cols = ['#2a78d6', '#1baf7a', '#eda100', '#eb6834'];
    cols.forEach((col, i) => { c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, i * Math.PI / 2 - Math.PI / 2, (i + 1) * Math.PI / 2 - Math.PI / 2); c.closePath(); c.fillStyle = col; c.fill(); });
  }

  async function fontsReady() {
    try {
      await Promise.all([
        document.fonts.load(`400 100px ${SERIF}`), document.fonts.load(`italic 400 100px ${SERIF}`),
        document.fonts.load(`700 50px ${SANS}`), document.fonts.load(`600 24px ${SANS}`), document.fonts.load(`400 24px ${SANS}`),
        document.fonts.load(`40px ${FLAGS}`, '🇩🇪'),
      ]);
    } catch (e) { /* fall back to system fonts */ }
  }

  // ---------------------------------------------------------------- the card
  async function draw(canvas) {
    await fontsReady();
    const s = statsFor(opts.period), T = THEMES[opts.theme];
    const [W, H] = FORMATS[opts.format], story = opts.format === 'story';
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    background(c, W, H, T);
    const P = 84, inner = W - 2 * P;
    const km = s.totalDist / 1000;
    const years = [...new Set(s.days.map(d => d.y))];
    const range = opts.period === 'all' ? (years.length > 1 ? `${years[0]} — ${years[years.length - 1]}` : String(years[0] || '')) : String(opts.period);

    const newPlaces = Object.values(s.newPlacesByMonth).reduce((a, b) => a + b, 0);
    const earned = badges(s).slice(0, story ? 6 : 3);
    const cc = opts.countries ? s.countryList.map(x => x.cc).filter(x => x && x.length === 2) : [];
    const gap = 16;
    const emoji = (str, x, y, size, font) => { c.font = `${size}px ${font}`; c.fillStyle = '#000'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(str, x, y); };
    const fitSize = (str, weight, size, family, maxW) => { let z = size; c.font = `${weight} ${z}px ${family}`; while (c.measureText(str).width > maxW && z > 18) { z -= 2; c.font = `${weight} ${z}px ${family}`; } return z; };

    // ---- top block (fixed)
    const L = story
      ? { brand: 150, eyebrow: 240, title: 330, titleSize: 104, hero: 575, heroSize: 230, unit: 52, sub: 645, subSize: 32 }
      : { brand: 112, eyebrow: 162, title: 240, titleSize: 90, hero: 410, heroSize: 172, unit: 42, sub: 462, subSize: 28 };
    logo(c, P + 13, L.brand - 11, 13);
    text(c, 'Wayfarer', P + 38, L.brand, `700 30px ${SANS}`, T.text);
    text(c, opts.period === 'all' ? 'ALL TIME' : 'YEAR IN REVIEW', W - P, L.brand, `600 22px ${SANS}`, T.muted, 'right', 4);
    text(c, opts.period === 'all' ? range : `${fmt.n(s.tracked)} DAYS TRACKED`, P, L.eyebrow, `600 24px ${SANS}`, T.muted, 'left', 5);
    const t1 = opts.period === 'all' ? 'My journey ' : `My ${opts.period} `, t2 = opts.period === 'all' ? 'so far.' : 'in motion.';
    const w1 = text(c, t1, P, L.title, `400 ${L.titleSize}px ${SERIF}`, T.text);
    text(c, t2, P + w1, L.title, `italic 400 ${L.titleSize}px ${SERIF}`, T.accent);
    const hero = fmt.n(km);
    const hz = fitSize(hero, 400, L.heroSize, SERIF, inner - 120);
    const hw = text(c, hero, P - 6, L.hero, `400 ${hz}px ${SERIF}`, T.text);
    text(c, 'km', P + hw + 10, L.hero, `500 ${L.unit}px ${SANS}`, T.muted);
    const earth = km / 40075;
    const sub = `${earth >= 1 ? fmt.n(earth, 1) + '× around the Earth' : fmt.n(earth * 100) + '% of the way around the Earth'}  ·  ${fmt.n(s.moveMs / 3600000)} hours on the move`;
    const sz = fitSize(sub, 400, L.subSize, SANS, inner);
    text(c, sub, P, L.sub, `400 ${sz}px ${SANS}`, T.muted);

    // ---- bottom-up layout: footer, achievements, stats, flags; the map takes what is left
    const footerY = H - (story ? 88 : 60);
    text(c, 'Made with Wayfarer', P, footerY, `600 24px ${SANS}`, T.text);
    text(c, 'arifhosan.me/wayfarer', W - P, footerY, `400 24px ${SANS}`, T.muted, 'right');

    const bw = (inner - 2 * gap) / 3, bh = story ? 140 : 124;
    const achRows = Math.ceil(earned.length / 3);
    const achH = achRows ? 42 + achRows * bh + (achRows - 1) * gap : 0;
    const achTop = footerY - (story ? 54 : 40) - achH;
    if (achRows) {
      text(c, 'ACHIEVEMENTS', P, achTop + 22, `600 22px ${SANS}`, T.muted, 'left', 4);
      earned.forEach((b, i) => {
        const bx = P + (i % 3) * (bw + gap), by = achTop + 42 + Math.floor(i / 3) * (bh + gap);
        rr(c, bx, by, bw, bh, 22); c.fillStyle = T.card; c.fill(); c.strokeStyle = T.cardLine; c.lineWidth = 1.5; c.stroke();
        emoji(b.icon, bx + 22, by + (story ? 54 : 50), story ? 38 : 34, '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif');
        const stars = '★'.repeat(b.tier) + '☆'.repeat(Math.max(0, Math.min(6, b.tiers.length) - b.tier));
        text(c, stars, bx + bw - 22, by + (story ? 46 : 42), `400 ${story ? 22 : 19}px ${SANS}`, T.accent, 'right');
        const nz = fitSize(b.name, 700, story ? 30 : 26, SANS, bw - 44);
        text(c, b.name, bx + 22, by + (story ? 96 : 86), `700 ${nz}px ${SANS}`, T.text);
        const vz = fitSize(b.txt(b.v), 400, story ? 23 : 20, SANS, bw - 44);
        text(c, b.txt(b.v), bx + 22, by + (story ? 126 : 112), `400 ${vz}px ${SANS}`, T.muted);
      });
    }

    const ch = story ? 130 : 108;
    const statsTop = achTop - (story ? 40 : 30) - (2 * ch + gap);
    const cells = [
      ['Countries', fmt.n(s.countryList.length)], ['Cities', fmt.n(s.cities.length)], ['Flights', fmt.n(s.flights.length)],
      ['Train rides', fmt.n(s.modes.train.n)], ['Walked', fmt.n(s.modes.walk.dist / 1000) + ' km'], ['New places', fmt.n(newPlaces)],
    ];
    const cw = (inner - 2 * gap) / 3;
    cells.forEach(([label, val], i) => {
      const cx = P + (i % 3) * (cw + gap), cy = statsTop + Math.floor(i / 3) * (ch + gap);
      rr(c, cx, cy, cw, ch, 22); c.fillStyle = T.card; c.fill(); c.strokeStyle = T.cardLine; c.lineWidth = 1.5; c.stroke();
      const vz = fitSize(val, 700, story ? 54 : 46, SANS, cw - 48);
      text(c, val, cx + 26, cy + (story ? 72 : 60), `700 ${vz}px ${SANS}`, T.text);
      text(c, label, cx + 26, cy + (story ? 108 : 90), `500 ${story ? 24 : 21}px ${SANS}`, T.muted);
    });

    let flagsTop = statsTop;
    if (cc.length) {
      const fs = story ? 44 : 34, fg = story ? 12 : 9, per = Math.floor((inner + fg) / (fs + fg));
      const max = per * (story ? 2 : 1);
      const shown = cc.length > max ? cc.slice(0, max - 1) : cc;
      const rows = Math.ceil(Math.min(cc.length, max) / per);
      flagsTop = statsTop - (story ? 34 : 26) - rows * (fs + fg) + fg;
      shown.forEach((code, i) => emoji(Geo.flag(code), P + (i % per) * (fs + fg), flagsTop + Math.floor(i / per) * (fs + fg) + fs * .86, fs, FLAGS));
      if (cc.length > shown.length) {
        const i = shown.length;
        text(c, `+${cc.length - shown.length}`, P + (i % per) * (fs + fg) + 2, flagsTop + Math.floor(i / per) * (fs + fg) + fs * .74, `600 ${Math.round(fs * .55)}px ${SANS}`, T.muted);
      }
    }

    const mapTop = L.sub + (story ? 34 : 24), mapH = flagsTop - (story ? 26 : 18) - mapTop;
    if (mapH > 80) drawMap(c, P - 24, mapTop, inner + 48, mapH, new Set(cc), T);

    blob = null;
    return canvas;
  }

  // ---------------------------------------------------------------- dialog
  const fileName = () => `wayfarer-${opts.period === 'all' ? 'all-time' : opts.period}-${opts.format}.png`;
  const getBlob = canvas => blob ? Promise.resolve(blob) : new Promise(res => canvas.toBlob(b => { blob = b; res(b); }, 'image/png'));
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    const dlg = $('#share-dlg'), canvas = $('#share-canvas');
    const redraw = () => draw(canvas);
    $('#share-close').onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    $('#share-period').onchange = e => { opts.period = e.target.value === 'all' ? 'all' : +e.target.value; redraw(); };
    seg('share-format', m => { opts.format = m; redraw(); });
    seg('share-theme', m => { opts.theme = m; redraw(); });
    $('#share-countries').onchange = e => { opts.countries = e.target.checked; redraw(); };
    const flash = (btn, msg) => { const old = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = old; }, 1600); };
    $('#share-download').onclick = async () => {
      const b = await getBlob(canvas);
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const nativeBtn = $('#share-native');
    nativeBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] }));
    nativeBtn.onclick = async () => {
      const b = await getBlob(canvas);
      try { await navigator.share({ files: [new File([b], fileName(), { type: 'image/png' })], title: 'My Wayfarer card' }); } catch (e) { /* cancelled */ }
    };
    const copyBtn = $('#share-copy');
    copyBtn.hidden = !(navigator.clipboard && window.ClipboardItem);
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': getBlob(canvas) })]); flash(copyBtn, '✓ Copied'); }
      catch (e) { flash(copyBtn, 'Copy not allowed'); }
    };
  }
  async function open(period) {
    wire();
    cache.clear();
    opts.period = period ?? F;
    const sel = $('#share-period');
    sel.innerHTML = `<option value="all">All time</option>` + [...M.years].reverse().map(y => `<option value="${y}">${y}</option>`).join('');
    sel.value = String(opts.period);
    const dlg = $('#share-dlg');
    dlg.showModal();
    // animate the contents, never the <dialog> itself: tweening the dialog drops it out of the modal top layer
    if (Anim.on()) gsap.fromTo(['#share-dlg .share-head', '#share-dlg .share-body'], { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .06, ease: 'power3.out', clearProps: 'transform,opacity' });
    await draw($('#share-canvas'));
    if (Anim.on()) gsap.fromTo('#share-canvas', { opacity: 0, scale: .96 }, { opacity: 1, scale: 1, duration: .5, ease: 'power2.out' });
  }

  return { open, badges };
})();
