// Wayfarer: main controller. Loads the export, builds the model and renders every section.
let M = null, S = null, F = 'all';
let calNarrow = null;
let calMetric = 'dist', busyMetric = 'dist', currentDay = null;
let dayIdx = null, ptsByDay = null, wrappedCache = null;

// ===================================================================== loading
const Store = {
  db: () => new Promise((res, rej) => { const r = indexedDB.open('wayfarer', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async tx(mode, fn) { const db = await this.db(); return new Promise((res, rej) => { const t = db.transaction('files', mode); const out = fn(t.objectStore('files')); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); },
  async put(files) { try { await this.tx('readwrite', st => st.put(files, 'last')); } catch (e) { console.warn('Could not cache file locally', e); } },
  async get() { try { const r = await this.tx('readonly', st => st.get('last')); return Array.isArray(r) ? r : r ? [r] : null; } catch (e) { return null; } },
  async clear() { try { await this.tx('readwrite', st => st.delete('last')); } catch (e) {} },
};

let busy = false;
function progress(text, pct) {
  $('#progress').hidden = false;
  $('#progress-text').textContent = text;
  $('#progress-fill').style.width = pct + '%';
}
function fail(msg) {
  busy = false;
  progress('⚠️ ' + msg, 100);
  $('#progress-fill').style.background = 'var(--s8)';
  Anim.loadingStop();
}
const yieldUI = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function process(raw, files) {
  try {
    M = await Model.build(raw, progress);
    if (!M.days.size) throw new Error('The export was read, but it contains no dated entries.');
    progress('Indexing days…', 92); await yieldUI();
    buildIndexes();
    if (files) Store.put(files);
    progress('Rendering your atlas…', 97); await yieldUI(30);
    Anim.toApp(start);
  } catch (e) { console.error(e); fail(e.message); }
}
async function loadFiles(list) {
  if (busy) return;
  const files = [...list].filter(f => /\.json$/i.test(f.name) || f.type === 'application/json');
  if (!files.length) { fail('Please choose a .json file (unzip a Takeout archive first).'); return; }
  busy = true; Anim.loadingStart();
  $('#progress-fill').style.background = '';
  try {
    const parsed = [];
    const total = files.reduce((s, f) => s + f.size, 0);
    for (const [i, f] of files.entries()) {
      progress(files.length > 1 ? `Reading file ${i + 1} of ${files.length}…` : `Reading ${f.name} (${fmt.n(total / 1048576, 1)} MB)…`, 2 + 6 * i / files.length);
      await yieldUI(20);
      let raw;
      try { raw = JSON.parse(await f.text()); } catch (e) { throw new Error(`"${f.name}" is not valid JSON.`); }
      parsed.push({ name: f.name, raw });
    }
    progress('Detecting format…', 8); await yieldUI();
    const canonical = Formats.normalise(parsed);
    await process(canonical, files);
  } catch (e) { console.error(e); fail(e.message); }
}
async function loadDemo() {
  if (busy) return;
  busy = true; Anim.loadingStart();
  $('#progress-fill').style.background = '';
  progress('Generating a demo timeline…', 4); await yieldUI(30);
  process(Demo.generate(), null);
}

function initLanding() {
  const drop = $('#drop'), input = $('#file');
  input.addEventListener('change', () => input.files.length && loadFiles(input.files));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { e.stopPropagation(); e.dataTransfer.files.length && loadFiles(e.dataTransfer.files); });
  // allow dropping anywhere on the landing page
  $('#landing').addEventListener('dragover', e => e.preventDefault());
  $('#landing').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });
  $('#demo').onclick = loadDemo;
  Store.get().then(files => {
    if (!files || !files.length) return;
    const size = files.reduce((s, f) => s + f.size, 0);
    const b = $('#resume'), forget = $('#forget');
    b.hidden = false; forget.hidden = false;
    b.textContent = `↻ Continue with ${files.length > 1 ? files.length + ' files' : files[0].name} (${fmt.n(size / 1048576, 1)} MB)`;
    b.onclick = () => loadFiles(files);
    forget.onclick = async () => { await Store.clear(); b.hidden = true; forget.hidden = true; };
  });
  Anim.landing();
}

function buildIndexes() {
  dayIdx = new Map();
  const get = d => { let o = dayIdx.get(d); if (!o) dayIdx.set(d, o = { visits: [], acts: [] }); return o; };
  for (const v of M.visits) if (v.lvl === 0) Model.splitByDay(v.s, v.e, v.off, d => get(d).visits.push(v));
  for (const a of M.acts) get(a.d).acts.push(a);
  ptsByDay = new Map();
  for (const i of M.P.order) { const d = M.P.d[i]; let a = ptsByDay.get(d); if (!a) ptsByDay.set(d, a = []); a.push(i); }
}
function pointsBetween(s, e) {
  const { order, t } = M.P;
  let lo = 0, hi = order.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t[order[mid]] < s) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let k = lo; k < order.length && t[order[k]] <= e; k++) out.push([M.P.lat[order[k]], M.P.lng[order[k]]]);
  return out;
}

// ===================================================================== shell
function start() {
  $('#landing').hidden = true;
  $('#app').hidden = false;
  window.scrollTo(0, 0);
  if (M.sources.some(x => x.kind === 'demo')) $('.brand').insertAdjacentHTML('beforeend', ' <span class="tag inf">demo</span>');
  const yrs = $('#years');
  yrs.innerHTML = `<button data-y="all" class="on">All time</button>` + M.years.map(y => `<button data-y="${y}">${y}</button>`).join('');
  yrs.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    F = b.dataset.y === 'all' ? 'all' : +b.dataset.y;
    $$('button', yrs).forEach(x => x.classList.toggle('on', x === b));
    Anim.switchYear(render);
  });
  $('#theme').onclick = () => {
    const next = Theme.dark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('wf-theme', next); } catch (e) {}
    retileMaps(); render(true);
  };
  $('#reload').onclick = () => location.reload();
  seg('cal-metric', m => { calMetric = m; safe(renderCalendar); });
  seg('busy-metric', m => { busyMetric = m; safe(renderBusiest); });
  $$('#map-tools input').forEach(i => i.addEventListener('change', () => safe(renderHeat)));
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if ((document.getElementById('c-calendar').clientWidth < 640) !== calNarrow) safe(renderCalendar); }, 250); });
  $('#day-input').addEventListener('change', e => showDay(e.target.value));
  $('#day-prev').onclick = () => stepDay(-1);
  $('#day-next').onclick = () => stepDay(1);
  $('#day-random').onclick = () => { const ds = [...M.days.keys()]; showDay(ds[Math.floor(Math.random() * ds.length)]); };
  $('#day-busy').onclick = () => showDay(S.topDist[0]?.d);
  $('#day-replay').onclick = replayDay;
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    const r = document.getElementById('day').getBoundingClientRect();
    if (r.top > innerHeight || r.bottom < 0) return;
    if (e.key === 'ArrowLeft') stepDay(-1);
    if (e.key === 'ArrowRight') stepDay(1);
  });

  const links = $$('#sidenav a');
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
    const act = links.find(a => a.getAttribute('href') === '#' + en.target.id);
    Anim.navTo(act);
    const nav = $('#sidenav');
    if (act && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: act.offsetLeft - nav.clientWidth / 2 + act.offsetWidth / 2, behavior: 'smooth' });
  }), { rootMargin: '-40% 0px -55% 0px' });
  $$('main section').forEach(s => io.observe(s));

  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
  });
  Anim.appIntro();
  render();
  // open the explorer on the most recent day that actually had some movement
  const recent = [...M.days.values()].filter(d => d.nActs > 0).sort((a, b) => a.d < b.d ? 1 : -1)[0] || [...M.days.values()].pop();
  showDay(recent.d, false);
}

function safe(fn) { try { fn(); } catch (e) { console.error(fn.name, e); } }

function render() {
  S = Stats.compute(M, F);
  [renderOverview, renderHeat, renderCalendar, renderRhythm, renderModes, renderActive, renderTransit, renderFlights,
    renderCountries, renderPlaces, renderHomeWork, renderTrips, renderRecords, renderBusiest, renderWrapped, renderQuality].forEach(safe);
  if (currentDay) safe(() => showDay(currentDay, false));
  Anim.hero();
  Anim.refresh();
  Anim.tilt('.record, .wrap, .trip');
  a11y();
}
function a11y(root = document) {
  $$('tr.click, .record.click, .wrap, .trip, .ev', root).forEach(el => { if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; el.setAttribute('role', 'button'); } });
}

const scopeLabel = () => F === 'all' ? 'all time' : 'in ' + F;
const homeCC = d => { const e = Model.eraAt(M.homeEras, d.slice(0, 7)); return e && e.cc; };
function jumpToDay(d) { showDay(d); document.getElementById('day').scrollIntoView(); }

