// Shared UI helpers: formatting, theme tokens, chart + map factories, tables, tiles.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = {
  n: (x, d = 0) => (x ?? 0).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }),
  km: m => fmt.n(m / 1000, m < 10000 ? 1 : 0) + ' km',
  kmN: m => fmt.n(m / 1000, m < 10000 ? 1 : 0),
  h: ms => { const h = ms / 3600000; return h >= 100 ? fmt.n(h) + ' h' : h >= 1 ? fmt.n(h, 1) + ' h' : fmt.n(ms / 60000) + ' min'; },
  dur: ms => { const m = Math.round(ms / 60000); if (m < 60) return m + ' min'; const h = Math.floor(m / 60); if (h < 48) return h + ' h ' + (m % 60) + ' min'; return fmt.n(h / 24, 1) + ' days'; },
  date: d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  dateShort: d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  month: m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  time: (t, off) => { const d = Model.local(t, off); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); },
  hhmm: h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0'),
  city: (ci, cc) => { const n = Geo.cityName(ci); return n ? n : (cc ? Geo.info(cc).name : 'Unknown'); },
  place: (ci, cc) => { const n = Geo.cityName(ci); const c = cc || Geo.cityCountry(ci); return (c ? Geo.flag(c) + ' ' : '') + (n || (c ? Geo.info(c).name : 'Unknown')); },
};

const Theme = {
  v: name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
  series: i => Theme.v('--s' + i),
  mode: m => Theme.v('--s' + MODES[m].color),
  seq: () => [0, 1, 2, 3, 4, 5].map(i => Theme.v('--seq' + i)),
  dark: () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  },
};

// ---------- charts ----------
const Charts = new Map();
function chart(id, option) {
  const el = document.getElementById(id);
  if (!el) return null;
  let c = Charts.get(id);
  if (c && c.getDom() !== el) { c.dispose(); c = null; }
  if (!c) { c = echarts.init(el, null, { renderer: 'canvas' }); Charts.set(id, c); }
  const text = Theme.v('--text'), text2 = Theme.v('--text-2'), muted = Theme.v('--muted'), border = Theme.v('--border'), surface = Theme.v('--surface');
  const base = {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: text2 },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: surface, borderColor: border, textStyle: { color: text, fontSize: 12.5 }, extraCssText: 'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12)',
      confine: true,
    },
    legend: { textStyle: { color: text2 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, top: 0 },
  };
  const axisStyle = ax => Object.assign({
    axisLine: { lineStyle: { color: border } }, axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: border, opacity: .6 } },
  }, ax);
  const opt = Object.assign({}, base, option);
  opt.tooltip = Object.assign({}, base.tooltip, option.tooltip || {});
  if (option.legend) opt.legend = Object.assign({}, base.legend, option.legend);
  if (option.grid) opt.grid = Object.assign({}, base.grid, option.grid);
  for (const k of ['xAxis', 'yAxis']) if (opt[k]) opt[k] = Array.isArray(opt[k]) ? opt[k].map(axisStyle) : axisStyle(opt[k]);
  opt.animationDuration = 1000; opt.animationEasing = 'cubicOut'; opt.animationDurationUpdate = 700;
  if (Array.isArray(opt.series)) opt.series = opt.series.map((sr, si) => sr.type === 'bar' || sr.type === 'heatmap'
    ? Object.assign({ animationDelay: i => Math.min(i * 18, 900) + si * 60 }, sr) : sr);
  if (Anim.on() && !el.dataset.shown) {
    el._pending = opt;
    if (!el._io) {
      el._io = new IntersectionObserver(es => es.forEach(en => {
        if (!en.isIntersecting) return;
        el.dataset.shown = '1'; el._io.disconnect();
        c.resize(); c.setOption(el._pending, true);
      }), { rootMargin: '0px 0px -12% 0px' });
      el._io.observe(el);
    }
    return c;
  }
  c.setOption(opt, true);
  return c;
}
window.addEventListener('resize', () => { for (const c of Charts.values()) c.resize(); });

