# Wayfarer: Timeline Atlas

A private, in-browser analytics app for your **Google Timeline** location history. Drop in your
export and get a full atlas of your life in motion: heatmaps, a life calendar, flights, trains,
countries, records, a year-by-year review and an animated day replay.

Nothing is uploaded: parsing, reverse-geocoding and every statistic run locally in your browser.

## Run it

Open `app/index.html` in a modern browser (Chrome, Edge, Firefox or Safari). No build step and no server.
To host it, serve the `app/` folder as static files.

### Deploy (Cloudflare Workers)

The repo includes a Worker (`worker/index.js` + `wrangler.jsonc`) that serves `app/` at
**https://arifhosan.me/wayfarer**, with security headers (CSP and others) and caching for the geo data.

```bash
npm install
npx wrangler dev      # http://localhost:8787/wayfarer/
npx wrangler deploy   # needs the arifhosan.me zone on your Cloudflare account
```

Or connect this GitHub repo under Cloudflare → Workers & Pages → *Create* → *Import a repository*.
The default deploy command `npx wrangler deploy` picks up `wrangler.jsonc`, so every push to `master` deploys.
The routes `arifhosan.me/wayfarer` and `arifhosan.me/wayfarer/*` attach automatically on deploy.
`/wayfarer` redirects to `/wayfarer/` so relative asset paths resolve.

An internet connection is needed for the CDN libraries (GSAP, ECharts, Leaflet) and map tiles.
Country borders and city names are bundled in `app/geo/`, so your coordinates are never sent to a
geocoding service.

## Supported exports

| Source | How to get it | What to upload |
|---|---|---|
| Android (on-device Timeline) | Settings → Location → Location services → Timeline → *Export Timeline data* | `Timeline.json` |
| iPhone | Google Maps → Your Timeline → ⋯ → Location & privacy settings → *Export Timeline data* | `location-history.json` |
| Legacy Google Takeout | takeout.google.com → Location History, then unzip | every file in `Semantic Location History/` (multi-select) |

`Records.json` (raw GPS pings) is detected and rejected with an explanation, because it has no visits or journeys.

The last loaded file is cached in your browser's IndexedDB so you can continue later.
Use **Forget saved file** on the start screen to remove it. **Try with demo data** generates a synthetic timeline.

## What's inside

- **Overview**: total distance, countries, cities, places, flights, train rides, steps, time moving and CO₂, plus distance per mode and per year.
- **Heatmap**: every GPS point and visit, with toggleable layers for places, flight arcs and homes.
- **Calendar**: a GitHub-style grid for every year (distance, walking, places, distance from home, hours moving). Click a day to open it.
- **Rhythms**: a weekday × hour punch card, plus averages per weekday and per month.
- **Getting around**: a per-mode table (trips, distance, time, average speed, longest trip, CO₂) and monthly stacked distance.
- **On foot & bike**: steps, marathons, streaks, best days, longest walks and rides.
- **Trains & transit**: top city-to-city routes, longest rides and a map of every train journey.
- **Flights**: an animated great-circle map, a flight log and the most-flown cities. Flights missing from the data are *inferred* from impossible-by-land jumps.
- **Countries & cities**: a choropleth world map, days and stays per country, transit-only countries, top cities and days per country per year.
- **Places**: where your time goes, the exploration rate (new places per month) and your monthly radius of gyration.
- **Home & work**: every home and workplace over time, your time budget, arrival and leave times, hours per week and the commute-duration trend.
- **Trips**: stays abroad computed from the data, plus Google's own trip memories.
- **Hall of records**: longest day, farthest from home, most countries in a day, fastest ground speed, streaks and extreme points.
- **Busiest days**: top days by distance, places, distance from home, countries or walking.
- **Year in review**: one card per year.
- **Day explorer**: any day on a map, with a timeline, *Replay day* animation, "on this day" in other years and ←/→ keys.
- **Data & coverage**: tracked days per month, time zones and Google's travel-mode affinities for you.

Every section respects the year filter in the top bar.

## Data cleaning

Phones produce glitches. Wayfarer cleans them before any statistic is computed:

- Segments faster than is plausible for their mode (for example a "3,600 km walk") keep only their straight-line distance. If even that is impossible, they become *Other*.
- Long, very fast ground segments (over 300 km at more than 200 km/h) are reclassified as flights.
- Local time uses each segment's own UTC offset, so hours of the day are correct while travelling.

## Project layout

```
app/
  index.html        markup and sections
  css/style.css     design tokens (light and dark) and layout
  js/formats.js     Android / iOS / Takeout → one canonical format
  js/model.js       parsing, cleaning, flight detection, home/work eras, commutes, daily summaries
  js/geo.js         offline reverse geocoding (point-in-polygon countries, nearest city)
  js/stats.js       aggregations for a year filter
  js/ui.js          formatting, chart/map factories, tables, tiles
  js/anim.js        GSAP motion: landing globe, reveals, count-ups, path drawing, replay
  js/app.js         controller and section renderers
  js/demo.js        synthetic demo timeline
  geo/              bundled country borders and cities (generated)
tools/build_geo.py  regenerates app/geo/ from GeoNames + world-atlas
worker/index.js     Cloudflare Worker: serves app/ under /wayfarer with security headers
wrangler.jsonc      Worker + static assets + routes config
```

To regenerate the geo data, download `cities15000.zip` (unzipped) and `countryInfo.txt` from
download.geonames.org and `countries-50m.json` from `world-atlas@2.0.2`, then run
`python tools/build_geo.py <download-dir>`.

## Credits

Country borders: Natural Earth via world-atlas. Cities: GeoNames (CC BY 4.0). Tiles: Esri, HERE,
Garmin and OpenStreetMap contributors. Libraries: GSAP, Apache ECharts, Leaflet, Leaflet.heat,
topojson-client. Flag emoji: Twemoji Country Flags.
