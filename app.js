
/* Radius Facility Near Me (static, zero-backend)
   - Loads facilities.json + facilities_index.json
   - Uses GPS, coordinates parser, or facility search as reference point
   - Filters by radius (meters) using:
       1) grid index (fast candidate selection)
       2) bounding box (cheap)
       3) haversine (exact straight-line)
*/

const state = {
  facilities: [],
  index: null,
  cellSizeDeg: 0.01,
  ref: null, // {lat,lng, label}
  map: null,
  layers: {
    refMarker: null,
    resultsLayer: null,
  }
};

// ---------- Utilities ----------
function toRad(x){ return x * Math.PI / 180; }

function haversineMeters(a, b){
  const R = 6371000; // meters
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function metersToPretty(m){
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m/1000;
  return `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

function setStatus(el, msg, isError=false){
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--danger)' : '';
}

// ---------- Coordinate parsing ----------
function cleanCoordText(text){
  return (text || '')
    .toUpperCase()
    .replace(/[^\d\.\-°'"\sNSEW,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dmsToDecimal(deg, min, sec, dir){
  let v = deg + (min||0)/60 + (sec||0)/3600;
  if (dir === 'S' || dir === 'W') v *= -1;
  return v;
}

function normalizeLatLng(lat, lng){
  // Auto-swap if values obviously reversed
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) return {lat: lng, lng: lat};

  // PH-oriented sanity check: if both look like latitudes, leave as-is but validation will fail later.
  return {lat, lng};
}

function validLatLng(lat, lng){
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parseCoordinates(input){
  const text = cleanCoordText(input);
  if (!text) return null;

  // DMS/DM pattern: e.g. 14°18'17.5"N
  if (text.includes('°')){
    const parts = text.match(/(\d+)\s*°\s*(\d+)?\s*'?\s*(\d+(\.\d+)?)?\s*"?\s*([NSEW])/g);
    if (parts && parts.length >= 2){
      const parsePart = p => {
        const m = p.match(/(\d+)\s*°\s*(\d+)?\s*'?\s*(\d+(\.\d+)?)?\s*"?\s*([NSEW])/);
        if (!m) return null;
        return dmsToDecimal(+m[1], +(m[2]||0), +(m[3]||0), m[5]);
      };
      const a = parsePart(parts[0]);
      const b = parsePart(parts[1]);
      if (a == null || b == null) return null;

      // Decide which is lat vs lng based on N/S/E/W if present
      const dirA = (parts[0].match(/[NSEW]/)||[''])[0];
      const dirB = (parts[1].match(/[NSEW]/)||[''])[0];

      let lat = (dirA === 'N' || dirA === 'S') ? a : b;
      let lng = (dirA === 'E' || dirA === 'W') ? a : b;

      // If ambiguous, assume first is lat
      if (lat === undefined || lng === undefined){
        lat = a; lng = b;
      }

      const fixed = normalizeLatLng(lat, lng);
      if (validLatLng(fixed.lat, fixed.lng)) return fixed;
      return null;
    }
  }

  // Decimal fallback: extract numbers
  const nums = (text.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  if (nums.length >= 2){
    const fixed = normalizeLatLng(nums[0], nums[1]);
    if (validLatLng(fixed.lat, fixed.lng)) return fixed;
  }
  return null;
}

// ---------- Map ----------
function initMap(){
  state.map = L.map('map', { zoomControl: true }).setView([14.5995, 120.9842], 11); // default: Metro Manila
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);

  state.layers.resultsLayer = L.layerGroup().addTo(state.map);
}

function setRefMarker(lat, lng, label){
  if (state.layers.refMarker) state.layers.refMarker.remove();
  state.layers.refMarker = L.marker([lat, lng], { title: label || 'Reference' })
    .addTo(state.map)
    .bindPopup(`<b>Reference</b><br>${label || ''}<br>${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    .openPopup();
  state.map.setView([lat, lng], 15);
}

function clearResults(){
  state.layers.resultsLayer.clearLayers();
  document.getElementById('results').innerHTML = '';
  document.getElementById('resultsMeta').textContent = '';
}

// ---------- Candidate selection via grid + bbox ----------
function bboxDeltasDeg(lat, radiusMeters){
  const latDelta = radiusMeters / 111320; // approx meters per degree lat
  const lngDelta = radiusMeters / (111320 * Math.cos(toRad(lat)) || 1);
  return { latDelta, lngDelta };
}

function getCandidateIndices(ref, radiusMeters){
  // If radius is 0, return nothing (user asked 0m)
  if (radiusMeters <= 0) return [];

  const { latDelta, lngDelta } = bboxDeltasDeg(ref.lat, radiusMeters);
  const minLat = ref.lat - latDelta;
  const maxLat = ref.lat + latDelta;
  const minLng = ref.lng - lngDelta;
  const maxLng = ref.lng + lngDelta;

  // Grid cell range
  const cs = state.cellSizeDeg;
  const minLatCell = Math.floor(minLat / cs);
  const maxLatCell = Math.floor(maxLat / cs);
  const minLngCell = Math.floor(minLng / cs);
  const maxLngCell = Math.floor(maxLng / cs);

  const out = [];
  const seen = new Set();

  for (let la = minLatCell; la <= maxLatCell; la++){
    for (let lo = minLngCell; lo <= maxLngCell; lo++){
      const key = `${la}_${lo}`;
      const bucket = state.index[key];
      if (!bucket) continue;
      for (const idx of bucket){
        if (!seen.has(idx)){
          seen.add(idx);
          out.push(idx);
        }
      }
    }
  }

  // Cheap bbox filter to cut more
  const bboxFiltered = [];
  for (const idx of out){
    const f = state.facilities[idx];
    if (f.lat >= minLat && f.lat <= maxLat && f.lng >= minLng && f.lng <= maxLng){
      bboxFiltered.push(idx);
    }
  }
  return bboxFiltered;
}

// ---------- Search execution ----------
function runSearch(){
  const metaEl = document.getElementById('resultsMeta');
  const resultsEl = document.getElementById('results');

  clearResults();

  if (!state.ref){
    metaEl.textContent = 'Set a reference point first (GPS, coordinates, or select a facility).';
    return;
  }

  const radius = +document.getElementById('radius').value;
  const ref = state.ref;

  const candidates = getCandidateIndices(ref, radius);
  const scored = [];

  for (const idx of candidates){
    const f = state.facilities[idx];
    const d = haversineMeters(ref, f);
    if (d <= radius){
      scored.push({ idx, d });
    }
  }

  scored.sort((a,b) => a.d - b.d);

  const showMax = 50;
  const toShow = scored.slice(0, showMax);

  metaEl.textContent = `Found ${scored.length} within ${radius} m. Showing top ${Math.min(showMax, scored.length)}.`;

  // Draw radius circle
  state.layers.resultsLayer.clearLayers();
  L.circle([ref.lat, ref.lng], { radius, weight: 1 }).addTo(state.layers.resultsLayer);

  // Draw markers & list
  for (const item of toShow){
    const f = state.facilities[item.idx];

    const m = L.circleMarker([f.lat, f.lng], { radius: 7, weight: 2 })
      .addTo(state.layers.resultsLayer)
      .bindPopup(`<b>${escapeHtml(f.id)}</b><br>${escapeHtml(f.property)}<br>${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}<br><b>${metersToPretty(item.d)}</b>`);

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="topline">
        <div><b>${escapeHtml(f.id)}</b></div>
        <div class="pill">${metersToPretty(item.d)}</div>
      </div>
      <div class="kv">${escapeHtml(f.property)}</div>
      <div class="kv">${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}</div>
      <div class="actions">
        <a class="btnlink" href="https://www.google.com/maps?q=${f.lat},${f.lng}" target="_blank" rel="noopener">Open in Google Maps</a>
        <a class="btnlink" href="https://waze.com/ul?ll=${f.lat}%2C${f.lng}&navigate=yes" target="_blank" rel="noopener">Open in Waze</a>
        <a class="btnlink" href="#" data-idx="${item.idx}">Center</a>
      </div>
    `;
    li.querySelector('a[data-idx]').addEventListener('click', (e)=>{
      e.preventDefault();
      state.map.setView([f.lat, f.lng], 17);
      m.openPopup();
    });
    resultsEl.appendChild(li);
  }

  // Fit view: keep it simple (center ref + zoom)
  // user can pan/zoom freely
}

function escapeHtml(s){
  return (s ?? '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

// ---------- Facility search (centering helper) ----------
function updateFacilityMatches(){
  const q = document.getElementById('facilitySearch').value.trim().toLowerCase();
  const box = document.getElementById('facilityMatches');
  box.innerHTML = '';
  if (!q || q.length < 2) return;

  // Lightweight search: scan until we find 20 matches (fast enough for 34k)
  const matches = [];
  const max = 20;
  for (let i=0; i<state.facilities.length; i++){
    const f = state.facilities[i];
    if (f.id.toLowerCase().includes(q) || f.property.toLowerCase().includes(q)){
      matches.push({ i, f });
      if (matches.length >= max) break;
    }
  }

  for (const m of matches){
    const div = document.createElement('div');
    div.className = 'match';
    div.innerHTML = `<b>${escapeHtml(m.f.id)}</b><small>${escapeHtml(m.f.property)}</small>`;
    div.addEventListener('click', ()=>{
      state.ref = { lat: m.f.lat, lng: m.f.lng, label: `${m.f.id} — ${m.f.property}` };
      setRefMarker(m.f.lat, m.f.lng, state.ref.label);
      document.getElementById('coordStatus').textContent = `Reference set to: ${m.f.lat.toFixed(6)}, ${m.f.lng.toFixed(6)}`;
      box.innerHTML = '';
      document.getElementById('facilitySearch').blur();
    });
    box.appendChild(div);
  }
}

// ---------- Data loading ----------
async function loadData(){
  const statusEl = document.getElementById('dataStatus');
  try{
    setStatus(statusEl, 'Loading data…');
    const [facRes, idxRes] = await Promise.all([
      fetch('./facilities.json', { cache: 'no-store' }),
      fetch('./facilities_index.json', { cache: 'no-store' })
    ]);
    if (!facRes.ok) throw new Error('facilities.json failed to load');
    if (!idxRes.ok) throw new Error('facilities_index.json failed to load');

    state.facilities = await facRes.json();
    const idxPayload = await idxRes.json();
    state.cellSizeDeg = idxPayload.cell_size_deg || 0.01;
    state.index = idxPayload.index || {};

    setStatus(statusEl, `Loaded ${state.facilities.length.toLocaleString()} facilities.`);
  }catch(err){
    console.error(err);
    setStatus(statusEl, `Data load error: ${err.message}`, true);
  }
}

// ---------- UI wiring ----------
function wireUI(){
  const radius = document.getElementById('radius');
  const radiusLabel = document.getElementById('radiusLabel');
  radiusLabel.textContent = radius.value;

  radius.addEventListener('input', ()=>{
    radiusLabel.textContent = radius.value;
  });

  document.getElementById('btnSearch').addEventListener('click', runSearch);

  document.getElementById('btnGps').addEventListener('click', ()=>{
    const st = document.getElementById('coordStatus');
    setStatus(st, 'Requesting GPS…');
    if (!navigator.geolocation){
      setStatus(st, 'Geolocation not supported in this browser.', true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos)=>{
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        state.ref = { lat, lng, label: 'GPS location' };
        setRefMarker(lat, lng, 'GPS location');
        setStatus(st, `Using GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      },
      (err)=>{
        setStatus(st, `GPS error: ${err.message}`, true);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });

  document.getElementById('btnUseCoords').addEventListener('click', ()=>{
    const input = document.getElementById('coordInput').value;
    const st = document.getElementById('coordStatus');
    const parsed = parseCoordinates(input);
    if (!parsed){
      setStatus(st, 'Could not parse coordinates. Try decimal "lat, lng" or DMS with N/E.', true);
      return;
    }
    state.ref = { lat: parsed.lat, lng: parsed.lng, label: 'Manual coordinates' };
    setRefMarker(parsed.lat, parsed.lng, 'Manual coordinates');
    setStatus(st, `Using coordinates: ${parsed.lat.toFixed(6)}, ${parsed.lng.toFixed(6)}`);
  });

  document.getElementById('btnClear').addEventListener('click', ()=>{
    state.ref = null;
    if (state.layers.refMarker) state.layers.refMarker.remove();
    clearResults();
    document.getElementById('coordStatus').textContent = '';
    document.getElementById('coordInput').value = '';
    document.getElementById('facilitySearch').value = '';
    document.getElementById('facilityMatches').innerHTML = '';
  });

  document.getElementById('facilitySearch').addEventListener('input', updateFacilityMatches);
}

// ---------- Boot ----------
(async function main(){
  initMap();
  wireUI();
  await loadData();
})();
