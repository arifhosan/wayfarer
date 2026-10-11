// Synthetic demo timeline: a fictional Berlin resident, ~2.5 years, in Android export format.
const Demo = (() => {
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function generate() {
    const R = rng(42);
    const pick = a => a[Math.floor(R() * a.length)];
    const jit = (p, m) => [p[0] + (R() - .5) * m, p[1] + (R() - .5) * m * 1.6];
    const segs = [];
    const LL = p => `${p[0].toFixed(7)}°, ${p[1].toFixed(7)}°`;
    const iso = (t, off) => {
      const d = new Date(t + off * 60000).toISOString().slice(0, 23);
      const s = off >= 0 ? '+' : '-', a = Math.abs(off);
      return `${d}${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
    };
    const berlinOff = t => { const m = new Date(t).getUTCMonth(); return m >= 3 && m <= 9 ? 120 : 60; };

    const place = (id, name, p, type = 'UNKNOWN') => ({ id: 'demo-' + id, name, p, type });
    const HOME = place('home', 'Home · Prenzlauer Berg', [52.5389, 13.4246], 'HOME');
    const WORK = place('work', 'Office · Mitte', [52.5163, 13.3889], 'WORK');
    const BERLIN = [
      ['Mauerpark', 52.5435, 13.4024], ['Tempelhofer Feld', 52.4730, 13.4040], ['Tiergarten', 52.5145, 13.3501], ['Markthalle Neun', 52.5021, 13.4318],
      ['Klunkerkranich', 52.4814, 13.4316], ['Museum Island', 52.5169, 13.4019], ['East Side Gallery', 52.5050, 13.4397], ['Volkspark Friedrichshain', 52.5280, 13.4350],
      ['Climbing gym', 52.5490, 13.4370], ['Kino International', 52.5208, 13.4216], ['Café Kranzler', 52.5040, 13.3320], ['Görlitzer Park', 52.4966, 13.4373],
      ['Badeschiff', 52.4979, 13.4535], ['Teufelsberg', 52.4977, 13.2413], ['Grunewald', 52.4730, 13.2600], ['Supermarket', 52.5370, 13.4220],
      ['Gym', 52.5352, 13.4190], ['Friends’ place', 52.4880, 13.4210], ['Bookshop', 52.5310, 13.4110], ['Wannsee beach', 52.4380, 13.1790],
    ].map(([n, a, b], i) => place('b' + i, n, [a, b]));
    const ERRANDS = BERLIN.slice(15, 19);

    const TRIPS = [
      { d: '2023-03-17', days: 4, city: 'Lisbon', off: 0, ap: [38.7742, -9.1342], c: [38.7139, -9.1394], mode: 'flight' },
      { d: '2023-05-26', days: 3, city: 'Prague', off: 120, ap: [50.0833, 14.4353], c: [50.0870, 14.4210], mode: 'train' },
      { d: '2023-08-05', days: 9, city: 'Barcelona', off: 120, ap: [41.2974, 2.0833], c: [41.3874, 2.1686], mode: 'flight' },
      { d: '2023-12-21', days: 6, city: 'Copenhagen', off: 60, ap: [55.6180, 12.6508], c: [55.6761, 12.5683], mode: 'flight' },
      { d: '2024-04-11', days: 5, city: 'Rome', off: 120, ap: [41.8003, 12.2389], c: [41.9028, 12.4964], mode: 'flight' },
      { d: '2024-07-19', days: 14, city: 'Tokyo', off: 540, ap: [35.5494, 139.7798], c: [35.6762, 139.6503], mode: 'flight' },
      { d: '2024-10-03', days: 3, city: 'Vienna', off: 120, ap: [48.1850, 16.3760], c: [48.2082, 16.3738], mode: 'train' },
      { d: '2025-02-14', days: 5, city: 'Amsterdam', off: 60, ap: [52.3791, 4.9003], c: [52.3676, 4.9041], mode: 'train' },
      { d: '2025-05-29', days: 8, city: 'New York', off: -240, ap: [40.6413, -73.7781], c: [40.7128, -74.0060], mode: 'flight' },
    ];
    const BER = [52.3667, 13.5033], HBF = [52.5251, 13.3694];

    let t = Date.parse('2023-01-02T06:30:00Z');
    const end = Date.parse('2025-06-30T20:00:00Z');
    let cur = HOME, off = berlinOff(t);

    const visit = (pl, until, o = off) => {
      if (until <= t) return;
      segs.push({ startTime: iso(t, o), endTime: iso(until, o), startTimeTimezoneUtcOffsetMinutes: o, endTimeTimezoneUtcOffsetMinutes: o,
        visit: { hierarchyLevel: 0, probability: .9, topCandidate: { placeId: pl.id, semanticType: pl.type, name: pl.name, probability: .8, placeLocation: { latLng: LL(pl.p) } } } });
      t = until; cur = pl;
    };
    const SPEED = { WALKING: 4.8, CYCLING: 16, IN_TRAM: 18, IN_BUS: 20, IN_SUBWAY: 28, IN_TRAIN: 45, IN_PASSENGER_VEHICLE: 30, FLYING: 780 };
    const move = (to, type, kmh, o = off, o2 = o) => {
      if (type !== 'FLYING' && type !== 'IN_TRAIN') kmh = SPEED[type] || kmh;
      const a = cur.p, b = to.p;
      const km = haversine(a[0], a[1], b[0], b[1]) / 1000 * (type === 'FLYING' ? 1 : 1.25);
      const ms = Math.max(4, km / kmh * 60 + (type === 'FLYING' ? 0 : 2)) * 60000;
      segs.push({ startTime: iso(t, o), endTime: iso(t + ms, o2), startTimeTimezoneUtcOffsetMinutes: o, endTimeTimezoneUtcOffsetMinutes: o2,
        activity: { start: { latLng: LL(a) }, end: { latLng: LL(b) }, distanceMeters: km * 1000, probability: .95, topCandidate: { type, probability: .9 } } });
      if (type !== 'FLYING') {
        const n = Math.min(30, Math.max(3, Math.round(km * 1.5)));
        const path = [];
        for (let i = 0; i <= n; i++) { const f = i / n; path.push({ point: LL(jit([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i && i < n ? .004 : 0)), time: iso(t + ms * f, o) }); }
        segs.push({ startTime: iso(t, o), endTime: iso(t + ms, o), timelinePath: path });
      }
      t += ms; cur = to;
    };
    const at = (h, m = 0, o = off) => { const d = new Date(t + o * 60000); d.setUTCHours(h, m, 0, 0); return d.getTime() - o * 60000; };
    const nextMorning = (o = off) => { const d = new Date(t + o * 60000); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(7, 0, 0, 0); return d.getTime() - o * 60000 + R() * 5400000; };

    while (t < end) {
      off = berlinOff(t);
      const local = new Date(t + off * 60000);
      const dstr = local.toISOString().slice(0, 10);
      const trip = TRIPS.find(x => x.d === dstr);
      const wd = local.getUTCDay();

      if (trip) {
        const hub = trip.mode === 'flight' ? place('ber', 'Berlin Brandenburg Airport', BER) : place('hbf', 'Berlin Hauptbahnhof', HBF);
        const dest = trip.mode === 'flight' ? place('ap-' + trip.city, trip.city + ' airport', trip.ap) : place('st-' + trip.city, trip.city + ' station', trip.ap);
        const hotel = place('h-' + trip.city, 'Hotel · ' + trip.city, jit(trip.c, .01));
        visit(HOME, at(9 + Math.floor(R() * 4)));
        move(hub, trip.mode === 'flight' ? 'IN_TRAIN' : 'IN_SUBWAY', 40);
        visit(hub, t + (trip.mode === 'flight' ? 100 : 20) * 60000);
        move(dest, trip.mode === 'flight' ? 'FLYING' : 'IN_TRAIN', trip.mode === 'flight' ? 780 : 110, off, trip.off);
        visit(dest, t + 30 * 60000, trip.off);
        move(hotel, trip.mode === 'flight' ? 'IN_TRAIN' : 'IN_SUBWAY', 35, trip.off);
        const sights = Array.from({ length: 8 }, (_, i) => place(`s-${trip.city}-${i}`, `${trip.city} sight ${i + 1}`, jit(trip.c, .06)));
        for (let d = 0; d < trip.days; d++) {
          visit(hotel, nextMorning(trip.off) + 3600000, trip.off);
          for (let k = 0; k < 2 + Math.floor(R() * 3); k++) {
            const s = pick(sights);
            move(s, R() < .7 ? 'WALKING' : pick(['IN_SUBWAY', 'IN_BUS', 'IN_TRAM']), R() < .7 ? 4.5 : 22, trip.off);
            visit(s, t + (40 + R() * 140) * 60000, trip.off);
          }
          move(hotel, 'WALKING', 4.5, trip.off);
        }
        visit(hotel, nextMorning(trip.off) + 7200000, trip.off);
        move(dest, trip.mode === 'flight' ? 'IN_TRAIN' : 'IN_SUBWAY', 35, trip.off);
        visit(dest, t + (trip.mode === 'flight' ? 90 : 15) * 60000, trip.off);
        move(hub, trip.mode === 'flight' ? 'FLYING' : 'IN_TRAIN', trip.mode === 'flight' ? 780 : 110, trip.off, off);
        visit(hub, t + 20 * 60000);
        move(HOME, trip.mode === 'flight' ? 'IN_TRAIN' : 'IN_SUBWAY', 40);
        visit(HOME, nextMorning());
        continue;
      }

      if (wd >= 1 && wd <= 5 && R() > .06) {
        visit(HOME, at(7, 40) + R() * 3000000);
        const bike = R() < (local.getUTCMonth() >= 3 && local.getUTCMonth() <= 9 ? .45 : .1);
        if (bike) move(WORK, 'CYCLING', 16);
        else { const st = place('st-home', 'Eberswalder Str.', [52.5413, 13.4122]); move(st, 'WALKING', 5); move(place('st-work', 'Friedrichstr.', [52.5203, 13.3870]), 'IN_SUBWAY', 26); move(WORK, 'WALKING', 5); }
        visit(WORK, at(17, 0) + R() * 5400000);
        if (R() < .4) { const p = pick(BERLIN); move(p, bike ? 'CYCLING' : pick(['IN_TRAM', 'IN_SUBWAY', 'WALKING']), bike ? 16 : 18); visit(p, t + (40 + R() * 120) * 60000); }
        if (R() < .3) { const e = pick(ERRANDS); move(e, bike ? 'CYCLING' : 'WALKING', bike ? 16 : 5); visit(e, t + (15 + R() * 30) * 60000); }
        move(HOME, bike ? 'CYCLING' : pick(['IN_TRAM', 'WALKING', 'IN_BUS']), bike ? 16 : 14);
      } else {
        visit(HOME, at(9, 30) + R() * 7200000);
        for (let k = 0; k < 1 + Math.floor(R() * 3); k++) {
          const p = pick(BERLIN);
          const far = haversine(cur.p[0], cur.p[1], p.p[0], p.p[1]) > 6000;
          const type = far ? pick(['IN_TRAIN', 'IN_PASSENGER_VEHICLE', 'CYCLING']) : pick(['WALKING', 'WALKING', 'CYCLING', 'IN_TRAM']);
          move(p, type, { WALKING: 4.8, CYCLING: 17, IN_TRAM: 18, IN_TRAIN: 35, IN_PASSENGER_VEHICLE: 30 }[type]);
          visit(p, t + (45 + R() * 150) * 60000);
        }
        move(HOME, pick(['WALKING', 'CYCLING', 'IN_TRAM']), 12);
      }
      visit(HOME, nextMorning());
    }
    return {
      semanticSegments: segs, rawSignals: [],
      userLocationProfile: { persona: { travelModeAffinities: [
        { mode: 'WALKING', affinity: .62 }, { mode: 'IN_SUBWAY', affinity: .41 }, { mode: 'CYCLING', affinity: .33 }, { mode: 'IN_TRAM', affinity: .21 },
        { mode: 'IN_TRAIN', affinity: .12 }, { mode: 'FLYING', affinity: .04 }] } },
      sources: [{ name: 'Demo data', kind: 'demo' }],
    };
  }
  return { generate };
})();