// ===================================================================== overview
function renderOverview() {
  const first = S.days[0]?.d, last = S.days[S.days.length - 1]?.d;
  $('#hero-range').textContent = first ? `${fmt.dateShort(first)} — ${fmt.dateShort(last)} · ${scopeLabel()}` : 'No data';
  const km = S.totalDist / 1000;
  const words = ['km', 'across', String(S.countryList.length), S.countryList.length === 1 ? 'country' : 'countries'];
  $('#hero-title').innerHTML = `<span class="wl"><em class="w" data-count="${Math.round(km)}" data-key="hero-km">${fmt.n(km)}</em></span> ` + words.map(w => `<span class="wl"><span class="w">${w}</span></span>`).join(' ');
  const earth = km / 40075;
  $('#hero-sub').innerHTML = `${earth >= 1 ? `That's <b>${fmt.n(earth, 1)}×</b> around the Earth` : `That's <b>${fmt.n(earth * 100)}%</b> of the way around the Earth`}`
    + ` (or <b>${fmt.n(km / 384400 * 100, 1)}%</b> of the way to the Moon). You visited <b>${fmt.n(S.placeList.length)}</b> distinct places in <b>${fmt.n(S.cities.length)}</b> cities,`
    + ` took <b>${S.flights.length}</b> flights and spent <b>${fmt.n(S.moveMs / 3600000)}</b> hours on the move.`;

  const walk = S.modes.walk, tr = S.modes.train;
  tiles('tiles', [
    { icon: '🧭', k: 'Distance', v: +((km) || 0).toFixed(0), dec: 0, u: 'km', d: `${fmt.n(km / Math.max(1, S.tracked), 1)} km per tracked day` },
    { icon: '📅', k: 'Days tracked', v: +((S.tracked) || 0).toFixed(0), dec: 0, d: first ? `since ${fmt.dateShort(first)}` : '' },
    { icon: '🌍', k: 'Countries', v: S.countryList.length, d: `${S.continents.size} continent${S.continents.size === 1 ? '' : 's'}` },
    { icon: '🏙️', k: 'Cities', v: +((S.cities.length) || 0).toFixed(0), dec: 0, d: S.cities[0] ? `most: ${esc(fmt.city(S.cities[0].ci))}` : '' },
    { icon: '📍', k: 'Places', v: +((S.placeList.length) || 0).toFixed(0), dec: 0, d: `${fmt.n(S.visits.length)} visits` },
    { icon: '✈️', k: 'Flights', v: S.flights.length, d: fmt.n(S.flights.reduce((s, f) => s + f.km, 0)) + ' km in the air' },
    { icon: '🚆', k: 'Train rides', v: +((tr.n) || 0).toFixed(0), dec: 0, d: fmt.km(tr.dist) + ' · ' + fmt.h(tr.ms) },
    { icon: '🚶', k: 'Walked', v: +((walk.dist / 1000) || 0).toFixed(0), dec: 0, u: 'km', d: `≈ ${fmt.n(walk.dist / 1000 * 1312 / 1e6, 1)}M steps` },
    { icon: '⏱️', k: 'Time moving', v: +((S.moveMs / 3600000) || 0).toFixed(0), dec: 0, u: 'h', d: `${fmt.n(S.moveMs / 3600000 / Math.max(1, S.tracked) * 60)} min per day` },
    { icon: '🌱', k: 'CO₂ (est.)', v: +((S.co2 / 1000) || 0).toFixed(1), dec: 1, u: 't', d: `${fmt.n(S.co2 / Math.max(1, S.tracked), 1)} kg per day` },
  ]);

  const used = MODE_ORDER.filter(m => S.modes[m].n > 0);
  chart('c-mode-bars', {
    grid: { left: 8, right: 60, top: 4, bottom: 4 },
    tooltip: { trigger: 'item', formatter: p => `${MODES[used[p.dataIndex]].icon} ${MODES[used[p.dataIndex]].label}<br><b>${fmt.n(p.value)} km</b> · ${fmt.n(S.modes[used[p.dataIndex]].n)} trips` },
    xAxis: { type: 'value', splitLine: { show: true }, axisLabel: { formatter: v => fmt.n(v) } },
    yAxis: { type: 'category', inverse: true, data: used.map(m => MODES[m].icon + ' ' + MODES[m].label), axisLabel: { color: Theme.v('--text-2'), fontSize: 12 } },
    series: [{ type: 'bar', barWidth: '58%', data: used.map(m => ({ value: Math.round(S.modes[m].dist / 1000), itemStyle: { color: Theme.mode(m), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: Theme.v('--text-2'), formatter: p => fmt.n(p.value) } }],
  });

  const ground = MODE_ORDER.filter(m => m !== 'flight' && M.acts.some(a => a.mode === m));
  chart('c-year-mode', {
    legend: { type: 'scroll' }, grid: { top: 36 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => fmt.n(v) + ' km' },
    xAxis: { type: 'category', data: M.years.map(String) },
    yAxis: { type: 'value', axisLabel: { formatter: v => fmt.n(v) } },
    series: ground.map(m => ({
      name: MODES[m].label, type: 'bar', stack: 'y', barWidth: '60%',
      itemStyle: { color: Theme.mode(m), borderColor: Theme.v('--surface'), borderWidth: 1 },
      data: M.years.map(y => ({ value: Math.round((S.yearMode[y]?.[m] || 0) / 1000), itemStyle: { opacity: F === 'all' || F === y ? 1 : 0.3 } })),
    })),
  });
}

// ===================================================================== heatmap
function renderHeat() {
  const m = map('m-heat', { scrollWheelZoom: false });
  m._layers2.clearLayers();
  const on = k => $(`#map-tools input[data-layer="${k}"]`).checked;
  const inF = d => F === 'all' || +d.slice(0, 4) === F;
  const pts = [];
  if (on('heat')) {
    const { lat, lng, d, cc } = M.P;
    for (let i = 0; i < lat.length; i++) if (cc[i] && inF(d[i])) pts.push([lat[i], lng[i], 0.5]);
    for (const v of S.visits) pts.push([v.lat, v.lng, Math.min(1, 0.3 + (v.e - v.s) / 3600000 / 10)]);
    const seq = Theme.seq();
    L.heatLayer(pts, { radius: 9, blur: 12, minOpacity: 0.35, maxZoom: 13, gradient: { 0.25: seq[2], 0.5: seq[3], 0.75: seq[4], 1: Theme.dark() ? '#ffffff' : seq[5] } }).addTo(m._layers2);
  }
  if (on('places')) {
    const max = S.placeList[0]?.ms || 1;
    for (const p of S.placeList.slice(0, 600)) {
      const kind = /HOME/.test(p.type) ? 3 : /WORK/.test(p.type) ? 7 : 1;
      L.circleMarker([p.lat, p.lng], { radius: 3 + 14 * Math.sqrt(p.ms / max), color: Theme.v('--surface'), weight: 1, fillColor: Theme.series(kind), fillOpacity: .8 })
        .bindPopup(placePopup(p)).addTo(m._layers2);
    }
  }
  if (on('flights')) Anim.drawPaths(drawFlights(m._layers2, S.flights, m), { stagger: .03, duration: 1 });
  if (on('homes')) for (const e of M.homeEras) {
    L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', html: '<div style="font-size:20px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">🏠</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .bindPopup(`<b>Home</b><br>${esc(fmt.place(e.city, e.cc))}<br>${fmt.month(e.from)} – ${fmt.month(e.to)}`).addTo(m._layers2);
  }
  const ll = S.visits.map(v => [v.lat, v.lng]);
  if (ll.length) m.fitBounds(L.latLngBounds(ll).pad(0.05));
  setTimeout(() => m.invalidateSize(), 50);
}
function placePopup(p) {
  return `<b>${placeLabel(p)}</b> ${typeTag(p.type)}<br>${fmt.n(p.n)} visits · ${fmt.h(p.ms)}<br>
    <span class="muted">${fmt.dateShort(Model.dkey(p.first, 0))} → ${fmt.dateShort(Model.dkey(p.last, 0))}</span><br>
    <a href="${gmapsPlace(p.pid, p.lat, p.lng)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>`;
}
function drawFlights(group, flights, m) {
  const col = Theme.series(1);
  const ends = new Map(), lines = [];
  for (const f of flights) {
    lines.push(L.polyline(geodesic(f.from, f.to), { color: col, weight: 2, opacity: .75, dashArray: f.inferred ? '5 6' : null, renderer: m && m._svg })
      .bindTooltip(`${esc(fmt.place(f.fromCity, f.fromCc))} → ${esc(fmt.place(f.toCity, f.toCc))}<br>${fmt.dateShort(f.d)} · ${fmt.n(f.km)} km`, { sticky: true }).addTo(group));
    for (const [ll, ci, cc] of [[f.from, f.fromCity, f.fromCc], [f.to, f.toCity, f.toCc]]) {
      const k = ci + ''; if (!ends.has(k)) ends.set(k, { ll, ci, cc, n: 0 }); ends.get(k).n++;
    }
  }
  for (const e of ends.values()) L.circleMarker(e.ll, { radius: 3 + Math.sqrt(e.n) * 2, color: Theme.v('--surface'), weight: 1.5, fillColor: col, fillOpacity: 1 })
    .bindTooltip(`${esc(fmt.place(e.ci, e.cc))} · ${e.n} flight${e.n > 1 ? 's' : ''}`).addTo(group);
  return lines;
}

// ===================================================================== calendar
function renderCalendar() {
  const years = F === 'all' ? [...M.years].reverse() : [F];
  const val = d => {
    switch (calMetric) {
      case 'dist': return +(d.dist / 1000).toFixed(1);
      case 'walk': return +((d.mode.walk || 0) / 1000).toFixed(1);
      case 'places': return d.places.size;
      case 'far': return Math.round(d.far);
      case 'moveH': return +(d.moveMs / 3600000).toFixed(1);
    }
  };
  const unit = { dist: 'km', walk: 'km walked', places: 'places', far: 'km from home', moveH: 'h moving' }[calMetric];
  const data = [...M.days.values()].filter(d => years.includes(d.y)).map(d => [d.d, Math.sqrt(Math.max(0, val(d)))]);
  const sorted = data.map(x => x[1]).sort((a, b) => a - b);
  const p95raw = (sorted[Math.floor(sorted.length * 0.97)] || 1) ** 2, p95 = Math.sqrt(p95raw);
  const el = document.getElementById('c-calendar');
  // narrow screens: fit the whole year in the width (smaller cells) instead of scrolling sideways
  const narrow = el.clientWidth < 640;
  calNarrow = narrow;
  const cellH = narrow ? 9 : 15, yearH = cellH * 7 + (narrow ? 26 : 34), labelW = narrow ? 44 : 74;
  el.style.height = (years.length * yearH + 50) + 'px';
  const seq = Theme.seq();
  const c = chart('c-calendar', {
    tooltip: {
      formatter: p => {
        const d = M.days.get(p.value[0]); if (!d) return '';
        return `<b>${fmt.date(d.d)}</b><br>${fmt.km(d.dist)} · ${d.places.size} places · ${fmt.h(d.moveMs)} moving<br>${[...d.cc].map(Geo.flag).join(' ')} ${d.far > 50 ? `· ${fmt.n(d.far)} km from home` : ''}`;
      },
    },
    visualMap: { min: 0, max: Math.max(1, p95), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10,
      inRange: { color: seq }, text: [`${fmt.n(p95raw)}+ ${unit}`, '0'], textStyle: { color: Theme.v('--muted'), fontSize: 11 } },
    calendar: years.map((y, i) => ({
      range: String(y), top: 24 + i * yearH, left: labelW, right: 4, cellSize: ['auto', cellH],
      splitLine: { show: false }, itemStyle: { color: Theme.v('--surface-2'), borderColor: Theme.v('--surface'), borderWidth: narrow ? 1 : 2 },
      yearLabel: { show: false },
      dayLabel: { show: !narrow, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], color: Theme.v('--muted'), fontSize: 9 },
      monthLabel: { color: Theme.v('--muted'), fontSize: narrow ? 8 : 10, show: i === 0 || years.length === 1, nameMap: narrow ? ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] : 'en' },
    })),
    // year labels drawn horizontally in their own column (ECharts rotates and clips them otherwise)
    graphic: years.map((y, i) => ({ type: 'text', left: 0, top: 24 + i * yearH + cellH * 3.5 - (narrow ? 9 : 12), silent: true,
      style: { text: String(y), fill: Theme.v('--text'), font: `400 ${narrow ? 16 : 22}px "Instrument Serif", Georgia, serif` } })),
    series: years.map((y, i) => ({ type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: i, data: data.filter(x => +x[0].slice(0, 4) === y) })),
  });
  c.off('click'); c.on('click', p => p.value && jumpToDay(p.value[0]));
}

// ===================================================================== rhythms
function renderRhythm() {
  const hrs = [...Array(24).keys()].map(h => String(h).padStart(2, '0'));
  const wds = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const data = [];
  let max = 1;
  S.punch.forEach((row, w) => row.forEach((v, h) => { data.push([h, w, Math.round(v)]); max = Math.max(max, v); }));
  chart('c-punch', {
    grid: { left: 8, right: 8, top: 4, bottom: 40 },
    tooltip: { formatter: p => `${wds[p.value[1]]} ${hrs[p.value[0]]}:00–${hrs[(p.value[0] + 1) % 24]}:00<br><b>${fmt.n(p.value[2] / 60)} h</b> moving in total` },
    xAxis: { type: 'category', data: hrs, splitArea: { show: false } },
    yAxis: { type: 'category', data: wds, inverse: true },
    visualMap: { min: 0, max, show: false, inRange: { color: Theme.seq() } },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: Theme.v('--surface'), borderWidth: 2, borderRadius: 4 } }],
  });
  const bar = (id, labels, vals) => chart(id, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => fmt.n(v, 1) + ' km/day' },
    xAxis: { type: 'category', data: labels }, yAxis: { type: 'value' },
    series: [{ type: 'bar', barWidth: '55%', data: vals.map(v => +v.toFixed(1)), itemStyle: { color: Theme.series(1), borderRadius: [4, 4, 0, 0] } }],
  });
  bar('c-weekday', wds, S.byWeekday.map(o => o.n ? o.dist / o.n / 1000 : 0));
  bar('c-month', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], S.byMonth.map(o => o.n ? o.dist / o.n / 1000 : 0));
}

