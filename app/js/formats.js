// Normalises the different Google location-history exports into the on-device Android
// shape ({ semanticSegments, userLocationProfile }) that the model understands.
//
// Supported:
//   - Android "Timeline.json" (Settings → Location → Timeline → Export)      { semanticSegments: [...] }
//   - iOS export (Google Maps → Timeline → Export)                           [ {startTime, visit|activity|timelinePath} ]
//   - Legacy Google Takeout "Semantic Location History/YYYY/YYYY_MONTH.json" { timelineObjects: [...] }  (many files)
const Formats = (() => {
  const LL = (lat, lng) => `${lat}°, ${lng}°`;
  const geo = s => { const m = /geo:(-?[\d.]+),(-?[\d.]+)/.exec(s || ''); return m ? LL(+m[1], +m[2]) : null; };
  const upper = s => String(s || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const isoOff = s => { const m = /([+-])(\d\d):?(\d\d)$/.exec(s || ''); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null; };

  function detect(raw) {
    if (raw && Array.isArray(raw.semanticSegments)) return 'android';
    if (raw && Array.isArray(raw.timelineObjects)) return 'legacy';
    if (raw && Array.isArray(raw.locations)) return 'records';
    if (Array.isArray(raw) && raw.some(o => o && o.startTime && (o.visit || o.activity || o.timelinePath || o.timelineMemory))) return 'ios';
    return null;
  }

  function fromIOS(arr) {
    const out = [];
    for (const o of arr) {
      if (!o || !o.startTime) continue;
      const seg = { startTime: o.startTime, endTime: o.endTime || o.startTime };
      const off = isoOff(o.startTime);
      if (off != null) { seg.startTimeTimezoneUtcOffsetMinutes = off; seg.endTimeTimezoneUtcOffsetMinutes = isoOff(o.endTime) ?? off; }
      if (o.visit) {
        const tc = o.visit.topCandidate || {};
        const loc = geo(tc.placeLocation);
        if (!loc) continue;
        seg.visit = { hierarchyLevel: +o.visit.hierarchyLevel || 0, probability: +o.visit.probability || 0,
          topCandidate: { placeId: tc.placeID || tc.placeId || loc, semanticType: upper(tc.semanticType || 'UNKNOWN'), placeLocation: { latLng: loc } } };
      } else if (o.activity) {
        const a = o.activity, s = geo(a.start), e = geo(a.end);
        if (!s || !e) continue;
        seg.activity = { start: { latLng: s }, end: { latLng: e }, distanceMeters: +a.distanceMeters || 0,
          topCandidate: { type: upper((a.topCandidate || {}).type || 'UNKNOWN_ACTIVITY_TYPE') } };
      } else if (o.timelinePath) {
        const t0 = Date.parse(o.startTime);
        seg.timelinePath = o.timelinePath.map(p => ({ point: geo(p.point), time: new Date(t0 + (+p.durationMinutesOffsetFromStartTime || 0) * 60000).toISOString() })).filter(p => p.point);
        delete seg.startTimeTimezoneUtcOffsetMinutes;
      } else if (o.timelineMemory) {
        const m = o.timelineMemory;
        seg.timelineMemory = { trip: { distanceFromOriginKms: +m.distanceFromOriginKms || 0, destinations: (m.destinations || []).map(d => ({ identifier: { placeId: d.identifier } })) } };
      } else continue;
      out.push(seg);
    }
    return { semanticSegments: out };
  }

  // Legacy Takeout has UTC timestamps without the local offset; estimate it from longitude.
  const lngOff = lng => Math.round(lng / 15) * 60;
  const ts = d => d.startTimestamp || (d.startTimestampMs && new Date(+d.startTimestampMs).toISOString());
  const te = d => d.endTimestamp || (d.endTimestampMs && new Date(+d.endTimestampMs).toISOString());
  const E7 = v => v / 1e7;

  function fromLegacy(objs) {
    const out = [];
    for (const o of objs) {
      if (o.placeVisit) {
        const pv = o.placeVisit, l = pv.location || {};
        if (l.latitudeE7 == null || !pv.duration) continue;
        const lat = E7(l.latitudeE7), lng = E7(l.longitudeE7), off = lngOff(lng);
        out.push({ startTime: ts(pv.duration), endTime: te(pv.duration), startTimeTimezoneUtcOffsetMinutes: off, endTimeTimezoneUtcOffsetMinutes: off,
          visit: { hierarchyLevel: 0, probability: (pv.visitConfidence || 0) / 100,
            topCandidate: { placeId: l.placeId || `${lat},${lng}`, semanticType: String(l.semanticType || 'UNKNOWN').replace(/^TYPE_/, ''), name: l.name, address: l.address, placeLocation: { latLng: LL(lat, lng) } } } });
        for (const c of pv.childVisits || []) if (c.location && c.location.latitudeE7 != null && c.duration) {
          const cl = c.location, clat = E7(cl.latitudeE7), clng = E7(cl.longitudeE7);
          out.push({ startTime: ts(c.duration), endTime: te(c.duration), startTimeTimezoneUtcOffsetMinutes: off, endTimeTimezoneUtcOffsetMinutes: off,
            visit: { hierarchyLevel: 1, topCandidate: { placeId: cl.placeId || `${clat},${clng}`, semanticType: String(cl.semanticType || 'UNKNOWN').replace(/^TYPE_/, ''), name: cl.name, placeLocation: { latLng: LL(clat, clng) } } } });
        }
      } else if (o.activitySegment) {
        const a = o.activitySegment, s = a.startLocation, e = a.endLocation;
        if (!s || !e || s.latitudeE7 == null || e.latitudeE7 == null || !a.duration) continue;
        const off = lngOff(E7(s.longitudeE7));
        out.push({ startTime: ts(a.duration), endTime: te(a.duration), startTimeTimezoneUtcOffsetMinutes: off, endTimeTimezoneUtcOffsetMinutes: off,
          activity: { start: { latLng: LL(E7(s.latitudeE7), E7(s.longitudeE7)) }, end: { latLng: LL(E7(e.latitudeE7), E7(e.longitudeE7)) },
            distanceMeters: a.distance || (a.waypointPath && a.waypointPath.distanceMeters) || 0, topCandidate: { type: a.activityType || 'UNKNOWN_ACTIVITY_TYPE' } } });
        const pts = (a.simplifiedRawPath && a.simplifiedRawPath.points) || [];
        if (pts.length) out.push({ startTime: ts(a.duration), endTime: te(a.duration),
          timelinePath: pts.map(p => ({ point: LL(E7(p.latE7), E7(p.lngE7)), time: p.timestamp || (p.timestampMs && new Date(+p.timestampMs).toISOString()) })).filter(p => p.time) });
      }
    }
    return { semanticSegments: out };
  }

  // files: [{name, raw}] -> canonical object; throws with a friendly message.
  function normalise(files) {
    const merged = { semanticSegments: [], userLocationProfile: null, rawSignals: [], sources: [] };
    for (const { name, raw } of files) {
      const kind = detect(raw);
      if (kind === 'records') throw new Error(`"${name}" is raw location history (Records.json). It has no visits or journeys. Upload your Timeline export from the Google Maps app, or the "Semantic Location History" monthly files instead.`);
      if (!kind) throw new Error(`"${name}" doesn't look like a Google Timeline export.`);
      let c;
      if (kind === 'android') c = raw;
      else if (kind === 'ios') c = fromIOS(raw);
      else c = fromLegacy(raw.timelineObjects);
      for (const s of c.semanticSegments) merged.semanticSegments.push(s);
      if (c.userLocationProfile && !merged.userLocationProfile) merged.userLocationProfile = c.userLocationProfile;
      if (c.rawSignals) merged.rawSignals = merged.rawSignals.concat(c.rawSignals);
      merged.sources.push({ name, kind });
    }
    if (!merged.semanticSegments.length) throw new Error('No timeline entries found in the selected file(s).');
    merged.userLocationProfile = merged.userLocationProfile || {};
    return merged;
  }

  return { normalise, detect };
})();
