// Turns the raw Google Timeline export (on-device "semanticSegments" format) into an
// enriched, analysis-friendly model. All times are UTC ms; `off` is the local UTC offset
// in minutes at that moment, so local wall-clock = new Date(t + off*60000) read with getUTC*.

const MODES = {
  walk:   { label: 'Walking',       icon: '🚶', co2: 0,     color: 1 },
  cycle:  { label: 'Cycling',       icon: '🚲', co2: 0,     color: 3 },
  bus:    { label: 'Bus',           icon: '🚌', co2: 0.089, color: 4 },
  train:  { label: 'Train',         icon: '🚆', co2: 0.035, color: 7 },
  metro:  { label: 'Metro & tram',  icon: '🚇', co2: 0.03,  color: 5 },
  car:    { label: 'Car & moto',    icon: '🚗', co2: 0.17,  color: 2 },
  flight: { label: 'Flying',        icon: '✈️', co2: 0.13,  color: 8 },
  boat:   { label: 'Ferry & boat',  icon: '⛴️', co2: 0.11,  color: 6 },
  other:  { label: 'Other',         icon: '❔', co2: 0,     color: 0 },
};
const MODE_ORDER = ['walk', 'cycle', 'bus', 'train', 'metro', 'car', 'flight', 'boat', 'other'];
const RAW_MODE = {
  WALKING: 'walk', RUNNING: 'walk', ON_FOOT: 'walk', CYCLING: 'cycle', ON_BICYCLE: 'cycle',
  IN_BUS: 'bus', IN_TRAIN: 'train', IN_SUBWAY: 'metro', IN_TRAM: 'metro',
  IN_PASSENGER_VEHICLE: 'car', IN_VEHICLE: 'car', IN_TAXI: 'car', MOTORCYCLING: 'car', IN_ROAD_VEHICLE: 'car',
  FLYING: 'flight', IN_FERRY: 'boat', BOATING: 'boat', SAILING: 'boat',
};
const DAY = 86400000;
// Upper bound on plausible average speed per mode (km/h), used to clean GPS glitches.
const MAX_KMH = { walk: 12, cycle: 45, bus: 130, car: 220, metro: 130, train: 360, boat: 90, other: 250 };