// ===================================================================== modes
function renderModes() {
  const used = MODE_ORDER.filter(m => S.modes[m].n > 0);
  const maxD = Math.max(...used.map(m => S.modes[m].dist), 1);
  table('mode-table', used, [
    { h: 'Mode', v: m => `<span class="swatch" style="background:${Theme.mode(m)}"></span>${MODES[m].icon} ${MODES[m].label}` },
    { h: 'Trips', cls: 'num', v: m => fmt.n(S.modes[m].n) },
    { h: 'Distance', cls: 'num', v: m => fmt.km(S.modes[m].dist) },
    { h: '', v: m => `<div class="minibar" style="width:${100 * S.modes[m].dist / maxD}%;background:${Theme.mode(m)}"></div>` },
    { h: 'Time', cls: 'num', v: m => fmt.h(S.modes[m].ms) },
    { h: 'Avg trip', cls: 'num', v: m => fmt.km(S.modes[m].dist / S.modes[m].n) },
    { h: 'Avg speed', cls: 'num', v: m => fmt.n(S.modes[m].dist / 1000 / (S.modes[m].ms / 3600000 || 1), 1) + ' km/h' },
    { h: 'Longest', cls: 'num', v: m => S.modes[m].longest ? `${fmt.km(S.modes[m].longest.dist)} <span class="muted small">${fmt.dateShort(S.modes[m].longest.d)}</span>` : '' },
    { h: 'CO₂', cls: 'num', v: m => MODES[m].co2 ? fmt.n(S.modes[m].dist / 1000 * MODES[m].co2) + ' kg' : '—' },
  ], m => S.modes[m].longest && jumpToDay(S.modes[m].longest.d));

  const hb = (id, ms, valFn, fmtFn) => chart(id, {
    grid: { left: 8, right: 70, top: 4, bottom: 4 },
    tooltip: { trigger: 'item', formatter: p => `${MODES[ms[p.dataIndex]].label}: <b>${fmtFn(p.value)}</b>` },
    xAxis: { type: 'value' }, yAxis: { type: 'category', inverse: true, data: ms.map(m => MODES[m].icon + ' ' + MODES[m].label), axisLabel: { color: Theme.v('--text-2') } },
    series: [{ type: 'bar', barWidth: '58%', data: ms.map(m => ({ value: valFn(m), itemStyle: { color: Theme.mode(m), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: Theme.v('--text-2'), formatter: p => fmtFn(p.value) } }],
  });
  hb('c-mode-time', used, m => Math.round(S.modes[m].ms / 3600000), v => fmt.n(v) + ' h');
  const co2m = used.filter(m => MODES[m].co2 > 0);
  $('#c-co2').previousElementSibling.textContent = `≈ ${fmt.n(S.co2 / 1000, 1)} t CO₂e in total, using typical per-passenger-km factors`;
  hb('c-co2', co2m, m => Math.round(S.modes[m].dist / 1000 * MODES[m].co2), v => fmt.n(v) + ' kg');

  const months = Object.keys(S.monthMode).sort();
  const ground = MODE_ORDER.filter(m => m !== 'flight' && S.modes[m].n > 0);
  chart('c-month-mode', {
    legend: { type: 'scroll' }, grid: { top: 36, bottom: months.length > 24 ? 40 : 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => fmt.n(v) + ' km' },
    dataZoom: months.length > 24 ? [{ type: 'slider', height: 18, bottom: 6, start: Math.max(0, 100 - 2400 / months.length * 1.5) , borderColor: Theme.v('--border'), textStyle: { color: Theme.v('--muted') } }] : [],
    xAxis: { type: 'category', data: months.map(fmt.month) }, yAxis: { type: 'value' },
    series: ground.map(m => ({ name: MODES[m].label, type: 'bar', stack: 'm', itemStyle: { color: Theme.mode(m) }, data: months.map(k => Math.round((S.monthMode[k][m] || 0) / 1000)) })),
  });
}

// ===================================================================== active
function renderActive() {
  const w = S.modes.walk, c = S.modes.cycle;
  const walkDays = S.days.filter(d => (d.mode.walk || 0) > 0);
  const best = S.walkDays[0];
  tiles('active-tiles', [
    { icon: '🚶', k: 'Walked', v: +((w.dist / 1000) || 0).toFixed(0), dec: 0, u: 'km', d: `${fmt.n(w.n)} walks · ${fmt.h(w.ms)}` },
    { icon: '👣', k: 'Steps (est.)', v: +((w.dist / 1000 * 1312 / 1000) || 0).toFixed(0), dec: 0, u: 'k', d: `${fmt.n(w.dist / 1000 * 1312 / Math.max(1, S.tracked))} per tracked day` },
    { icon: '🏃', k: 'Marathons', v: +((w.dist / 42195) || 0).toFixed(1), dec: 1, d: 'worth of walking' },
    { icon: '📈', k: 'Daily average', v: +((w.dist / 1000 / Math.max(1, S.tracked)) || 0).toFixed(2), dec: 2, u: 'km', d: `${fmt.n(100 * walkDays.length / Math.max(1, S.tracked))}% of days had a walk` },
    { icon: '🏅', k: 'Best walking day', v: best ? fmt.n((best.mode.walk || 0) / 1000, 1) : '—', u: 'km', d: best ? fmt.dateShort(best.d) : '' },
    { icon: '🔥', k: 'Walking streak', v: S.streaks.walk.len || 0, u: 'days', d: S.streaks.walk.len ? `≥ 2 km/day · ${fmt.dateShort(S.streaks.walk.from)}` : '' },
    { icon: '🚲', k: 'Cycled', v: +((c.dist / 1000) || 0).toFixed(0), dec: 0, u: 'km', d: `${fmt.n(c.n)} rides · ${fmt.h(c.ms)}` },
    { icon: '💨', k: 'Avg cycling speed', v: +((c.dist / 1000 / (c.ms / 3600000 || 1)) || 0).toFixed(1), dec: 1, u: 'km/h', d: c.longest ? `longest ${fmt.km(c.longest.dist)}` : '' },
  ]);
  const months = Object.keys(S.monthMode).sort();
  chart('c-active-month', {
    legend: {}, grid: { top: 36 },
    tooltip: { trigger: 'axis', valueFormatter: v => fmt.n(v, 1) + ' km' },
    xAxis: { type: 'category', data: months.map(fmt.month), boundaryGap: false }, yAxis: { type: 'value' },
    series: ['walk', 'cycle'].map(m => ({ name: MODES[m].label, type: 'line', showSymbol: false, smooth: 0.25, lineStyle: { width: 2 }, color: Theme.mode(m),
      areaStyle: { opacity: 0.08 }, data: months.map(k => +((S.monthMode[k][m] || 0) / 1000).toFixed(1)) })),
  });
  const longest = (mode) => S.acts.filter(a => a.mode === mode).sort((a, b) => b.dist - a.dist).slice(0, 10);
  const cols = [
    { h: 'Date', v: a => fmt.dateShort(a.d) },
    { h: 'Where', v: a => esc(fmt.place(a.sCity, a.sCc)) + (a.eCity !== a.sCity ? ' → ' + esc(fmt.city(a.eCity, a.eCc)) : '') },
    { h: 'Distance', cls: 'num', v: a => fmt.km(a.dist) },
    { h: 'Time', cls: 'num', v: a => fmt.dur(a.e - a.s) },
  ];
  table('t-walks', longest('walk'), cols, a => jumpToDay(a.d));
  table('t-rides', longest('cycle'), cols, a => jumpToDay(a.d));
}

// ===================================================================== transit
function renderTransit() {
  const t = S.modes.train, b = S.modes.bus, mt = S.modes.metro, car = S.modes.car;
  tiles('transit-tiles', [
    { icon: '🚆', k: 'Train rides', v: +((t.n) || 0).toFixed(0), dec: 0, d: fmt.km(t.dist) },
    { icon: '⏳', k: 'Hours on trains', v: +((t.ms / 3600000) || 0).toFixed(0), dec: 0, u: 'h', d: `${fmt.n(t.ms / 3600000 / 2)} films' worth` },
    { icon: '⚡', k: 'Avg train speed', v: +((t.dist / 1000 / (t.ms / 3600000 || 1)) || 0).toFixed(0), dec: 0, u: 'km/h', d: t.longest ? `longest ${fmt.km(t.longest.dist)}` : '' },
    { icon: '🚌', k: 'Bus rides', v: +((b.n) || 0).toFixed(0), dec: 0, d: `${fmt.km(b.dist)} · ${fmt.h(b.ms)}` },
    { icon: '🚇', k: 'Metro & tram', v: +((mt.n) || 0).toFixed(0), dec: 0, d: `${fmt.km(mt.dist)} · ${fmt.h(mt.ms)}` },
    { icon: '🚗', k: 'By car', v: +((car.n) || 0).toFixed(0), dec: 0, d: `${fmt.km(car.dist)} · ${fmt.h(car.ms)}` },
  ]);
  table('t-routes', S.routes.slice(0, 15), [
    { h: 'Route', v: r => esc(r.k) },
    { h: 'Trips', cls: 'num', v: r => r.n },
    { h: 'Total', cls: 'num', v: r => fmt.km(r.dist) },
    { h: 'Avg time', cls: 'num', v: r => fmt.dur(r.ms / r.n) },
  ]);
  const longest = [...S.trains].sort((a, b) => b.dist - a.dist).slice(0, 15);
  table('t-trains', longest, [
    { h: 'Date', v: a => fmt.dateShort(a.d) },
    { h: 'From → to', v: a => `${esc(fmt.place(a.sCity, a.sCc))} → ${esc(fmt.place(a.eCity, a.eCc))}` },
    { h: 'Distance', cls: 'num', v: a => fmt.km(a.dist) },
    { h: 'Time', cls: 'num', v: a => fmt.dur(a.e - a.s) },
  ], a => jumpToDay(a.d));
  const m = map('m-trains');
  m._layers2.clearLayers();
  const col = Theme.mode('train');
  const bounds = [], trainLines = [];
  for (const a of S.trains) {
    let line = pointsBetween(a.s, a.e);
    line = [[a.sLat, a.sLng], ...line, [a.eLat, a.eLng]];
    bounds.push(...line);
    trainLines.push(L.polyline(line, { color: col, weight: 2.5, opacity: .6, renderer: m._svg }).bindTooltip(`${fmt.dateShort(a.d)} · ${esc(fmt.city(a.sCity))} → ${esc(fmt.city(a.eCity))} · ${fmt.km(a.dist)}`, { sticky: true }).addTo(m._layers2));
  }
  if (bounds.length) m.fitBounds(L.latLngBounds(bounds).pad(0.05)); else m.setView([50, 10], 4);
  setTimeout(() => { m.invalidateSize(); Anim.drawPaths(trainLines.slice(-250), { stagger: .01, duration: 1.2, trigger: document.getElementById('m-trains') }); }, 60);
  emptyNote('m-trains', !S.trains.length, 'No train journeys in this period');
}

// ===================================================================== flights
function renderFlights() {
  const fl = S.flights;
  const km = fl.reduce((s, f) => s + f.km, 0), hrs = fl.reduce((s, f) => s + f.hrs, 0), co2 = fl.reduce((s, f) => s + f.co2, 0);
  const longest = [...fl].sort((a, b) => b.km - a.km)[0];
  const dest = new Set(fl.map(f => f.toCc).filter(Boolean));
  tiles('flight-tiles', [
    { icon: '✈️', k: 'Flights', v: fl.length, d: `${fl.filter(f => f.inferred).length} inferred` },
    { icon: '📏', k: 'Flown', v: +((km) || 0).toFixed(0), dec: 0, u: 'km', d: `${fmt.n(km / 40075, 2)}× around the Earth` },
    { icon: '🕐', k: 'Hours in the air', v: +((hrs) || 0).toFixed(0), dec: 0, u: 'h', d: `avg ${fmt.n(hrs / Math.max(1, fl.length), 1)} h per flight` },
    { icon: '🛬', k: 'Destinations', v: dest.size, u: 'countries', d: [...dest].map(Geo.flag).join(' ') },
    { icon: '🌏', k: 'Longest flight', v: longest ? fmt.n(longest.km) : '—', u: 'km', d: longest ? `${esc(fmt.city(longest.fromCity))} → ${esc(fmt.city(longest.toCity))}` : '' },
    { icon: '🌱', k: 'Flight CO₂ (est.)', v: +((co2 / 1000) || 0).toFixed(1), dec: 1, u: 't', d: 'per passenger, incl. distance class' },
  ]);
  const m = map('m-flights');
  m._layers2.clearLayers();
  const arcs = drawFlights(m._layers2, fl, m);
  const b = fl.flatMap(f => [f.from, f.to]);
  if (b.length) m.fitBounds(L.latLngBounds(b).pad(0.1)); else m.setView([30, 20], 2);
  setTimeout(() => { m.invalidateSize(); Anim.drawPaths(arcs, { stagger: .06, duration: 1.4, trigger: document.getElementById('m-flights') }); }, 60);
  emptyNote('m-flights', !fl.length, 'No flights in this period');
  emptyNote('c-airports', !fl.length, 'No flights in this period');

  table('t-flights', [...fl].reverse(), [
    { h: 'Date', v: f => fmt.dateShort(f.d) },
    { h: 'Route', v: f => `${esc(fmt.place(f.fromCity, f.fromCc))} → ${esc(fmt.place(f.toCity, f.toCc))}${f.inferred ? ' <span class="tag inf">inferred</span>' : ''}` },
    { h: 'Distance', cls: 'num', v: f => fmt.n(f.km) + ' km' },
    { h: 'Time', cls: 'num', v: f => f.inferred === 'gap' ? '—' : fmt.dur(f.e - f.s) },
  ], f => jumpToDay(f.d));

  const ap = [...S.airports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  chart('c-airports', {
    grid: { left: 8, right: 30, top: 4, bottom: 4 },
    tooltip: { trigger: 'item', formatter: p => `${p.name}: <b>${p.value}</b> flights` },
    xAxis: { type: 'value', minInterval: 1 }, yAxis: { type: 'category', inverse: true, data: ap.map(([ci]) => fmt.place(ci)), axisLabel: { color: Theme.v('--text-2') } },
    series: [{ type: 'bar', barWidth: '58%', data: ap.map(x => x[1]), itemStyle: { color: Theme.series(1), borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: Theme.v('--text-2') } }],
  });
}

// ===================================================================== countries
function renderCountries() {
  const cl = S.countryList;
  const visited = cl.filter(c => c.vdays > 0);
  const abroad = S.days.filter(d => [...d.cc].some(c => c !== homeCC(d.d))).length;
  const far = cl.map(c => ({ c, km: Math.max(...M.visits.filter(v => v.cc === c.cc).slice(0, 200).map(v => { const h = M.homeEras[M.homeEras.length - 1]; return h ? haversine(h.lat, h.lng, v.lat, v.lng) / 1000 : 0; }), 0) })).sort((a, b) => b.km - a.km)[0];
  tiles('country-tiles', [
    { icon: '🌍', k: 'Countries', v: cl.length, d: `${visited.length} with a stop · ${cl.length - visited.length} passed through` },
    { icon: '🗺️', k: 'Continents', v: S.continents.size, d: [...S.continents].map(c => Geo.CONTINENTS[c] || c).join(', ') },
    { icon: '🏙️', k: 'Cities', v: +((S.cities.length) || 0).toFixed(0), dec: 0, d: 'with at least one visit or journey' },
    { icon: '🧳', k: 'Days abroad', v: +((abroad) || 0).toFixed(0), dec: 0, d: `${fmt.n(100 * abroad / Math.max(1, S.tracked))}% of tracked days, outside the home country of the time` },
    { icon: '📌', k: 'Farthest country', v: far ? Geo.flag(far.c.cc) : '—', d: far ? `${esc(Geo.info(far.c.cc).name)} · ${fmt.n(far.km)} km from current home` : '' },
  ]);

  const m = map('m-world', { worldCopyJump: false, minZoom: 1 });
  m._layers2.clearLayers();
  const days = new Map(cl.map(c => [c.cc, c]));
  const maxD = Math.max(...cl.map(c => c.days), 1);
  const seq = Theme.seq();
  const colorFor = d => { const t = Math.log(1 + d) / Math.log(1 + maxD); return seq[1 + Math.min(4, Math.floor(t * 4.999))]; };
  const feats = Geo.features();
  L.geoJSON({ type: 'FeatureCollection', features: feats.map(f => f.feature) }, {
    style: f => { const c = days.get(f.properties.a2 || f.properties.name); return c ? { fillColor: colorFor(c.days), fillOpacity: .85, color: Theme.v('--surface'), weight: .8 } : { fillOpacity: 0, color: Theme.v('--border'), weight: .5 }; },
    onEachFeature: (f, layer) => {
      const c = days.get(f.properties.a2 || f.properties.name);
      if (c) layer.bindTooltip(`${Geo.flag(c.cc)} <b>${esc(Geo.info(c.cc).name)}</b><br>${fmt.n(c.days)} days · ${c.stays} stay${c.stays > 1 ? 's' : ''}<br>first ${fmt.dateShort(c.first)}`, { sticky: true });
    },
  }).addTo(m._layers2);
  const vb = S.visits.map(v => [v.lat, v.lng]);
  if (vb.length) m.fitBounds(L.latLngBounds(vb).pad(0.4)); else m.setView([30, 10], 2);
  setTimeout(() => m.invalidateSize(), 50);

  const maxDays = cl[0]?.days || 1;
  table('t-countries', cl, [
    { h: 'Country', v: c => `<span class="flag">${Geo.flag(c.cc)}</span>${esc(Geo.info(c.cc).name)}${c.vdays ? '' : ' <span class="tag">transit</span>'}` },
    { h: 'Days', cls: 'num', v: c => fmt.n(c.days) },
    { h: '', v: c => `<div class="minibar" style="width:${Math.max(2, 100 * Math.log(1 + c.days) / Math.log(1 + maxDays))}%"></div>` },
    { h: 'Stays', cls: 'num', v: c => c.stays },
    { h: 'Cities', cls: 'num', v: c => c.cities.size },
    { h: 'First', v: c => fmt.dateShort(c.first) },
    { h: 'Last', v: c => fmt.dateShort(c.last) },
  ], c => jumpToDay(c.first));

  const top = S.cities.slice(0, 25);
  chart('c-cities', {
    grid: { left: 8, right: 50, top: 4, bottom: 4 },
    tooltip: { trigger: 'item', formatter: p => `${esc(p.name)}<br><b>${fmt.n(p.value)}</b> days · first ${fmt.dateShort(top[p.dataIndex].first)}` },
    xAxis: { type: 'log', logBase: 10, min: 1 }, yAxis: { type: 'category', inverse: true, data: top.map(c => fmt.place(c.ci)), axisLabel: { color: Theme.v('--text-2'), fontSize: 11.5 } },
    series: [{ type: 'bar', barWidth: '62%', data: top.map(c => c.days), itemStyle: { color: Theme.series(1), borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: Theme.v('--text-2'), formatter: p => fmt.n(p.value) } }],
  });

  // Days per country per year: colours follow the country (ranked over all time), never the filter.
  const all = new Map();
  for (const d of M.days.values()) for (const cc of d.cc) all.set(cc, (all.get(cc) || 0) + 1);
  const ranked = [...all.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const named = ranked.slice(0, 7);
  const years = M.years;
  const series = [...named, 'Other'].map((cc, i) => ({
    name: cc === 'Other' ? 'Other' : Geo.flag(cc) + ' ' + Geo.info(cc).name, type: 'bar', stack: 'c', barWidth: '60%',
    itemStyle: { color: Theme.series(cc === 'Other' ? 0 : i + 1), borderColor: Theme.v('--surface'), borderWidth: 1 },
    data: years.map(y => {
      let n = 0;
      for (const d of M.days.values()) if (d.y === y) for (const c of d.cc) if (cc === 'Other' ? !named.includes(c) : c === cc) n++;
      return { value: n, itemStyle: { opacity: F === 'all' || F === y ? 1 : .3 } };
    }),
  }));
  chart('c-country-year', {
    legend: { type: 'scroll' }, grid: { top: 36 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v + ' days' },
    xAxis: { type: 'category', data: years.map(String) }, yAxis: { type: 'value', name: 'country-days', nameTextStyle: { color: Theme.v('--muted') } },
    series,
  });
}

// ===================================================================== places
function renderPlaces() {
  const pl = S.placeList.slice(0, 150);
  table('t-places', pl, [
    { h: '#', cls: 'num', v: (p, i) => `<span class="muted">${i + 1}</span>` },
    { h: 'Place', cls: 'cwrap', v: p => `${placeLabel(p)} ${typeTag(p.type)}` },
    { h: 'Visits', cls: 'num', v: p => fmt.n(p.n) },
    { h: 'Time', cls: 'num', v: p => fmt.h(p.ms) },
    { h: 'Days', cls: 'num', v: p => fmt.n(p.days.size) },
    { h: 'Since', v: p => `<span class="small">${fmt.month(Model.dkey(p.first, 0).slice(0, 7))}</span>` },
    { h: '', v: p => `<a class="ext" href="${gmapsPlace(p.pid, p.lat, p.lng)}" target="_blank" rel="noopener" title="Open in Google Maps">↗</a>` },
  ], p => { const m = Maps.get('m-places'); m.setView([p.lat, p.lng], 16); });

  const m = map('m-places');
  m._layers2.clearLayers();
  const max = S.placeList[0]?.ms || 1;
  for (const p of S.placeList.slice(0, 800).reverse()) {
    const kind = /HOME/.test(p.type) ? 3 : /WORK/.test(p.type) ? 7 : 1;
    L.circleMarker([p.lat, p.lng], { radius: 3 + 16 * Math.sqrt(p.ms / max), color: Theme.v('--surface'), weight: 1, fillColor: Theme.series(kind), fillOpacity: .75 })
      .bindPopup(placePopup(p)).addTo(m._layers2);
  }
  // focus on where most of the time was spent
  const top = S.placeList[0];
  let core = top ? S.placeList.slice(0, 200).filter(p => haversine(top.lat, top.lng, p.lat, p.lng) < 150000).slice(0, 60) : [];
  if (core.length < 3) core = S.placeList.slice(0, 40);
  core = core.map(p => [p.lat, p.lng]);
  if (core.length) m.fitBounds(L.latLngBounds(core).pad(0.1));
  setTimeout(() => m.invalidateSize(), 50);

  const months = Object.keys(S.newPlacesByMonth).sort();
  chart('c-newplaces', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v + ' new places' },
    xAxis: { type: 'category', data: months.map(fmt.month) }, yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: months.map(k => S.newPlacesByMonth[k]), itemStyle: { color: Theme.series(3), borderRadius: [3, 3, 0, 0] } }],
  });
  const gm = Object.keys(S.gyr).sort();
  chart('c-gyr', {
    tooltip: { trigger: 'axis', valueFormatter: v => fmt.n(v, 1) + ' km' },
    xAxis: { type: 'category', data: gm.map(fmt.month), boundaryGap: false }, yAxis: { type: 'log', min: 0.1 },
    series: [{ type: 'line', showSymbol: false, lineStyle: { width: 2 }, color: Theme.series(7), areaStyle: { opacity: .08 }, data: gm.map(k => Math.max(0.1, +S.gyr[k].toFixed(2))) }],
  });
}

// ===================================================================== home & work
function renderHomeWork() {
  const era = (e, icon) => `<div class="era"><div style="font-size:18px">${icon}</div>
      <div><b>${esc(fmt.place(e.city, e.cc))}</b> <a class="ext" href="${gmapsPlace(e.pid, e.lat, e.lng)}" target="_blank" rel="noopener">↗</a><div class="muted small">${e.months} month${e.months > 1 ? 's' : ''} of data</div></div>
      <div class="when">${fmt.month(e.from)}<br>${fmt.month(e.to)}</div></div>`;
  $('#eras').innerHTML = `<div class="eras">${M.homeEras.map(e => era(e, '🏠')).join('')}${M.workEras.map(e => era(e, '💼')).join('')}</div>`
    + (M.homeEras.length ? '' : '<p class="muted">No home labelled in your timeline.</p>');

  const total = S.days.length * DAY;
  const budget = [
    ['🏠 Home', S.homeMs, 3], ['💼 Work', S.workMs, 7], ['📍 Other places', S.otherMs, 1], ['🧭 Moving', S.moveMs, 2],
    ['❔ Untracked', Math.max(0, total - S.homeMs - S.workMs - S.otherMs - S.moveMs), 0],
  ];
  chart('c-budget', {
    grid: { left: 8, right: 90, top: 4, bottom: 4 },
    tooltip: { trigger: 'item', formatter: p => `${p.name}: <b>${fmt.n(p.value)} h</b> (${fmt.n(100 * p.value * 3600000 / total, 1)}%)` },
    xAxis: { type: 'value' }, yAxis: { type: 'category', inverse: true, data: budget.map(b => b[0]), axisLabel: { color: Theme.v('--text-2') } },
    series: [{ type: 'bar', barWidth: '58%', data: budget.map(b => ({ value: Math.round(b[1] / 3600000), itemStyle: { color: Theme.series(b[2]), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: Theme.v('--text-2'), formatter: p => `${fmt.n(100 * p.value * 3600000 / total, 1)}%` } }],
  });

  const C = S.commutes;
  const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const hw = C.filter(c => c.dir === 'HW'), wh = C.filter(c => c.dir === 'WH');
  const modeShare = {};
  for (const c of C) for (const [m, d] of Object.entries(c.modes)) modeShare[m] = (modeShare[m] || 0) + d;
  const topMode = Object.entries(modeShare).sort((a, b) => b[1] - a[1])[0];
  tiles('commute-tiles', [
    { icon: '🔁', k: 'Commutes', v: +((C.length) || 0).toFixed(0), dec: 0, d: `${hw.length} to work · ${wh.length} home` },
    { icon: '⏱️', k: 'Median commute', v: +((med(C.map(c => c.mins))) || 0).toFixed(0), dec: 0, u: 'min', d: `${fmt.n(C.reduce((s, c) => s + c.mins, 0) / 60)} h in total` },
    { icon: '📏', k: 'Median distance', v: +((med(C.map(c => c.dist)) / 1000) || 0).toFixed(1), dec: 1, u: 'km' },
    { icon: '🌅', k: 'Typical departure', v: hw.length ? fmt.hhmm(med(hw.map(c => c.leave))) : '—', d: 'leaving home' },
    { icon: '🌇', k: 'Typical return', v: wh.length ? fmt.hhmm(med(wh.map(c => c.arrive))) : '—', d: 'arriving home' },
    { icon: topMode ? MODES[topMode[0]].icon : '🚶', k: 'Main commute mode', v: topMode ? MODES[topMode[0]].label : '—', d: topMode ? `${fmt.n(100 * topMode[1] / Object.values(modeShare).reduce((a, b) => a + b, 0))}% of commute km` : '' },
  ]);

  const bins = [...Array(48).keys()];
  const hist = arr => { const h = new Array(48).fill(0); for (const x of arr) h[Math.min(47, Math.floor(x * 2))]++; return h; };
  chart('c-workhours', {
    legend: {}, grid: { top: 36 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: bins.map(b => fmt.hhmm(b / 2)), axisLabel: { interval: 3 } }, yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: 'Arrive', type: 'bar', data: hist(S.workArr), itemStyle: { color: Theme.series(1), borderRadius: [3, 3, 0, 0] } },
      { name: 'Leave', type: 'bar', data: hist(S.workLeave), itemStyle: { color: Theme.series(2), borderRadius: [3, 3, 0, 0] } },
    ],
  });
  const weeks = Object.keys(S.workByWeek).sort();
  chart('c-workweek', {
    tooltip: { trigger: 'axis', valueFormatter: v => fmt.n(v, 1) + ' h' },
    xAxis: { type: 'category', data: weeks }, yAxis: { type: 'value' },
    series: [{ type: 'bar', data: weeks.map(w => +S.workByWeek[w].toFixed(1)), itemStyle: { color: Theme.series(7) },
      markLine: { symbol: 'none', silent: true, lineStyle: { color: Theme.v('--muted'), type: 'dashed' }, label: { color: Theme.v('--muted'), formatter: '40 h' }, data: [{ yAxis: 40 }] } }],
  });

  emptyNote('c-commute', !C.length, 'No home ↔ work commutes detected');
  emptyNote('c-workhours', !S.workArr.length, 'No workplace visits detected');
  emptyNote('c-workweek', !Object.keys(S.workByWeek).length, 'No workplace visits detected');
  const byM = {};
  for (const c of C) (byM[c.d.slice(0, 7)] || (byM[c.d.slice(0, 7)] = [])).push(c.mins);
  const mk = Object.keys(byM).sort();
  chart('c-commute', {
    legend: {}, grid: { top: 36 },
    tooltip: { trigger: 'item', formatter: p => p.seriesType === 'scatter' ? `${fmt.date(p.value[2])}<br><b>${fmt.n(p.value[1])} min</b>` : `${p.name}: median <b>${fmt.n(p.value[1])} min</b>` },
    xAxis: { type: 'time' }, yAxis: { type: 'value', max: v => Math.min(v.max, 150), name: 'min', nameTextStyle: { color: Theme.v('--muted') } },
    series: [
      { name: 'To work', type: 'scatter', symbolSize: 5, itemStyle: { color: Theme.series(1), opacity: .55 }, data: hw.map(c => [c.d, Math.round(c.mins), c.d]) },
      { name: 'Home', type: 'scatter', symbolSize: 5, itemStyle: { color: Theme.series(2), opacity: .55 }, data: wh.map(c => [c.d, Math.round(c.mins), c.d]) },
      { name: 'Monthly median', type: 'line', showSymbol: false, lineStyle: { width: 2, color: Theme.v('--text') }, itemStyle: { color: Theme.v('--text') }, data: mk.map(k => [k + '-15', med(byM[k])]) },
    ],
  });
}

// ===================================================================== trips
function renderTrips() {
  // 1) Stays abroad computed from daily countries
  const stays = [];
  let cur = null;
  for (const d of S.days) {
    const away = [...d.cc].filter(c => c !== homeCC(d.d));
    const contiguous = cur && (Date.parse(d.d) - Date.parse(cur.to)) <= 2 * DAY;
    if (away.length) {
      if (contiguous) { cur.to = d.d; away.forEach(c => cur.cc.add(c)); cur.days++; d.cities.forEach(c => cur.cities.add(c)); }
      else { cur = { from: d.d, to: d.d, cc: new Set(away), days: 1, cities: new Set(d.cities) }; stays.push(cur); }
    } else if (cur && !contiguous) cur = null;
  }
  const big = stays.filter(s => s.days >= 2 || s.cc.size > 1).reverse();
  // 2) Google's own trip memories
  const mems = [...S.mems].reverse();
  const cityList = set => {
    const names = [...set].map(ci => Geo.cityName(ci)).filter(Boolean);
    return [...new Set(names)].slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '');
  };
  const card = (from, to, ccs, title, meta) => `<div class="trip" data-d="${from}">
      <div class="when">${fmt.dateShort(from)}${to !== from ? ' – ' + fmt.dateShort(to) : ''}</div>
      <div class="where">${[...ccs].map(Geo.flag).join(' ')} ${esc(title)}</div>
      <div class="meta">${meta}</div></div>`;
  let html = `<div class="card" style="grid-column:1/-1;margin:0"><h3>Time abroad</h3><p class="sub" style="margin:0">${big.length} stays outside your home country (of the time) lasting 2+ days</p></div>`;
  html += big.map(s => {
    const fl = M.flights.filter(f => f.d >= s.from && f.d <= s.to).length;
    const away = [...s.cities].filter(ci => s.cc.has(Geo.cityCountry(ci)));
    return card(s.from, s.to, s.cc, [...s.cc].map(c => Geo.info(c).name).join(' · '),
      `<span>🗓️ ${s.days} days</span>${fl ? `<span>✈️ ${fl}</span>` : ''}<span>🏙️ ${esc(cityList(away)) || '—'}</span>`);
  }).join('');
  if (mems.length) {
    html += `<div class="card" style="grid-column:1/-1;margin:16px 0 0"><h3>Google's trips</h3><p class="sub" style="margin:0">${mems.length} trips Google Timeline recognised (incl. domestic)</p></div>`;
    html += mems.map(m => {
      const ccs = new Set(m.places.map(p => p.cc).filter(Boolean));
      const cities = new Set(m.places.map(p => p.city).filter(c => c >= 0));
      const to = Model.dkey(m.e, m.off);
      return card(m.d, to, ccs, cityList(cities) || 'Trip', `<span>🗓️ ${Math.max(1, Math.round((m.e - m.s) / DAY))} days</span><span>📏 ${fmt.n(m.km)} km from home</span><span>📍 ${m.dest.length} stops</span>`);
    }).join('');
  }
  $('#trip-list').innerHTML = html || '<p class="muted">No trips in this period.</p>';
  $$('#trip-list .trip').forEach(el => el.onclick = () => jumpToDay(el.dataset.d));
}

// ===================================================================== records
function renderRecords() {
  const R = [];
  const add = (ic, lbl, val, ctx, d) => R.push({ ic, lbl, val, ctx, d });
  const td = S.topDist[0]; if (td) add('🧭', 'Longest day', fmt.km(td.dist), fmt.date(td.d) + ` · ${[...td.cc].map(Geo.flag).join(' ')}`, td.d);
  const tp = S.topPlaces[0]; if (tp) add('📍', 'Most places in a day', tp.places.size, fmt.date(tp.d), tp.d);
  const tf = S.topFar[0]; if (tf && tf.far > 0) add('🌏', 'Farthest from home', fmt.n(tf.far) + ' km', fmt.date(tf.d) + ` · ${[...tf.cc].map(Geo.flag).join(' ')}`, tf.d);
  const tc = S.topCountries[0]; if (tc && tc.cc.size > 1) add('🛂', 'Most countries in a day', tc.cc.size, fmt.date(tc.d) + ' · ' + [...tc.cc].map(Geo.flag).join(' '), tc.d);
  for (const [m, ic, lbl] of [['walk', '🚶', 'Longest walk'], ['cycle', '🚲', 'Longest bike ride'], ['train', '🚆', 'Longest train ride'], ['car', '🚗', 'Longest drive'], ['bus', '🚌', 'Longest bus ride']]) {
    const a = S.modes[m].longest;
    if (a) add(ic, lbl, fmt.km(a.dist), `${fmt.dur(a.e - a.s)} · ${esc(fmt.city(a.sCity, a.sCc))} → ${esc(fmt.city(a.eCity, a.eCc))} · ${fmt.dateShort(a.d)}`, a.d);
  }
  const lf = [...S.flights].sort((a, b) => b.km - a.km)[0];
  if (lf) add('✈️', 'Longest flight', fmt.n(lf.km) + ' km', `${esc(fmt.place(lf.fromCity, lf.fromCc))} → ${esc(fmt.place(lf.toCity, lf.toCc))} · ${fmt.dateShort(lf.d)}`, lf.d);
  if (S.fastest) add('⚡', 'Fastest on the ground', fmt.n(S.fastest.kmh) + ' km/h', `${MODES[S.fastest.a.mode].icon} ${MODES[S.fastest.a.mode].label} · ${fmt.km(S.fastest.a.dist)} · ${fmt.dateShort(S.fastest.a.d)}`, S.fastest.a.d);
  if (S.longestVisit) add('⛺', 'Longest stay (not home)', fmt.dur(S.longestVisit.e - S.longestVisit.s), `${esc(fmt.place(S.longestVisit.city, S.longestVisit.cc))} · from ${fmt.dateShort(S.longestVisit.d)}`, S.longestVisit.d);
  if (S.streaks.walk.len) add('🔥', 'Walking streak', S.streaks.walk.len + ' days', `≥ 2 km every day · ${fmt.dateShort(S.streaks.walk.from)} → ${fmt.dateShort(S.streaks.walk.to)}`, S.streaks.walk.from);
  if (S.streaks.travel.len) add('🧳', 'Longest time abroad', S.streaks.travel.len + ' days', `${fmt.dateShort(S.streaks.travel.from)} → ${fmt.dateShort(S.streaks.travel.to)}`, S.streaks.travel.from);
  const fav = S.placeList.find(p => !/HOME|WORK/.test(p.type));
  if (fav) add('⭐', 'Favourite place (not home/work)', fmt.n(fav.n) + ' visits', `${placeLabel(fav)} · ${fmt.h(fav.ms)} total`, null);
  const bm = Object.entries(S.monthMode).map(([k, o]) => [k, Object.values(o).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1])[0];
  if (bm) add('📆', 'Biggest month', fmt.km(bm[1]), fmt.month(bm[0]), null);
  for (const [k, ic, lbl] of [['n', '⬆️', 'Northernmost'], ['s', '⬇️', 'Southernmost'], ['e', '➡️', 'Easternmost'], ['w', '⬅️', 'Westernmost']]) {
    const v = S.ext[k]; if (v) add(ic, lbl, esc(fmt.city(v.city, v.cc)), `${Geo.flag(v.cc)} ${fmt.n(k === 'n' || k === 's' ? v.lat : v.lng, 2)}° · ${fmt.dateShort(v.d)}`, v.d);
  }
  $('#record-grid').innerHTML = R.map((r, i) => `<div class="record ${r.d ? 'click' : ''}" data-i="${i}"><div class="ic">${r.ic}</div><div class="lbl">${r.lbl}</div><div class="val">${r.val}</div><div class="ctx">${r.ctx}</div></div>`).join('');
  $$('#record-grid .record.click').forEach(el => el.onclick = () => jumpToDay(R[+el.dataset.i].d));
}

// ===================================================================== busiest
function renderBusiest() {
  const key = { dist: d => d.dist, places: d => d.places.size, far: d => d.far, cc: d => d.cc.size * 1e6 + d.dist, walk: d => d.mode.walk || 0 }[busyMetric];
  const rows = [...S.days].sort((a, b) => key(b) - key(a)).slice(0, 15);
  table('t-busy', rows, [
    { h: '#', cls: 'num', v: (d, i) => `<span class="muted">${i + 1}</span>` },
    { h: 'Date', v: d => fmt.dateShort(d.d) },
    { h: 'Distance', cls: 'num', v: d => fmt.km(d.dist) },
    { h: 'Places', cls: 'num', v: d => d.places.size },
    { h: 'Walked', cls: 'num', v: d => fmt.km(d.mode.walk || 0) },
    { h: 'From home', cls: 'num', v: d => fmt.n(d.far) + ' km' },
    { h: 'Countries', v: d => [...d.cc].map(Geo.flag).join(' ') },
    { h: 'Modes', v: d => MODE_ORDER.filter(m => d.mode[m]).map(m => `<span title="${MODES[m].label}: ${fmt.km(d.mode[m])}">${MODES[m].icon}</span>`).join(' ') },
  ], d => jumpToDay(d.d));
}

// ===================================================================== wrapped
const WRAP_BG = [
  ['#1c5cab', '#6250d6'], ['#0f6e4f', '#1c5cab'], ['#a0401b', '#6b2b8f'], ['#6250d6', '#b03b6d'], ['#0d366b', '#0f6e4f'],
  ['#8a5a00', '#a0401b'], ['#3a2f8f', '#0d366b'], ['#b03b6d', '#a0401b'], ['#0f5f6e', '#3a2f8f'],
];
function renderWrapped() {
  if (!wrappedCache) wrappedCache = M.years.map(y => [y, Stats.compute(M, y)]);
  $('#wrapped-grid').innerHTML = wrappedCache.slice().reverse().map(([y, s], i) => {
    const bg = WRAP_BG[(M.years.length - 1 - i) % WRAP_BG.length];
    const topMode = MODE_ORDER.filter(m => m !== 'walk').sort((a, b) => s.modes[b].dist - s.modes[a].dist)[0];
    const topCity = s.cities[0];
    const newPlaces = Object.values(s.newPlacesByMonth).reduce((a, b) => a + b, 0);
    const best = s.topDist[0];
    return `<div class="wrap" data-y="${y}" style="background:linear-gradient(135deg, ${bg[0]}, ${bg[1]});outline:${F === y ? '3px solid var(--text)' : 'none'}">
      <div class="yr">${y}</div>
      <div class="big">${fmt.n(s.totalDist / 1000)} km</div>
      <div style="opacity:.85;font-size:12.5px">${s.tracked} days tracked · ${fmt.n(s.moveMs / 3600000)} h moving</div>
      <div class="rows">
        <div>Countries<b>${s.countryList.length}</b></div>
        <div>Cities<b>${s.cities.length}</b></div>
        <div>Flights<b>${s.flights.length}</b></div>
        <div>New places<b>${newPlaces}</b></div>
        <div>Walked<b>${fmt.n(s.modes.walk.dist / 1000)} km</b></div>
        <div>Top ride<b>${topMode && s.modes[topMode].dist ? MODES[topMode].icon + ' ' + MODES[topMode].label : '—'}</b></div>
        <div>Most time in<b>${topCity ? esc(fmt.city(topCity.ci)) : '—'}</b></div>
        <div>Biggest day<b>${best ? fmt.dateShort(best.d).replace(/ \d{4}$/, '') : '—'}</b></div>
      </div>
      <div class="flags">${s.countryList.map(c => Geo.flag(c.cc)).join('')}</div>
    </div>`;
  }).join('');
  $$('#wrapped-grid .wrap').forEach(el => el.onclick = () => { $(`#years button[data-y="${el.dataset.y}"]`).click(); document.getElementById('overview').scrollIntoView(); });
}

// ===================================================================== day explorer
function stepDay(dir) {
  const keys = [...M.days.keys()].sort();
  let i = keys.indexOf(currentDay);
  if (i < 0) i = keys.findIndex(k => k > currentDay) - (dir > 0 ? 1 : 0);
  const n = keys[Math.min(keys.length - 1, Math.max(0, i + dir))];
  if (n) showDay(n);
}
let dayLayers = [], replayTl = null;
function showDay(d, scroll) {
  if (!d) return;
  if (replayTl) { replayTl.kill(); replayTl = null; }
  currentDay = d;
  $('#day-input').value = d;
  const day = M.days.get(d);
  const idx = dayIdx.get(d) || { visits: [], acts: [] };
  $('#day-summary').innerHTML = day ? `${fmt.date(d)} · <b>${fmt.km(day.dist)}</b> · ${day.places.size} places · ${[...day.cc].map(Geo.flag).join(' ')}` : `${fmt.date(d)} · no data`;

  const m = map('m-day', { scrollWheelZoom: false });
  m._layers2.clearLayers();
  const bounds = [];
  // faint background trace of all GPS points that day
  const pi = ptsByDay.get(d) || [];
  const all = pi.map(i => [M.P.lat[i], M.P.lng[i]]);
  if (all.length > 1) L.polyline(all, { color: Theme.v('--muted'), weight: 2, opacity: .45, dashArray: '2 5' }).addTo(m._layers2);
  bounds.push(...all);
  const evs = [
    ...idx.visits.map(v => ({ k: 'v', s: v.s, o: v })),
    ...idx.acts.map(a => ({ k: 'a', s: a.s, o: a })),
  ].sort((a, b) => a.s - b.s);
  let n = 0;
  dayLayers = [];
  for (const ev of evs) {
    if (ev.k === 'a') {
      const a = ev.o;
      const line = [[a.sLat, a.sLng], ...pointsBetween(a.s, a.e), [a.eLat, a.eLng]];
      const pts = a.mode === 'flight' ? geodesic(line[0], line[line.length - 1]) : line;
      const pl = L.polyline(pts, { color: Theme.mode(a.mode), weight: a.mode === 'flight' ? 3 : 4, opacity: .9, renderer: m._svg })
        .bindTooltip(`${MODES[a.mode].icon} ${MODES[a.mode].label} · ${fmt.km(a.dist)} · ${fmt.dur(a.e - a.s)}`, { sticky: true }).addTo(m._layers2);
      dayLayers.push(pl); bounds.push(...line);
    } else {
      const v = ev.o; n++;
      const mk = L.marker([v.lat, v.lng], { icon: L.divIcon({ className: '', html: `<div class="num-marker">${n}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindPopup(`<b>${placeLabel(v)}</b> ${typeTag(v.type)}<br>${fmt.time(v.s, v.off)} – ${fmt.time(v.e, v.off)} (${fmt.dur(v.e - v.s)})<br><a href="${gmapsPlace(v.pid, v.lat, v.lng)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>`).addTo(m._layers2);
      dayLayers.push(mk); bounds.push([v.lat, v.lng]); ev.n = n;
    }
  }
  if (bounds.length) m.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 16 }); else m.setView([50, 10], 4);
  setTimeout(() => m.invalidateSize(), 50);

  const dayStart = Date.parse(d + 'T00:00:00Z');
  $('#day-list').innerHTML = evs.length ? evs.map((ev, i) => {
    if (ev.k === 'v') {
      const v = ev.o;
      return `<div class="ev" data-i="${i}"><div class="t">${fmt.time(Math.max(v.s, dayStart - v.off * 60000), v.off)}</div><div class="i"><span class="num-marker" style="width:20px;height:20px;font-size:10px">${ev.n}</span></div>
        <div><b>${placeLabel(v)}</b> ${typeTag(v.type)}<div class="x">${fmt.dur(v.e - v.s)} · until ${fmt.time(v.e, v.off)}</div></div></div>`;
    }
    const a = ev.o;
    return `<div class="ev" data-i="${i}"><div class="t">${fmt.time(a.s, a.off)}</div><div class="i">${MODES[a.mode].icon}</div>
      <div>${MODES[a.mode].label} <span class="muted">· ${fmt.km(a.dist)}</span><div class="x">${fmt.dur(a.e - a.s)} → ${esc(fmt.city(a.eCity, a.eCc))}</div></div></div>`;
  }).join('') : '<p class="muted">No visits or journeys recorded on this day.</p>';
  $$('#day-list .ev').forEach(el => el.onclick = () => {
    const l = dayLayers[+el.dataset.i];
    if (l.getLatLng) { m.setView(l.getLatLng(), 16); l.openPopup(); } else m.fitBounds(l.getBounds().pad(0.2));
  });
  $('#day-replay').disabled = !evs.length;
  if (Anim.on()) gsap.fromTo('#day-list .ev', { x: 16, opacity: 0 }, { x: 0, opacity: 1, duration: .4, stagger: .025, ease: 'power2.out' });

  const md = d.slice(5);
  const others = M.years.map(y => `${y}-${md}`).filter(k => k !== d && M.days.has(k));
  $('#on-this-day').innerHTML = others.length ? `<span class="muted small">On this day:</span>` + others.map(k => {
    const o = M.days.get(k);
    return `<button class="btn ghost" data-d="${k}">${k.slice(0, 4)} · ${fmt.km(o.dist)} ${[...o.cc].map(Geo.flag).join('')}</button>`;
  }).join('') : '';
  $$('#on-this-day button').forEach(b => b.onclick = () => showDay(b.dataset.d));
  if (scroll) document.getElementById('day').scrollIntoView();
}

// Plays the day back: each journey is drawn in order, each stop pops in and lights up in the list.
function replayDay() {
  if (!dayLayers.length) return;
  if (replayTl) replayTl.kill();
  if (!Anim.on()) return;
  const items = $$('#day-list .ev');
  const m = Maps.get('m-day');
  m.closePopup();
  const prep = dayLayers.map(l => {
    if (l._path) { const len = l._path.getTotalLength(); gsap.set(l._path, { strokeDasharray: len, strokeDashoffset: len }); return { l, len }; }
    const el = l.getElement && l.getElement(); if (el) gsap.set(el.firstChild, { scale: 0, opacity: 0 });
    return { l, el };
  });
  gsap.set(items, { opacity: .3 });
  replayTl = gsap.timeline({ onComplete: () => { prep.forEach(p => { if (p.len) { p.l._path.style.strokeDasharray = ''; p.l._path.style.strokeDashoffset = ''; } }); gsap.to(items, { opacity: 1, duration: .3 }); } });
  prep.forEach((p, i) => {
    const li = items[i];
    if (p.len) {
      const a = p.l;
      replayTl.add(() => { li && li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, '+=0')
        .to(li || {}, { opacity: 1, duration: .2 }, '<')
        .to(a._path, { strokeDashoffset: 0, duration: Math.min(1.6, .45 + p.len / 900), ease: 'power1.inOut' }, '<');
    } else if (p.el) {
      replayTl.add(() => { li && li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); })
        .to(li || {}, { opacity: 1, duration: .2 }, '<')
        .to(p.el.firstChild, { scale: 1, opacity: 1, duration: .45, ease: 'back.out(3)' }, '<')
        .to({}, { duration: .25 });
    }
  });
}

// ===================================================================== quality
function renderQuality() {
  const allDays = [...M.days.keys()].sort();
  const span = (Date.parse(allDays[allDays.length - 1]) - Date.parse(allDays[0])) / DAY + 1;
  const tz = new Set(M.visits.map(v => v.off));
  tiles('quality-tiles', [
    { icon: '🧩', k: 'Visits', v: +((M.visits.length) || 0).toFixed(0), dec: 0, d: `${fmt.n(M.placeLoc.size)} unique places` },
    { icon: '🛤️', k: 'Journeys', v: +((M.acts.length) || 0).toFixed(0), dec: 0 },
    { icon: '📡', k: 'GPS points', v: +((M.P.t.length) || 0).toFixed(0), dec: 0, d: `${fmt.n(M.rawSignals)} raw signals` },
    { icon: '📅', k: 'Coverage', v: +((100 * allDays.length / span) || 0).toFixed(0), dec: 0, u: '%', d: `${fmt.n(allDays.length)} of ${fmt.n(span)} days` },
    { icon: '🕰️', k: 'Time zones', v: tz.size, d: [...tz].sort((a, b) => a - b).map(o => (o >= 0 ? '+' : '−') + (Math.abs(o) % 60 ? fmt.hhmm(Math.abs(o) / 60) : Math.abs(o) / 60)).join(' · ') + ' UTC' },
    { icon: '🔎', k: 'Inferred flights', v: M.flights.filter(f => f.inferred).length, d: 'reconstructed from gaps & speed' },
  ]);
  const months = {};
  for (const d of allDays) months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + 1;
  const first = allDays[0].slice(0, 7), last = allDays[allDays.length - 1].slice(0, 7);
  const mk = [];
  for (let y = +first.slice(0, 4), mo = +first.slice(5); `${y}-${String(mo).padStart(2, '0')}` <= last; mo === 12 ? (y++, mo = 1) : mo++) mk.push(`${y}-${String(mo).padStart(2, '0')}`);
  chart('c-coverage', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v + ' days' },
    xAxis: { type: 'category', data: mk.map(fmt.month) }, yAxis: { type: 'value', max: 31 },
    series: [{ type: 'bar', data: mk.map(k => ({ value: months[k] || 0, itemStyle: { opacity: F === 'all' || +k.slice(0, 4) === F ? 1 : .3 } })), itemStyle: { color: Theme.series(1) } }],
  });
  const aff = ((M.profile.persona || {}).travelModeAffinities || []).filter(a => RAW_MODE[a.mode]);
  chart('c-persona', {
    grid: { left: 8, right: 50, top: 4, bottom: 4 },
    tooltip: { trigger: 'item', formatter: p => `${p.name}: <b>${fmt.n(p.value * 100)}%</b>` },
    xAxis: { type: 'value', max: 1, axisLabel: { formatter: v => v * 100 + '%' } },
    yAxis: { type: 'category', inverse: true, data: aff.map(a => MODES[RAW_MODE[a.mode]].icon + ' ' + a.mode.replace(/^IN_/, '').replace(/_/g, ' ').toLowerCase()), axisLabel: { color: Theme.v('--text-2') } },
    series: [{ type: 'bar', barWidth: '58%', data: aff.map(a => ({ value: +a.affinity.toFixed(3), itemStyle: { color: Theme.mode(RAW_MODE[a.mode]), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: Theme.v('--text-2'), formatter: p => fmt.n(p.value * 100) + '%' } }],
  });
}

initLanding();