// ---------- maps ----------
const Maps = new Map();
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
const tileUrl = () => ESRI + (Theme.dark() ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base') + '/MapServer/tile/{z}/{y}/{x}';
const labelUrl = () => ESRI + (Theme.dark() ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference') + '/MapServer/tile/{z}/{y}/{x}';
function map(id, opts = {}) {
  let m = Maps.get(id);
  if (!m) {
    m = L.map(id, Object.assign({ zoomControl: true, worldCopyJump: true, preferCanvas: true, gestureHandling: !!L.GestureHandler }, opts));
    m._tiles = L.tileLayer(tileUrl(), { maxNativeZoom: 16, maxZoom: 19, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' }).addTo(m);
    m.createPane('labels'); m.getPane('labels').style.zIndex = 450; m.getPane('labels').style.pointerEvents = 'none';
    m._labels = L.tileLayer(labelUrl(), { maxNativeZoom: 16, maxZoom: 19, pane: 'labels' }).addTo(m);
    m._svg = L.svg({ padding: 0.5 });
    m._layers2 = L.layerGroup().addTo(m);
    Maps.set(id, m);
  }
  return m;
}
function retileMaps() { for (const m of Maps.values()) { m._tiles.setUrl(tileUrl()); m._labels.setUrl(labelUrl()); } }
// Great-circle interpolation for flight arcs.
function geodesic(a, b, n = 64) {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const [la1, lo1, la2, lo2] = [a[0] * toR, a[1] * toR, b[0] * toR, b[1] * toR];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d === 0) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([Math.atan2(z, Math.sqrt(x * x + y * y)) * toD, Math.atan2(y, x) * toD]);
  }
  for (let i = 1; i < pts.length; i++) { // keep longitudes continuous
    while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
    while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
  }
  return pts;
}

// ---------- DOM builders ----------
function tiles(id, items) {
  document.getElementById(id).innerHTML = items.map(t => `
    <div class="tile">
      <div class="k">${t.icon ? `<span>${t.icon}</span>` : ''}${esc(t.k)}</div>
      <div class="v">${typeof t.v === 'number' && isFinite(t.v) ? `<span data-count="${t.v}" data-dec="${t.dec || 0}" data-key="${id}:${esc(t.k)}">${fmt.n(t.v, t.dec || 0)}</span>` : t.v}${t.u ? `<small>${esc(t.u)}</small>` : ''}</div>
      ${t.d ? `<div class="d">${t.d}</div>` : ''}
    </div>`).join('');
}
// cols: [{h, v:(row)=>html, cls}] ; onClick(row)
function table(id, rows, cols, onClick) {
  const el = document.getElementById(id);
  if (!rows.length) { el.innerHTML = '<p class="muted">Nothing here for this period.</p>'; return; }
  el.innerHTML = `<div class="tbl"><table><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${onClick ? 'click' : ''}">${cols.map(c => `<td class="${c.cls || ''}">${c.v(r, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  if (onClick) $$('tr.click', el).forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('a')) return; onClick(rows[+tr.dataset.i]); }));
}
function seg(id, onChange) {
  const el = document.getElementById(id);
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', el).forEach(x => x.classList.toggle('on', x === b));
    onChange(b.dataset.m);
  });
  return () => $('button.on', el).dataset.m;
}
// Google Maps link: shows the real place (name, photos) when we have a genuine place id, else the coordinates.
const realPid = pid => /^[A-Za-z0-9_-]{20,}$/.test(pid || '');
const gmapsPlace = (pid, lat, lng) => lat != null
  ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${realPid(pid) ? '&query_place_id=' + encodeURIComponent(pid) : ''}`
  : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(pid)}`;
// Without a name, describe a place by city + distance/direction from that city's centre ("Aachen · 1.2 km NE").
function whereIn(p) {
  if (p.city == null || p.city < 0) return '';
  const [la, lo] = Geo.cityLL(p.city);
  const km = haversine(la, lo, p.lat, p.lng) / 1000;
  if (km < 0.4) return 'centre';
  const deg = (Math.atan2((p.lng - lo) * Math.cos(la * Math.PI / 180), p.lat - la) * 180 / Math.PI + 360) % 360;
  return `${fmt.n(km, km < 10 ? 1 : 0)} km ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]}`;
}
const placeLabel = p => p.name
  ? `${esc(p.name)} <span class="muted small">${esc(fmt.city(p.city, p.cc))}</span>`
  : `${esc(fmt.place(p.city, p.cc))} <span class="muted small">${whereIn(p)}</span>`;
// Overlay a friendly note on a chart/map container when there is nothing to show.
function emptyNote(id, isEmpty, msg = 'Nothing to show for this period') {
  const el = document.getElementById(id); if (!el) return;
  const host = el.closest('.card') || el.parentElement;
  host.classList.add('has-empty');
  let n = host.querySelector(':scope > .empty-note');
  if (!isEmpty) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement('div'); n.className = 'empty-note'; host.appendChild(n); }
  n.innerHTML = `<span>${esc(msg)}</span>`;
}
const typeTag = t => {
  if (t === 'HOME' || t === 'INFERRED_HOME') return '<span class="tag home">Home</span>';
  if (t === 'WORK' || t === 'INFERRED_WORK') return '<span class="tag work">Work</span>';
  if (t === 'SEARCHED_ADDRESS') return '<span class="tag">Searched</span>';
  if (t === 'ALIASED_LOCATION') return '<span class="tag">Saved</span>';
  return '';
};