const Model = (() => {
  const ll = s => { const i = s.indexOf(','); return [parseFloat(s), parseFloat(s.slice(i + 1))]; };
  const isoOff = s => { const m = /([+-])(\d\d):(\d\d)$/.exec(s); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; };
  const local = (t, off) => new Date(t + off * 60000);
  const dkey = (t, off) => local(t, off).toISOString().slice(0, 10);
  const tick = () => new Promise(r => setTimeout(r, 0));

  // Calls fn(dateKey, ms) for every local day the interval [s,e) touches.
  function splitByDay(s, e, off, fn) {
    if (e <= s) return;
    let ls = s + off * 60000; const le = e + off * 60000;
    while (ls < le) {
      const dayEnd = Math.floor(ls / DAY) * DAY + DAY;
      const end = Math.min(dayEnd, le);
      fn(new Date(ls).toISOString().slice(0, 10), end - ls);
      ls = end;
    }
  }

  async function build(raw, progress) {
    const segs = raw.semanticSegments || [];
    progress('Sorting ' + segs.length.toLocaleString() + ' segments…', 10);
    await tick();
    const items = segs.map(s => [Date.parse(s.startTime), s]).sort((a, b) => a[0] - b[0]);

    const visits = [], acts = [], mems = [];
    const P = { lat: [], lng: [], t: [], off: [] };
    let lastOff = null;
    for (const [t0, s] of items) {
      const t1 = Date.parse(s.endTime);
      let off = s.startTimeTimezoneUtcOffsetMinutes;
      if (off == null) off = lastOff ?? isoOff(s.startTime); else lastOff = off;

      if (s.visit) {
        const tc = s.visit.topCandidate || {};
        if (!tc.placeLocation || !tc.placeLocation.latLng) continue;
        const [lat, lng] = ll(tc.placeLocation.latLng);
        if (!(t1 > t0)) continue;
        visits.push({ s: t0, e: t1, off, lat, lng, pid: tc.placeId || tc.placeLocation.latLng, type: tc.semanticType || 'UNKNOWN', lvl: s.visit.hierarchyLevel || 0, name: tc.name || null });
      } else if (s.activity) {
        const a = s.activity;
        if (!a.start || !a.end) continue;
        const [sLat, sLng] = ll(a.start.latLng), [eLat, eLng] = ll(a.end.latLng);
        const straight = haversine(sLat, sLng, eLat, eLng);
        const rawType = (a.topCandidate && a.topCandidate.type) || 'UNKNOWN_ACTIVITY_TYPE';
        acts.push({ s: t0, e: t1, off, rawType, mode: RAW_MODE[rawType] || 'other', dist: Math.max(a.distanceMeters || 0, straight), straight, sLat, sLng, eLat, eLng });
      } else if (s.timelinePath) {
        for (const p of s.timelinePath) {
          const [lat, lng] = ll(p.point);
          P.lat.push(lat); P.lng.push(lng); P.t.push(Date.parse(p.time)); P.off.push(off);
        }
      } else if (s.timelineMemory && s.timelineMemory.trip) {
        const tr = s.timelineMemory.trip;
        mems.push({ s: t0, e: t1, off, km: tr.distanceFromOriginKms || 0, dest: (tr.destinations || []).map(d => d.identifier && d.identifier.placeId).filter(Boolean) });
      }
    }

    // Data cleaning. Phones produce glitches: a "3,600 km walk" or a 5,000 km "car ride" at 700 km/h.
    let cleaned = 0;
    for (const a of acts) {
      const hrs = Math.max((a.e - a.s) / 3600000, 1 / 60);
      const straightKmh = a.straight / 1000 / hrs, distKmh = a.dist / 1000 / hrs;
      if (a.mode === 'flight') continue;
      if (a.straight > 300000 && straightKmh > 200) { a.mode = 'flight'; a.reclassified = true; a.dist = a.straight; cleaned++; continue; }
      const max = MAX_KMH[a.mode] || 250;
      if (distKmh > max) {
        cleaned++;
        if (straightKmh <= max) a.dist = a.straight;               // path length was junk, endpoints fine
        else { a.mode = 'other'; a.dist = a.straight; a.glitch = true; } // whole segment is a teleport
      }
    }

    progress('Reverse-geocoding places (offline)…', 30);
    await tick();
    Geo.init();
    const pidGeo = new Map();
    for (const v of visits) {
      let g = pidGeo.get(v.pid);
      if (!g) { g = { cc: Geo.country(v.lat, v.lng), city: Geo.city(v.lat, v.lng) }; pidGeo.set(v.pid, g); }
      v.cc = g.cc; v.city = g.city;
      const d = local(v.s, v.off);
      v.d = d.toISOString().slice(0, 10); v.y = d.getUTCFullYear();
    }
    progress('Geocoding journeys…', 45);
    await tick();
    for (const a of acts) {
      a.sCc = Geo.country(a.sLat, a.sLng); a.eCc = Geo.country(a.eLat, a.eLng);
      a.sCity = Geo.city(a.sLat, a.sLng); a.eCity = Geo.city(a.eLat, a.eLng);
      const d = local(a.s, a.off);
      a.d = d.toISOString().slice(0, 10); a.y = d.getUTCFullYear(); a.h = d.getUTCHours(); a.wd = (d.getUTCDay() + 6) % 7;
    }

    progress('Detecting flights…', 55);
    await tick();
    const flights = detectFlights(visits, acts);
    const flightIv = flights.map(f => [f.s - 15 * 60000, f.e + 15 * 60000]).sort((a, b) => a[0] - b[0]);

    progress('Placing ' + P.t.length.toLocaleString() + ' GPS points in countries…', 62);
    await tick();
    const n = P.t.length;
    P.cc = new Array(n); P.d = new Array(n);
    let fi = 0;
    // points are roughly time-ordered per segment; sort an index for the flight sweep
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => P.t[a] - P.t[b]);
    for (const i of order) {
      const t = P.t[i];
      while (fi < flightIv.length && flightIv[fi][1] < t) fi++;
      const airborne = fi < flightIv.length && flightIv[fi][0] <= t;
      P.cc[i] = airborne ? null : Geo.country(P.lat[i], P.lng[i]);
      P.d[i] = dkey(t, P.off[i]);
    }
    P.order = order;

    progress('Working out where you lived and worked…', 75);
    await tick();
    const homeEras = eras(visits, ['HOME', 'INFERRED_HOME']);
    const workEras = eras(visits, ['WORK', 'INFERRED_WORK']);

    progress('Building daily summaries…', 82);
    await tick();
    const days = buildDays(visits, acts, P, homeEras, flights);
    const commutes = detectCommutes(visits, acts);

    const placeLoc = new Map();
    for (const v of visits) if (!placeLoc.has(v.pid)) placeLoc.set(v.pid, v);
    for (const m of mems) {
      m.places = m.dest.map(pid => placeLoc.get(pid)).filter(Boolean);
      const d = local(m.s, m.off);
      m.d = d.toISOString().slice(0, 10); m.y = d.getUTCFullYear();
    }

    const years = [...new Set([...days.keys()].map(d => +d.slice(0, 4)))].sort();
    return {
      visits, acts, P, mems, flights, homeEras, workEras, days, commutes, years, placeLoc,
      profile: raw.userLocationProfile || {}, rawSignals: (raw.rawSignals || []).length, cleaned, sources: raw.sources || [],
    };
  }

  // Month-by-month dominant HOME / WORK place, compressed into eras.
  function eras(visits, types) {
    const byMonth = new Map();
    for (const v of visits) {
      if (v.lvl !== 0 || !types.includes(v.type)) continue;
      const m = v.d.slice(0, 7);
      let o = byMonth.get(m); if (!o) byMonth.set(m, o = new Map());
      o.set(v.pid, (o.get(v.pid) || 0) + (v.e - v.s));
    }
    const months = [...byMonth.keys()].sort();
    const runs = [];
    for (const m of months) {
      const [pid] = [...byMonth.get(m).entries()].sort((a, b) => b[1] - a[1])[0];
      const last = runs[runs.length - 1];
      if (last && last.pid === pid) { last.to = m; last.months++; }
      else runs.push({ pid, from: m, to: m, months: 1 });
    }
    // absorb blips shorter than 2 months into the surrounding era
    const out = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && (r.months < 2 || last.pid === r.pid)) { last.to = r.to; last.months += r.months; continue; }
      out.push({ ...r });
    }
    const loc = new Map();
    for (const v of visits) if (!loc.has(v.pid)) loc.set(v.pid, v);
    // the same building often has several place ids over the years: merge eras < 300 m apart
    const merged = [];
    for (const r of out) {
      const v = loc.get(r.pid);
      const e = { ...r, lat: v.lat, lng: v.lng, cc: v.cc, city: v.city };
      const last = merged[merged.length - 1];
      if (last && haversine(last.lat, last.lng, e.lat, e.lng) < 300) { last.to = e.to; last.months += e.months; continue; }
      merged.push(e);
    }
    return merged;
  }
  function eraAt(eraList, monthKey) {
    let cur = eraList[0] || null;
    for (const e of eraList) { if (e.from <= monthKey) cur = e; else break; }
    return cur;
  }

  function detectFlights(visits, acts) {
    const flights = [];
    for (const a of acts) {
      if (a.mode !== 'flight' || a.straight < 50000) continue;
      flights.push({ s: a.s, e: a.e, off: a.off, from: [a.sLat, a.sLng], to: [a.eLat, a.eLng], km: a.straight / 1000, inferred: a.reclassified ? 'speed' : null });
    }
    // Gaps between consecutive located events that could only be bridged by air.
    const ev = [];
    for (const v of visits) if (v.lvl === 0) ev.push({ s: v.s, e: v.e, off: v.off, a: [v.lat, v.lng], b: [v.lat, v.lng] });
    for (const a of acts) ev.push({ s: a.s, e: a.e, off: a.off, a: [a.sLat, a.sLng], b: [a.eLat, a.eLng] });
    ev.sort((x, y) => x.s - y.s);
    const covered = (s, e) => flights.some(f => f.s < e + 3 * 3600000 && f.e > s - 3 * 3600000);
    for (let i = 1; i < ev.length; i++) {
      const p = ev[i - 1], q = ev[i];
      const km = haversine(p.b[0], p.b[1], q.a[0], q.a[1]) / 1000;
      if (km < 300) continue;
      const hrs = Math.max((q.s - p.e) / 3600000, 0.25);
      if (hrs > 48 || km / hrs < 150) continue;
      if (covered(p.e, q.s)) continue;
      flights.push({ s: p.e, e: q.s, off: p.off, from: p.b, to: q.a, km, inferred: 'gap' });
    }
    flights.sort((a, b) => a.s - b.s);
    for (const f of flights) {
      f.fromCity = Geo.city(f.from[0], f.from[1]); f.toCity = Geo.city(f.to[0], f.to[1]);
      f.fromCc = Geo.country(f.from[0], f.from[1]); f.toCc = Geo.country(f.to[0], f.to[1]);
      const d = local(f.s, f.off);
      f.d = d.toISOString().slice(0, 10); f.y = d.getUTCFullYear();
      f.hrs = (f.e - f.s) / 3600000;
      f.co2 = f.km * (f.km < 1500 ? 0.156 : 0.115);
    }
    return flights;
  }

  function buildDays(visits, acts, P, homeEras, flights) {
    const days = new Map();
    const get = d => {
      let o = days.get(d);
      if (!o) days.set(d, o = {
        d, y: +d.slice(0, 4), dist: 0, mode: {}, modeMs: {}, moveMs: 0, places: new Set(), cc: new Set(), vcc: new Set(),
        cities: new Set(), homeMs: 0, workMs: 0, visitMs: 0, nVisits: 0, nActs: 0, far: 0, pts: 0, flights: 0,
      });
      return o;
    };
    for (const v of visits) {
      if (v.lvl !== 0) continue;
      const isHome = v.type === 'HOME' || v.type === 'INFERRED_HOME';
      const isWork = v.type === 'WORK' || v.type === 'INFERRED_WORK';
      get(v.d).nVisits++;
      splitByDay(v.s, v.e, v.off, (d, ms) => {
        const o = get(d);
        o.places.add(v.pid); o.visitMs += ms;
        if (v.cc) { o.cc.add(v.cc); o.vcc.add(v.cc); }
        if (v.city >= 0) o.cities.add(v.city);
        if (isHome) o.homeMs += ms;
        if (isWork) o.workMs += ms;
      });
    }
    for (const a of acts) {
      const o = get(a.d);
      o.nActs++; o.dist += a.dist; o.moveMs += a.e - a.s;
      o.mode[a.mode] = (o.mode[a.mode] || 0) + a.dist;
      o.modeMs[a.mode] = (o.modeMs[a.mode] || 0) + (a.e - a.s);
      if (a.mode !== 'flight') {
        if (a.sCc) o.cc.add(a.sCc); if (a.eCc) o.cc.add(a.eCc);
        if (a.sCity >= 0) o.cities.add(a.sCity); if (a.eCity >= 0) o.cities.add(a.eCity);
      }
    }
    for (let i = 0; i < P.t.length; i++) {
      const o = get(P.d[i]); o.pts++;
      if (P.cc[i]) o.cc.add(P.cc[i]);
    }
    for (const f of flights) get(f.d).flights++;
    // farthest distance from the home of that era
    const farUpd = (d, lat, lng) => {
      const h = eraAt(homeEras, d.slice(0, 7)); if (!h) return;
      const km = haversine(h.lat, h.lng, lat, lng) / 1000;
      const o = days.get(d); if (o && km > o.far) o.far = km;
    };
    for (const v of visits) farUpd(v.d, v.lat, v.lng);
    for (const a of acts) if (!a.glitch) { farUpd(a.d, a.eLat, a.eLng); farUpd(a.d, a.sLat, a.sLng); }
    for (let i = 0; i < P.t.length; i += 3) farUpd(P.d[i], P.lat[i], P.lng[i]);
    return days;
  }

  // Home -> Work and Work -> Home trips (allowing short stops on the way).
  function detectCommutes(visits, acts) {
    const seq = [];
    for (const v of visits) if (v.lvl === 0) seq.push({ k: 'v', o: v, s: v.s, e: v.e });
    for (const a of acts) seq.push({ k: 'a', o: a, s: a.s, e: a.e });
    seq.sort((x, y) => x.s - y.s);
    const kind = v => (v.type === 'HOME' || v.type === 'INFERRED_HOME') ? 'H' : (v.type === 'WORK' || v.type === 'INFERRED_WORK') ? 'W' : null;
    const out = [];
    let start = null, modes = {}, dist = 0;
    for (const it of seq) {
      if (it.k === 'v') {
        const k = kind(it.o);
        if (k) {
          if (start && start.k !== k && dist > 0) {
            const dur = it.s - start.v.e;
            if (dur > 0 && dur < 3 * 3600000) {
              const d = local(start.v.e, start.v.off);
              const arr = local(it.s, it.o.off);
              out.push({ dir: start.k + k, s: start.v.e, e: it.s, mins: dur / 60000, dist, modes, d: d.toISOString().slice(0, 10), y: d.getUTCFullYear(),
                leave: d.getUTCHours() + d.getUTCMinutes() / 60, arrive: arr.getUTCHours() + arr.getUTCMinutes() / 60, wd: (d.getUTCDay() + 6) % 7 });
            }
          }
          start = { k, v: it.o }; modes = {}; dist = 0;
        } else if (it.e - it.s > 20 * 60000) { start = null; }
      } else if (start) {
        modes[it.o.mode] = (modes[it.o.mode] || 0) + it.o.dist; dist += it.o.dist;
      }
    }
    return out;
  }

  return { build, local, dkey, splitByDay, eraAt };
})();
