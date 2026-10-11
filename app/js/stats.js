// Aggregations over the model for a given year filter ('all' or a number).
const Stats = (() => {
  const inY = (y, f) => f === 'all' || y === f;

  function compute(M, f) {
    const acts = M.acts.filter(a => inY(a.y, f));
    const visits = M.visits.filter(v => v.lvl === 0 && inY(v.y, f));
    const days = [...M.days.values()].filter(d => inY(d.y, f)).sort((a, b) => a.d < b.d ? -1 : 1);
    const flights = M.flights.filter(x => inY(x.y, f));
    const commutes = M.commutes.filter(c => inY(c.y, f));
    const mems = M.mems.filter(m => inY(m.y, f));

    // --- modes -------------------------------------------------------------
    const modes = {};
    for (const m of MODE_ORDER) modes[m] = { dist: 0, ms: 0, n: 0, longest: null, fastest: null };
    for (const a of acts) {
      const o = modes[a.mode];
      o.dist += a.dist; o.ms += a.e - a.s; o.n++;
      if (!o.longest || a.dist > o.longest.dist) o.longest = a;
    }
    const totalDist = acts.reduce((s, a) => s + a.dist, 0);
    const moveMs = acts.reduce((s, a) => s + (a.e - a.s), 0);
    const co2 = MODE_ORDER.reduce((s, m) => s + modes[m].dist / 1000 * MODES[m].co2, 0);

    // --- per-year x mode (always across all years, for trend charts) -------
    const yearMode = {};
    for (const a of M.acts) {
      const o = yearMode[a.y] || (yearMode[a.y] = {});
      o[a.mode] = (o[a.mode] || 0) + a.dist;
    }
    const monthMode = {};
    for (const a of acts) {
      const k = a.d.slice(0, 7);
      const o = monthMode[k] || (monthMode[k] = {});
      o[a.mode] = (o[a.mode] || 0) + a.dist;
    }

    // --- rhythms ------------------------------------------------------------
    const punch = Array.from({ length: 7 }, () => new Array(24).fill(0)); // moving minutes
    for (const a of acts) {
      // spread minutes across the hours the activity covers
      let t = a.s; const end = a.e;
      while (t < end) {
        const dl = Model.local(t, a.off);
        const next = Math.min(end, t + (60 - dl.getUTCMinutes()) * 60000 - dl.getUTCSeconds() * 1000);
        punch[(dl.getUTCDay() + 6) % 7][dl.getUTCHours()] += (Math.max(next, t + 1000) - t) / 60000;
        t = Math.max(next, t + 1000);
      }
    }
    const byWeekday = new Array(7).fill(0).map(() => ({ dist: 0, n: 0 }));
    for (const d of days) {
      const wd = (new Date(d.d + 'T00:00:00Z').getUTCDay() + 6) % 7;
      byWeekday[wd].dist += d.dist; byWeekday[wd].n++;
    }
    const byMonth = new Array(12).fill(0).map(() => ({ dist: 0, n: 0 }));
    for (const d of days) { const m = +d.d.slice(5, 7) - 1; byMonth[m].dist += d.dist; byMonth[m].n++; }

    // --- places --------------------------------------------------------------
    const places = new Map();
    for (const v of visits) {
      let p = places.get(v.pid);
      if (!p) places.set(v.pid, p = { pid: v.pid, lat: v.lat, lng: v.lng, type: v.type, name: v.name, cc: v.cc, city: v.city, n: 0, ms: 0, first: v.s, last: v.s, days: new Set(), hours: new Array(24).fill(0) });
      p.n++; p.ms += v.e - v.s; p.last = v.s; p.days.add(v.d);
      if (v.type !== 'UNKNOWN') p.type = v.type;
      p.hours[Model.local(v.s, v.off).getUTCHours()]++;
    }
    const placeList = [...places.values()].sort((a, b) => b.ms - a.ms);
    // exploration: first-ever visits per month (relative to whole history)
    const firstSeen = new Map();
    for (const v of M.visits) if (v.lvl === 0 && !firstSeen.has(v.pid)) firstSeen.set(v.pid, v.d.slice(0, 7));
    const newPlacesByMonth = {};
    for (const [, m] of firstSeen) if (f === 'all' || +m.slice(0, 4) === f) newPlacesByMonth[m] = (newPlacesByMonth[m] || 0) + 1;

    // --- countries & cities --------------------------------------------------
    const countries = new Map();
    for (const d of days) for (const cc of d.cc) {
      let c = countries.get(cc);
      if (!c) countries.set(cc, c = { cc, days: 0, vdays: 0, first: d.d, last: d.d, cities: new Set(), dates: [] });
      c.days++; c.last = d.d; c.dates.push(d.d);
      if (d.vcc.has(cc)) c.vdays++;
    }
    const cities = new Map();
    for (const d of days) for (const ci of d.cities) {
      let c = cities.get(ci);
      if (!c) cities.set(ci, c = { ci, days: 0, first: d.d, last: d.d });
      c.days++; c.last = d.d;
      const cc = Geo.cityCountry(ci); if (countries.has(cc)) countries.get(cc).cities.add(ci);
    }
    // stays: consecutive runs of days per country (a gap > 2 days starts a new stay)
    for (const c of countries.values()) {
      let stays = 0, prev = null;
      for (const d of c.dates) { if (!prev || (Date.parse(d) - Date.parse(prev)) > 2 * DAY) stays++; prev = d; }
      c.stays = stays;
    }
    const countryList = [...countries.values()].sort((a, b) => b.days - a.days);
    const continents = new Set(countryList.map(c => Geo.info(c.cc).cont).filter(Boolean));

    // --- home / work -----------------------------------------------------------
    const homeMs = days.reduce((s, d) => s + d.homeMs, 0);
    const workMs = days.reduce((s, d) => s + d.workMs, 0);
    const otherMs = days.reduce((s, d) => s + Math.max(0, d.visitMs - d.homeMs - d.workMs), 0);
    const workByWeek = {};
    for (const d of days) if (d.workMs > 0) {
      const wk = isoWeek(d.d); workByWeek[wk] = (workByWeek[wk] || 0) + d.workMs / 3600000;
    }
    const workArr = [], workLeave = [];
    for (const v of visits) if (v.type === 'WORK' || v.type === 'INFERRED_WORK') {
      const a = Model.local(v.s, v.off), b = Model.local(v.e, v.off);
      if (v.e - v.s > 2 * 3600000 && v.e - v.s < 14 * 3600000) { workArr.push(a.getUTCHours() + a.getUTCMinutes() / 60); workLeave.push(b.getUTCHours() + b.getUTCMinutes() / 60); }
    }

    // --- records -------------------------------------------------------------
    const by = (k, n = 10) => [...days].sort((a, b) => b[k] - a[k]).slice(0, n);
    const topDist = by('dist'), topPlaces = [...days].sort((a, b) => b.places.size - a.places.size).slice(0, 10);
    const topFar = by('far'), topCountries = [...days].sort((a, b) => b.cc.size - a.cc.size).slice(0, 10);
    const walkDays = [...days].sort((a, b) => (b.mode.walk || 0) - (a.mode.walk || 0)).slice(0, 10);

    const streak = (pred) => {
      let best = { len: 0 }, cur = null, prev = null;
      for (const d of days) {
        const ok = pred(d);
        const contiguous = prev && Date.parse(d.d) - Date.parse(prev) === DAY;
        if (ok) { cur = (cur && contiguous) ? { ...cur, to: d.d, len: cur.len + 1 } : { from: d.d, to: d.d, len: 1 }; if (cur.len > best.len) best = cur; }
        else cur = null;
        prev = d.d;
      }
      return best;
    };
    const homeCountryOf = d => { const e = Model.eraAt(M.homeEras, d.slice(0, 7)); return e && e.cc; };
    const streaks = {
      walk: streak(d => (d.mode.walk || 0) >= 2000),
      travel: streak(d => [...d.cc].some(c => c !== homeCountryOf(d.d))),
      active: streak(d => ((d.mode.walk || 0) + (d.mode.cycle || 0)) >= 5000),
    };

    // extremes
    let ext = { n: null, s: null, e: null, w: null };
    for (const v of visits) {
      if (!ext.n || v.lat > ext.n.lat) ext.n = v; if (!ext.s || v.lat < ext.s.lat) ext.s = v;
      if (!ext.e || v.lng > ext.e.lng) ext.e = v; if (!ext.w || v.lng < ext.w.lng) ext.w = v;
    }
    const fastest = acts.filter(a => a.mode !== 'flight' && a.mode !== 'other' && !a.glitch && a.dist > 5000 && a.e - a.s > 5 * 60000)
      .map(a => ({ a, kmh: a.dist / 1000 / ((a.e - a.s) / 3600000) })).sort((x, y) => y.kmh - x.kmh)[0];
    const longestVisit = visits.filter(v => v.type !== 'HOME' && v.type !== 'INFERRED_HOME').sort((a, b) => (b.e - b.s) - (a.e - a.s))[0];

    // radius of gyration per month (how spread out life was)
    const gyr = {};
    const byM = {};
    for (const v of visits) { const k = v.d.slice(0, 7); (byM[k] || (byM[k] = [])).push(v); }
    for (const k of Object.keys(byM).sort()) {
      const vs = byM[k]; let W = 0, la = 0, lo = 0;
      for (const v of vs) { const w = (v.e - v.s) / 3600000 + 0.1; W += w; la += v.lat * w; lo += v.lng * w; }
      la /= W; lo /= W;
      let s = 0; for (const v of vs) { const w = (v.e - v.s) / 3600000 + 0.1; s += w * (haversine(la, lo, v.lat, v.lng) / 1000) ** 2; }
      gyr[k] = Math.sqrt(s / W);
    }

    // trains
    const trains = acts.filter(a => a.mode === 'train');
    const routes = new Map();
    for (const t of trains) {
      const A = Geo.cityName(t.sCity) || '?', B = Geo.cityName(t.eCity) || '?';
      if (A === B) continue;
      const k = [A, B].sort().join(' ⇄ ');
      const r = routes.get(k) || { k, n: 0, dist: 0, ms: 0 };
      r.n++; r.dist += t.dist; r.ms += t.e - t.s; routes.set(k, r);
    }

    // airports-ish: cities you flew from/to
    const airports = new Map();
    for (const fl of flights) for (const ci of [fl.fromCity, fl.toCity]) airports.set(ci, (airports.get(ci) || 0) + 1);

    return {
      f, acts, visits, days, flights, commutes, mems, modes, totalDist, moveMs, co2, yearMode, monthMode, punch, byWeekday, byMonth,
      placeList, newPlacesByMonth, countryList, cities: [...cities.values()].sort((a, b) => b.days - a.days), continents,
      homeMs, workMs, otherMs, workByWeek, workArr, workLeave, topDist, topPlaces, topFar, topCountries, walkDays, streaks, ext,
      fastest, longestVisit, gyr, trains, routes: [...routes.values()].sort((a, b) => b.n - a.n), airports,
      tracked: days.length,
    };
  }

  function isoWeek(dstr) {
    const d = new Date(dstr + 'T00:00:00Z');
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const y = d.getUTCFullYear();
    const w = 1 + Math.round(((d - Date.UTC(y, 0, 4)) / DAY - 3 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7)) / 7);
    return y + '-W' + String(w).padStart(2, '0');
  }

  return { compute, isoWeek };
})();
