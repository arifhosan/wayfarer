// Offline reverse geocoding: country via point-in-polygon, city via nearest-city search.
// Relies on window.GEO_COUNTRIES (topojson), window.GEO_COUNTRY_INFO, window.GEO_CITIES and topojson-client.
const Geo = (() => {
  let countries = [];         // {a2, name, cont, polys: [[ring, ...holes]], bbox:[minX,minY,maxX,maxY]}
  const cellCountries = new Map(); // "x,y" (1° cell) -> candidate country indices
  const cache = new Map();         // "lat,lng" @ 0.01° -> country index | -1
  let cityGrid = null;             // "x,y" -> [city idx]
  const C = () => window.GEO_CITIES;

  function init() {
    if (countries.length) return;
    const fc = topojson.feature(window.GEO_COUNTRIES, window.GEO_COUNTRIES.objects.countries);
    countries = fc.features.map(f => {
      const g = f.geometry;
      if (!g) return null;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      let bb = [180, 90, -180, -90];
      for (const poly of polys) for (const [x, y] of poly[0]) {
        if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y;
        if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
      }
      const p = f.properties;
      return { a2: p.a2 || p.name, name: p.name, cont: p.cont, polys, bbox: bb, feature: f };
    }).filter(Boolean);

    const c = C();
    cityGrid = new Map();
    for (let i = 0; i < c.n.length; i++) {
      const k = Math.floor(c.la[i]) + ',' + Math.floor(c.lo[i]);
      let a = cityGrid.get(k); if (!a) cityGrid.set(k, a = []); a.push(i);
    }
  }

  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inCountry(x, y, c) {
    for (const poly of c.polys) {
      if (!inRing(x, y, poly[0])) continue;
      let hole = false;
      for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  function candidates(cx, cy, pad = 0) {
    const k = cx + ',' + cy + ',' + pad;
    let a = cellCountries.get(k);
    if (a) return a;
    a = [];
    countries.forEach((c, i) => {
      const b = c.bbox;
      if (b[0] - pad <= cx + 1 && b[2] + pad >= cx && b[1] - pad <= cy + 1 && b[3] + pad >= cy) a.push(i);
    });
    cellCountries.set(k, a);
    return a;
  }

  // Returns index into countries, or -1 for open sea.
  function countryIdx(lat, lng) {
    const key = Math.round(lat * 100) + ',' + Math.round(lng * 100);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const cx = Math.floor(lng), cy = Math.floor(lat);
    let res = -1;
    for (const i of candidates(cx, cy)) if (inCountry(lng, lat, countries[i])) { res = i; break; }
    if (res < 0) {
      // Coastline / harbour / airport-on-the-water fallback: nearest vertex within ~40 km.
      let best = 0.4 * 0.4;
      for (const i of candidates(cx, cy, 0.5)) for (const poly of countries[i].polys) for (const [x, y] of poly[0]) {
        const dx = (x - lng) * Math.cos(lat * Math.PI / 180), dy = y - lat, d = dx * dx + dy * dy;
        if (d < best) { best = d; res = i; }
      }
    }
    cache.set(key, res);
    return res;
  }

  function country(lat, lng) {
    const i = countryIdx(lat, lng);
    return i < 0 ? null : countries[i].a2;
  }

  // Nearest meaningful city: distance discounted by population so a big city
  // a little further away wins over a tiny suburb right next to the point.
  function city(lat, lng) {
    const c = C();
    const cy = Math.floor(lat), cx = Math.floor(lng);
    let best = -1, bestScore = Infinity, nearest = -1, nearestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = cityGrid.get((cy + dy) + ',' + (cx + dx));
      if (!a) continue;
      for (const i of a) {
        const d = haversine(lat, lng, c.la[i], c.lo[i]) / 1000;
        if (d < nearestD) { nearestD = d; nearest = i; }
        if (d > 30) continue;
        const s = (d + 2) / Math.pow(c.p[i], 0.4);
        if (s < bestScore) { bestScore = s; best = i; }
      }
    }
    if (best < 0 && nearestD < 80) best = nearest;
    return best;
  }
  const cityName = i => i >= 0 ? C().n[i] : null;
  const cityCountry = i => i >= 0 ? C().c[i] : null;
  const cityLL = i => [C().la[i], C().lo[i]];

  const info = a2 => {
    const inf = window.GEO_COUNTRY_INFO[a2];
    return { name: inf ? inf[0] : a2, cont: inf ? inf[1] : '' };
  };
  const flag = a2 => (a2 && a2.length === 2)
    ? String.fromCodePoint(...[...a2.toUpperCase()].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65)) : '🏳️';
  const CONTINENTS = { EU: 'Europe', AS: 'Asia', AF: 'Africa', NA: 'North America', SA: 'South America', OC: 'Oceania', AN: 'Antarctica' };

  return { init, country, city, cityName, cityCountry, cityLL, info, flag, CONTINENTS, features: () => countries };
})();

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
