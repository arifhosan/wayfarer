"""Builds the offline geo files used by the app (app/geo/*.js).

Sources (downloaded into a temp folder you pass as argv[1]):
  - https://download.geonames.org/export/dump/cities15000.zip  (unzipped -> cities15000.txt)
  - https://download.geonames.org/export/dump/countryInfo.txt
  - https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json

Usage: python tools/build_geo.py <download-dir>
"""
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / "app" / "geo"
out.mkdir(parents=True, exist_ok=True)

# --- countries ---------------------------------------------------------------
info = {}
for line in (src / "countryInfo.txt").read_text(encoding="utf-8").splitlines():
    if line.startswith("#") or not line.strip():
        continue
    p = line.split("\t")
    iso2, iso3, num, name, continent = p[0], p[1], p[2], p[4], p[8]
    info[num.zfill(3)] = {"a2": iso2, "name": name, "cont": continent}

topo = json.loads((src / "countries-50m.json").read_text(encoding="utf-8"))
# world-atlas has a few features without numeric ids (Kosovo, N. Cyprus, ...): map by name
by_name = {v["name"]: v for v in info.values()}
extra = {"Kosovo": {"a2": "XK", "name": "Kosovo", "cont": "EU"},
         "N. Cyprus": {"a2": "CY", "name": "Cyprus", "cont": "EU"},
         "Somaliland": {"a2": "SO", "name": "Somalia", "cont": "AF"}}
for g in topo["objects"]["countries"]["geometries"]:
    nid = g.get("id")
    nm = g["properties"]["name"]
    meta = info.get(nid) if nid else None
    if not meta:
        meta = extra.get(nm) or by_name.get(nm) or {"a2": "", "name": nm, "cont": ""}
    g["properties"] = {"a2": meta["a2"], "name": meta["name"], "cont": meta["cont"]}
topo["objects"] = {"countries": topo["objects"]["countries"]}
(out / "countries.js").write_text(
    "window.GEO_COUNTRIES=" + json.dumps(topo, separators=(",", ":")) + ";\n"
    "window.GEO_COUNTRY_INFO=" + json.dumps({v["a2"]: [v["name"], v["cont"]] for v in info.values()},
                                             separators=(",", ":"), ensure_ascii=False) + ";\n",
    encoding="utf-8")

# --- cities ------------------------------------------------------------------
rows = []
for line in (src / "cities15000.txt").read_text(encoding="utf-8").splitlines():
    p = line.split("\t")
    if p[7] in ("PPLX", "PPLH", "PPLQ", "PPLW"):  # city sections / historical places -> skip
        continue
    name, lat, lng, cc, pop = p[1], float(p[4]), float(p[5]), p[8], int(p[14] or 0)
    rows.append((name, round(lat, 4), round(lng, 4), cc, pop))
rows.sort(key=lambda r: -r[4])
cities = {
    "n": [r[0] for r in rows],
    "la": [r[1] for r in rows],
    "lo": [r[2] for r in rows],
    "c": [r[3] for r in rows],
    "p": [r[4] for r in rows],
}
(out / "cities.js").write_text(
    "window.GEO_CITIES=" + json.dumps(cities, separators=(",", ":"), ensure_ascii=False) + ";\n",
    encoding="utf-8")
print("countries:", len(topo["objects"]["countries"]["geometries"]), "cities:", len(rows))
