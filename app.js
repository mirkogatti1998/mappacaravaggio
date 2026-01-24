// ===== 1) Mappa =====
const DEFAULT_VIEW = { center: [45.497, 9.644], zoom: 15 };

const map = L.map("map", { zoomControl: false })
  function kickLeafletResize(){
  setTimeout(() => map.invalidateSize(), 50);
  setTimeout(() => map.invalidateSize(), 250);
}

window.addEventListener("resize", kickLeafletResize);
window.addEventListener("orientationchange", kickLeafletResize);
  map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

// ===== Pane itinerari (sotto ai marker) =====
map.createPane("routesPane");
map.getPane("routesPane").style.zIndex = 350; // markerPane è sopra (~600)

// ===== Itinerari (LineString) + Punti pericolosi (Point) =====
let itinerariLayer = null;

// ===== Modalità percorso =====
const ROUTE_NEAR_METERS = 180; // POI entro 180m dal percorso restano “normali”
let routePolylines = [];
let activeRouteLayer = null;

// ===== Tracking reale (GPS) =====
let tracking = false;
let watchId = null;
let trackStartMs = 0;
let trackMeters = 0;
let lastLatLng = null;
let uiTimer = null;

let exitRouteCtrl = null;
let routeInfoCtrl = null;
let trackCtrl = null;

function formatHMS(ms){
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h ? `${h}:` : "") + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
}

function getRouteLengthKm(layer){
  const latlngs = layer.getLatLngs();
  const segs = Array.isArray(latlngs[0]) ? latlngs : [latlngs];

  let meters = 0;
  for (const seg of segs){
    for (let i = 1; i < seg.length; i++){
      meters += seg[i-1].distanceTo(seg[i]);
    }
  }
  return meters / 1000;
}

function estimateTimeMinutes(km, speedKmh){
  return Math.round((km / speedKmh) * 60);
}

function ensureExitRouteBtn(){
  if (exitRouteCtrl) return;

  exitRouteCtrl = L.control({ position: "topright" });
  exitRouteCtrl.onAdd = () => {
    const div = L.DomUtil.create("div", "route-exit");
    div.innerHTML = `<button type="button" class="route-exit-btn">Esci percorso</button>`;
    L.DomEvent.disableClickPropagation(div);
    div.querySelector("button").addEventListener("click", clearRouteMode);
    return div;
  };
  exitRouteCtrl.addTo(map);
}

function showExitRouteBtn(show){
  ensureExitRouteBtn();
  const el = document.querySelector(".route-exit");
  if (el) el.style.display = show ? "" : "none";
}

function ensureRouteInfoUI(){
  if (routeInfoCtrl) return;

  routeInfoCtrl = L.control({ position: "topright" });
  routeInfoCtrl.onAdd = () => {
    const div = L.DomUtil.create("div", "route-info");
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  routeInfoCtrl.addTo(map);
}

function showRouteInfo(show, html = ""){
  ensureRouteInfoUI();
  const el = document.querySelector(".route-info");
  if (!el) return;
  el.style.display = show ? "" : "none";
  if (show) el.innerHTML = html;
}

function ensureTrackUI(){
  if (trackCtrl) return;

  trackCtrl = L.control({ position: "bottomleft" });
  trackCtrl.onAdd = () => {
    const div = L.DomUtil.create("div", "track-box");
    div.innerHTML = `
      <div class="track-row">
        <strong>Tracciamento</strong>
        <button type="button" class="track-btn" data-act="toggle">Start</button>
      </div>
      <div class="track-metrics">
        ⏱ <span data-t="time">00:00</span>
        <span class="track-sep">•</span>
        📏 <span data-t="dist">0.00</span> km
      </div>
    `;
    L.DomEvent.disableClickPropagation(div);

    div.querySelector('[data-act="toggle"]').addEventListener("click", () => {
      tracking ? stopTracking() : startTracking();
    });

    return div;
  };
  trackCtrl.addTo(map);
}

function showTrackUI(show){
  ensureTrackUI();
  const el = document.querySelector(".track-box");
  if (el) el.style.display = show ? "" : "none";
}

function updateTrackUI(){
  const box = document.querySelector(".track-box");
  if (!box) return;

  const tEl = box.querySelector('[data-t="time"]');
  const dEl = box.querySelector('[data-t="dist"]');
  const btn = box.querySelector('[data-act="toggle"]');

  const now = Date.now();
  const elapsed = tracking ? now - trackStartMs : 0;

  if (tEl) tEl.textContent = tracking ? formatHMS(elapsed) : "00:00";
  if (dEl) dEl.textContent = (trackMeters/1000).toFixed(2);
  if (btn) btn.textContent = tracking ? "Stop" : "Start";
}

function startTracking(){
  if (!("geolocation" in navigator)){
    alert("Geolocalizzazione non supportata dal browser.");
    return;
  }

  tracking = true;
  trackStartMs = Date.now();
  trackMeters = 0;
  lastLatLng = null;

  if (uiTimer) clearInterval(uiTimer);
  uiTimer = setInterval(updateTrackUI, 1000);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const cur = L.latLng(latitude, longitude);

      // filtro: ignora GPS troppo impreciso
      if (accuracy && accuracy > 35) return;

      if (lastLatLng){
        const d = lastLatLng.distanceTo(cur);
        // ignora jitter sotto 10m
        if (d >= 10) trackMeters += d;
      }

      lastLatLng = cur;
      updateTrackUI();
    },
    () => {
      stopTracking();
      alert("Posizione non disponibile (permesso negato o segnale debole).");
    },
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
  );

  updateTrackUI();
}

function stopTracking(){
  tracking = false;

  if (watchId !== null){
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (uiTimer){
    clearInterval(uiTimer);
    uiTimer = null;
  }

  updateTrackUI();
}

// distanza punto -> polilinea (metri) in WebMercator
function pointToPolylineMeters(polyLayer, latlng){
  const latlngs = polyLayer.getLatLngs();
  const segs = Array.isArray(latlngs[0]) ? latlngs : [latlngs];

  const crs = map.options.crs;
  const p = crs.project(latlng);

  function distPointToSeg(p, a, b){
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;

    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);

    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);

    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    return Math.hypot(p.x - px, p.y - py);
  }

  let best = Infinity;
  for (const seg of segs){
    for (let i = 1; i < seg.length; i++){
      const a = crs.project(seg[i-1]);
      const b = crs.project(seg[i]);
      best = Math.min(best, distPointToSeg(p, a, b));
    }
  }
  return best;
}

function applyRouteMode(routeLayer, routeName = "", routeDesc = ""){
  activeRouteLayer = routeLayer;
if (window.matchMedia("(max-width: 640px)").matches) setTopbarCollapsed(true);

  // evidenzia percorso attivo, spegne gli altri
  routePolylines.forEach(l => {
    if (l === activeRouteLayer) l.setStyle({ weight: 7, opacity: 1 });
    else l.setStyle({ weight: 4, opacity: 0.18 });
  });

  // zoom sul percorso
  try { map.fitBounds(activeRouteLayer.getBounds(), { padding: [30, 30] }); } catch {}

  // POI: tutti attenuati, ma quelli vicini restano normali
  markers.forEach(m => {
    const p = m.__poi;
    if (!p) return;
    const d = pointToPolylineMeters(activeRouteLayer, L.latLng(p.lat, p.lon));
    const near = d <= ROUTE_NEAR_METERS;
    m.setOpacity(near ? 1 : 0.28);
  });

  // box info percorso (km + minuti stimati)
  const km = getRouteLengthKm(activeRouteLayer);
  const walkMin = estimateTimeMinutes(km, 3.5);
  const bikeMin = estimateTimeMinutes(km, 15);

  const html = `
    <div class="route-info-title">${escapeHtml(routeName || "Percorso")}</div>
    <div class="route-info-row">📏 <strong>${km.toFixed(1)} km</strong></div>
    <div class="route-info-row">🚶 ${walkMin} min &nbsp; <span class="route-info-muted">•</span> &nbsp; 🚴 ${bikeMin} min</div>
    ${routeDesc ? `<div class="route-info-desc">${escapeHtml(routeDesc)}</div>` : ""}
  `;
  showRouteInfo(true, html);

  // bottoni
  showExitRouteBtn(true);

  // tracking box (start/stop manuale)
  showTrackUI(true);
  updateTrackUI();
}

function clearRouteMode(){
  activeRouteLayer = null;
if (window.matchMedia("(max-width: 640px)").matches) setTopbarCollapsed(false);

  // reset stile itinerari
  routePolylines.forEach(l => l.setStyle({ weight: 5, opacity: 0.9 }));

  // reset POI
  markers.forEach(m => m.setOpacity(1));

  // nascondi box
  showExitRouteBtn(false);
  showRouteInfo(false);
  showTrackUI(false);

  // stop tracking se attivo
  stopTracking();
}

// ===== 2) Stato =====
let allPois = [];
let markers = [];
let userLatLng = null;
let userMarker = null;

let activeCategory = "all";

// ===== Livelli (default: solo luoghi da vedere) =====
let activeTypes = new Set(["see"]); // see | stories | hidden | lost | services


// ===== Preferiti =====
const FAV_KEY = "caravaggio_favs_v1";
let favSet = new Set();

function loadFavs(){
  try{
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) favSet = new Set(arr);
  } catch {}
}
function saveFavs(){
  try{
    localStorage.setItem(FAV_KEY, JSON.stringify([...favSet]));
  } catch {}
}

function slugify(s){
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function poiId(p){
  if (!p) return "";
  if (p.id) return String(p.id);
  const base = slugify(p.name);
  const lat = Number(p.lat).toFixed(5);
  const lon = Number(p.lon).toFixed(5);
  return `${base}-${lat}-${lon}`;
}

function isFav(p){ return favSet.has(poiId(p)); }

function toggleFav(p){
  const id = poiId(p);
  if (!id) return false;
  if (favSet.has(id)) favSet.delete(id);
  else favSet.add(id);
  saveFavs();
  return favSet.has(id);
}

// ===== 3) UI =====
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearch");

const sidePanel = document.getElementById("sidePanel");
const closePanel = document.getElementById("closePanel");
const panelContent = document.getElementById("panelContent");

// Header height (per drawer)
const headerEl = document.querySelector(".topbar");
function syncHeaderHeight(){
  if (!headerEl) return;
  document.documentElement.style.setProperty("--header-h", headerEl.offsetHeight + "px");
}
const footerEl = document.querySelector(".footer");
function syncFooterHeight(){
  if (!footerEl) return;
  document.documentElement.style.setProperty("--footer-h", footerEl.offsetHeight + "px");
}
window.addEventListener("resize", syncFooterHeight);
syncFooterHeight();

window.addEventListener("resize", syncHeaderHeight);
syncHeaderHeight();

// ===== Topbar collassabile (mobile) =====
const topbarToggle = document.getElementById("toggleTopbar");

function setTopbarCollapsed(collapsed){
  if (!headerEl) return;
  headerEl.classList.toggle("is-collapsed", collapsed);
document.body.classList.toggle("ui-hidden", collapsed);

  if (topbarToggle){
    topbarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    topbarToggle.textContent = collapsed ? "▴" : "▾";
    topbarToggle.setAttribute("aria-label", collapsed ? "Espandi pannello" : "Comprimi pannello");
  }

  syncHeaderHeight();
  setTimeout(() => map.invalidateSize(), 220);
}

if (topbarToggle){
  topbarToggle.addEventListener("click", () => {
    const isCollapsed = headerEl.classList.contains("is-collapsed");
    setTopbarCollapsed(!isCollapsed);
  });
}

// ===== Drawer helper (animazione leggera) =====
function openDrawer(el){
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden","false");
  el.classList.remove("anim-in");
  requestAnimationFrame(() => el.classList.add("anim-in"));
}
function closeDrawer(el){
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden","true");
  el.classList.remove("anim-in");
}

// ===== Drawer livelli =====
const toggleLevels = document.getElementById("toggleLevels");
const levelsDrawer = document.getElementById("levelsDrawer");
const closeLevels = document.getElementById("closeLevels");
const levelsList = document.getElementById("levelsList");

function openLevels(){ openDrawer(levelsDrawer); syncLevelsUI(); }
function closeLevelsDrawer(){ closeDrawer(levelsDrawer); }

if (toggleLevels) toggleLevels.addEventListener("click", () => {
  if (!levelsDrawer) return;
  levelsDrawer.classList.contains("hidden") ? openLevels() : closeLevelsDrawer();
});
if (closeLevels) closeLevels.addEventListener("click", closeLevelsDrawer);

function setLevel(mode){
  if (mode === "all") activeTypes = new Set(["see","stories","hidden","lost"]);
  else activeTypes = new Set([mode]);

  activeCategory = "all";

  closeLevelsDrawer();
  closeSidePanel();

  buildLegend();
  renderMarkers({ shouldZoom: true });

  if (nearbyDrawer && !nearbyDrawer.classList.contains("hidden")) renderNearbyList();
  if (favsDrawer && !favsDrawer.classList.contains("hidden")) renderFavsList();
}

function syncLevelsUI(){
  if (!levelsList) return;
  const chips = Array.from(levelsList.querySelectorAll(".level-chip"));

  const isAll = ["see","stories","hidden","lost","services"].every(x => activeTypes.has(x));
  chips.forEach(ch => {
    const lv = ch.dataset.level;
    ch.classList.toggle("active",
      (lv === "all" && isAll) || (lv !== "all" && !isAll && activeTypes.has(lv))
    );
  });
}

if (levelsList){
  levelsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".level-chip");
    if (!btn) return;
    setLevel(btn.dataset.level);
  });
}


// Drawer categorie
const toggleCats = document.getElementById("toggleCats");
const catsDrawer = document.getElementById("catsDrawer");
const closeCats = document.getElementById("closeCats");
const legendEl = document.getElementById("legend");

function openCats(){ openDrawer(catsDrawer); }
function closeCatsDrawer(){ closeDrawer(catsDrawer); }

if (toggleCats) toggleCats.addEventListener("click", () => {
  if (!catsDrawer) return;
  catsDrawer.classList.contains("hidden") ? openCats() : closeCatsDrawer();
});
if (closeCats) closeCats.addEventListener("click", closeCatsDrawer);

// Drawer vicini
const toggleNearby = document.getElementById("toggleNearby");
const nearbyDrawer = document.getElementById("nearbyDrawer");
const closeNearby = document.getElementById("closeNearby");
const nearbyList = document.getElementById("nearbyList");

const openGuide = document.getElementById("openGuide");

if (openGuide) {
  openGuide.addEventListener("pointerup", (e) => {
    e.preventDefault();
    window.location.href = "guida.html";
  }, { passive: false });
}



function openNearby(){
  openDrawer(nearbyDrawer);

  // "Vicino a me" fa anche "Dove sono io?"
  if (!userLatLng){
    locateMe();
    return; // aspetta il callback del GPS, che poi aggiorna lista e marker
  }

  renderNearbyList();
}

function closeNearbyDrawer(){ closeDrawer(nearbyDrawer); }

if (toggleNearby) toggleNearby.addEventListener("click", () => {
  if (!nearbyDrawer) return;
  nearbyDrawer.classList.contains("hidden") ? openNearby() : closeNearbyDrawer();
});
if (closeNearby) closeNearby.addEventListener("click", closeNearbyDrawer);

// Drawer preferiti
const toggleFavs = document.getElementById("toggleFavs");
const favsDrawer = document.getElementById("favsDrawer");
const closeFavs = document.getElementById("closeFavs");
const favsList = document.getElementById("favsList");

function openFavs(){
  openDrawer(favsDrawer);
  renderFavsList();
}
function closeFavsDrawer(){ closeDrawer(favsDrawer); }

if (toggleFavs) toggleFavs.addEventListener("click", () => {
  if (!favsDrawer) return;
  favsDrawer.classList.contains("hidden") ? openFavs() : closeFavsDrawer();
});
if (closeFavs) closeFavs.addEventListener("click", closeFavsDrawer);

// ===== 4) Icone =====
function makeIcon(url) {
  return L.icon({
    iconUrl: url,
    iconSize: [32, 37],
    iconAnchor: [16, 37],
    popupAnchor: [0, -33]
  });
}

const categoryIcons = {
  "Chiese e monasteri": makeIcon("icons/chiese.png"),
  "Museo": makeIcon("icons/museo.png"),
  "Natura": makeIcon("icons/natura.png"),
  "Opere militari e fortificazioni": makeIcon("icons/militari.png"),
  "Personaggi della storia": makeIcon("icons/personaggi.png"),
  "Storia": makeIcon("icons/storia.png"),
  "Tesori nascosti": makeIcon("icons/tesorinascosti.png"),
  "Edifici": makeIcon("icons/edificio.png"),
  "DAE": makeIcon("icons/dae.png"),
  "Stazione del treno": makeIcon("icons/treno.png"),
  "Stazione del bus": makeIcon("icons/bus.png"),
  "Parcheggio": makeIcon("icons/parcheggio.png"),
  "Località": makeIcon("icons/localita.png"),
  "Luoghi": makeIcon("icons/localita.png"),
  "Emergenza": makeIcon("icons/emergenza.png"),
};
const defaultIcon = makeIcon("icons/default.png");

// ===== 5) Helpers =====
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function truncate(str, max = 220){
  const s = String(str || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

function distanceMetersTo(p){
  if (!userLatLng) return null;
  return userLatLng.distanceTo(L.latLng(p.lat, p.lon));
}

function getPrettyDistance(p){
  const meters = distanceMetersTo(p);
  if (meters == null) return "";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

// URL indicazioni Google Maps (se ho posizione: origine=io, altrimenti apre destinazione)
function googleMapsDirectionsUrl(p){
  if (!p) return "#";
  const dest = `${p.lat},${p.lon}`;
  if (userLatLng) {
    const orig = `${userLatLng.lat},${userLatLng.lng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(orig)}&destination=${encodeURIComponent(dest)}&travelmode=walking`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`;
}

// deep-link: set / clear parametro in URL
function setPoiUrlParam(p){
  const id = poiId(p);
  if (!id) return;
  const url = new URL(window.location.href);
  url.searchParams.set("poi", id);
  history.replaceState({}, "", url.toString());
}
function clearPoiUrlParam(){
  const url = new URL(window.location.href);
  url.searchParams.delete("poi");
  history.replaceState({}, "", url.toString());
}

async function copyLinkForPoi(p){
  const id = poiId(p);
  if (!id) return;
  const url = new URL(window.location.href);
  url.searchParams.set("poi", id);
  const text = url.toString();

  try{
    if (navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      alert("Link copiato negli appunti.");
    } else {
      prompt("Copia questo link:", text);
    }
  } catch {
    prompt("Copia questo link:", text);
  }
}

// ===== 6) Side panel + Slider =====
function openPanel(p, distancePretty){
  if (!sidePanel || !panelContent) return;

  if (window.matchMedia("(max-width: 640px)").matches) setTopbarCollapsed(true);

  const imgs = Array.isArray(p.imgs) ? p.imgs : (p.img ? [p.img] : []);
  const sliderHtml = imgs.length
    ? `
      <div class="slider" data-slider>
        <button class="slider-btn prev" type="button" aria-label="Foto precedente">‹</button>
        <button class="slider-btn next" type="button" aria-label="Foto successiva">›</button>

        <div class="slider-track" data-track>
          ${imgs.map((src, i) => `
            <div class="slide">
              <img src="${src}" alt="${escapeHtml(p.name)} (${i+1})" data-open-lightbox="${i}">
            </div>
          `).join("")}
        </div>

        <div class="slider-dots" data-dots>
          ${imgs.map((_, i) => `<span class="slider-dot ${i===0 ? "active": ""}" data-dot="${i}"></span>`).join("")}
        </div>
      </div>
    `
    : "";


   const directionsUrl = googleMapsDirectionsUrl(p);
  const fav = isFav(p);

  panelContent.innerHTML = `
    <div class="panel-title">${escapeHtml(p.name)}</div>
    <div class="badge">${escapeHtml(p.category)}</div>

    ${sliderHtml}

    <div class="panel-actions">
      <a class="btn-primary" href="${directionsUrl}" target="_blank" rel="noopener">Apri Google Maps</a>

      <button class="icon-btn" type="button" data-fav-act="toggle"
        aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}"
        aria-pressed="${fav ? "true":"false"}">
        ${fav ? "★" : "☆"}
      </button>

      <button class="icon-btn" type="button" data-share-act="copy" aria-label="Copia link">🔗</button>
    </div>

    <div class="panel-text">${escapeHtml(p.long || p.short || "")}</div>

    ${distancePretty ? `<div class="panel-distance">📍 Distanza: <strong>${escapeHtml(distancePretty)}</strong></div>` : ""}
  `;

  sidePanel.classList.remove("hidden");
  sidePanel.setAttribute("aria-hidden", "false");

  // animazione leggera
  sidePanel.classList.remove("anim-in");
  requestAnimationFrame(() => sidePanel.classList.add("anim-in"));

  const favBtn = panelContent.querySelector('[data-fav-act="toggle"]');
  if (favBtn){
    favBtn.addEventListener("click", () => {
      const nowFav = toggleFav(p);
      favBtn.textContent = nowFav ? "★" : "☆";
      favBtn.setAttribute("aria-pressed", nowFav ? "true" : "false");
      favBtn.setAttribute("aria-label", nowFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti");

      if (favsDrawer && !favsDrawer.classList.contains("hidden")) renderFavsList();
      if (nearbyDrawer && !nearbyDrawer.classList.contains("hidden")) renderNearbyList();
    });
  }

  const shareBtn = panelContent.querySelector('[data-share-act="copy"]');
  if (shareBtn){
    shareBtn.addEventListener("click", () => copyLinkForPoi(p));
  }


  setupSliderAndLightbox(imgs, p.name);
  setPoiUrlParam(p);
}

function closeSidePanel(){
  if (!sidePanel) return;
  sidePanel.classList.add("hidden");
  sidePanel.setAttribute("aria-hidden", "true");
  clearPoiUrlParam();
}

if (closePanel) closePanel.addEventListener("click", closeSidePanel);

// ESC chiude pannello e drawer (accessibilità)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // se lightbox aperto, gestisce lui (vedi sotto)
  if (lightbox && !lightbox.classList.contains("hidden")) return;
  closeSidePanel();
  closeCatsDrawer();
  closeNearbyDrawer();
  closeFavsDrawer();
});

// Slider behavior (scroll-snap + pallini + frecce + click immagine)
function setupSliderAndLightbox(imgs, title){
  const slider = panelContent.querySelector("[data-slider]");
  if (!slider || !imgs || imgs.length === 0) return;

  const track = slider.querySelector("[data-track]");
  const dotsWrap = slider.querySelector("[data-dots]");
  const btnPrev = slider.querySelector(".slider-btn.prev");
  const btnNext = slider.querySelector(".slider-btn.next");
  if (!track || !dotsWrap) return;

  const dots = Array.from(dotsWrap.querySelectorAll("[data-dot]"));

  function setActiveDot(i){
    dots.forEach((d, idx) => d.classList.toggle("active", idx === i));
  }

  function scrollToIndex(i){
    const w = track.clientWidth;
    track.scrollTo({ left: i * (w + 10), behavior: "smooth" });
    setActiveDot(i);
  }

  track.addEventListener("scroll", () => {
    const w = track.clientWidth;
    const i = Math.round(track.scrollLeft / (w + 10));
    const clamped = Math.max(0, Math.min(i, imgs.length - 1));
    setActiveDot(clamped);
  }, { passive: true });

  if (btnPrev) btnPrev.addEventListener("click", () => {
    const w = track.clientWidth;
    const i = Math.round(track.scrollLeft / (w + 10));
    scrollToIndex(Math.max(0, i - 1));
  });

  if (btnNext) btnNext.addEventListener("click", () => {
    const w = track.clientWidth;
    const i = Math.round(track.scrollLeft / (w + 10));
    scrollToIndex(Math.min(imgs.length - 1, i + 1));
  });

  dots.forEach(d => d.addEventListener("click", () => scrollToIndex(Number(d.dataset.dot))));

  slider.querySelectorAll("[data-open-lightbox]").forEach(imgEl => {
    imgEl.style.cursor = "zoom-in";
    imgEl.addEventListener("click", () => {
      const i = Number(imgEl.dataset.openLightbox);
      openLightbox(imgs, i, title);
    });
  });
}

// ===== 7) Markers =====
function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

function computeFiltered() {
  const q = searchInput ? searchInput.value.trim().toLowerCase() : "";

  return allPois.filter(p => {
    const t = (p.type || "see");
    const matchType = activeTypes.has(t);

    const matchCat = (activeCategory === "all") || (p.category === activeCategory);

    const hay = `${p.name} ${p.short || ""} ${p.long || ""}`.toLowerCase();
    const matchQ = !q || hay.includes(q);

    return matchType && matchCat && matchQ;
  });
}


function zoomToVisibleMarkers() {
  if (markers.length === 0) return;

  if (markers.length === 1) {
    map.setView(markers[0].getLatLng(), 17, { animate: true });
    return;
  }

  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds(), { padding: [30, 30], animate: true });
}

function renderMarkers({ shouldZoom = false } = {}) {
  clearMarkers();

  const filtered = computeFiltered();

  filtered.forEach(p => {
    const pretty = getPrettyDistance(p);
    const icon = categoryIcons[p.category] || defaultIcon;

    const m = L.marker([p.lat, p.lon], { icon }).addTo(map);
    m.__poi = p;
    m.on("click", () => openPanel(p, pretty));
    markers.push(m);
  });

  if (shouldZoom) zoomToVisibleMarkers();

  // se sei in modalità percorso e cambi filtri: riapplica opacità coerente
  if (activeRouteLayer){
    markers.forEach(m => {
      const p = m.__poi;
      if (!p) return;
      const d = pointToPolylineMeters(activeRouteLayer, L.latLng(p.lat, p.lon));
      const near = d <= ROUTE_NEAR_METERS;
      m.setOpacity(near ? 1 : 0.28);
    });
  }

  // aggiorna liste se aperte
  if (nearbyDrawer && !nearbyDrawer.classList.contains("hidden")) renderNearbyList();
  if (favsDrawer && !favsDrawer.classList.contains("hidden")) renderFavsList();
}

// ===== 8) Legenda categorie (drawer) =====
function updateLegendActiveState(){
  if (!legendEl) return;
  legendEl.querySelectorAll(".legend-item").forEach(el => {
    el.classList.toggle("active", activeCategory !== "all" && el.dataset.cat === activeCategory);
  });
}

function buildLegend(){
  if (!legendEl) return;
  legendEl.innerHTML = "";

  const counts = {};
  computeFiltered().forEach(p => {
    if (!p.category) return;
    counts[p.category] = (counts[p.category] || 0) + 1;
  });

  const cats = Object.keys(counts).sort((a,b) => a.localeCompare(b, "it"));

  L.DomEvent.disableClickPropagation(legendEl);
  L.DomEvent.disableScrollPropagation(legendEl);

  cats.forEach(cat => {
    const row = document.createElement("div");
    row.className = "legend-item";
    row.dataset.cat = cat;

    const iconUrl =
      (categoryIcons[cat] && categoryIcons[cat].options && categoryIcons[cat].options.iconUrl)
        ? categoryIcons[cat].options.iconUrl
        : "icons/default.png";

    row.innerHTML = `
      <div class="legend-left">
        <img class="legend-icon" src="${iconUrl}" alt="">
        <div class="legend-name">${escapeHtml(cat)}</div>
      </div>
      <div class="legend-count">${counts[cat] || 0}</div>
    `;

    row.addEventListener("click", () => {
      activeCategory = (activeCategory === cat) ? "all" : cat;
      closeCatsDrawer();
      closeSidePanel();
      renderMarkers({ shouldZoom: true });
      updateLegendActiveState();
    });

    legendEl.appendChild(row);
  });

  updateLegendActiveState();
}


// ===== 9) Vicino a me =====
function poiCardHtml(p){
  const d = getPrettyDistance(p);
  const fav = isFav(p);

  return `
    <div class="poi-card" data-poi="${escapeHtml(poiId(p))}">
      <div class="poi-top">
        <div class="t">${escapeHtml(p.name)}</div>
        <button class="fav-mini" type="button"
          aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}"
          aria-pressed="${fav ? "true":"false"}">${fav ? "★" : "☆"}</button>
      </div>
      <div class="s">${escapeHtml(p.category || "")}${d ? ` • ${escapeHtml(d)}` : ""}</div>
      <div class="m">${escapeHtml(truncate(p.short || p.long || "", 110))}</div>
    </div>
  `;
}
function favCardHtml(p){
  const d = getPrettyDistance(p);
  const fav = isFav(p);

  return `
    <div class="poi-card poi-card--fav" data-poi="${escapeHtml(poiId(p))}">
      <div class="poi-top">
        <div class="t">${escapeHtml(p.name)}</div>
        <button class="fav-mini" type="button"
          aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}"
          aria-pressed="${fav ? "true":"false"}">${fav ? "★" : "☆"}</button>
      </div>
      ${d ? `<div class="s">${escapeHtml(d)}</div>` : ""}
    </div>
  `;
}

function bindPoiCardActions(container){
  if (!container) return;

  container.querySelectorAll(".poi-card").forEach(card => {
    const id = card.dataset.poi;
    const p = allPois.find(x => poiId(x) === id);
    if (!p) return;

    card.addEventListener("click", (e) => {
      if (e.target && e.target.closest(".fav-mini")) return;
      map.setView([p.lat, p.lon], 17, { animate:true });
      openPanel(p, getPrettyDistance(p));
    });

    const favBtn = card.querySelector(".fav-mini");
    if (favBtn){
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowFav = toggleFav(p);
        favBtn.textContent = nowFav ? "★" : "☆";
        favBtn.setAttribute("aria-pressed", nowFav ? "true" : "false");
        favBtn.setAttribute("aria-label", nowFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti");
        if (favsDrawer && !favsDrawer.classList.contains("hidden")) renderFavsList();
      });
    }
  });
}

function renderNearbyList(){
  if (!nearbyList) return;

  if (!userLatLng){
    nearbyList.innerHTML = `
      <div class="hint-box">
        Per vedere cosa c’è vicino, premi <strong>Dove sono io?</strong>.
      </div>
    `;
    return;
  }

  const filtered = computeFiltered();
  const withDist = filtered
    .map(p => ({ p, d: distanceMetersTo(p) }))
    .filter(x => x.d != null)
    .sort((a,b) => a.d - b.d)
    .slice(0, 20);

  if (withDist.length === 0){
    nearbyList.innerHTML = `<div class="hint-box">Nessun luogo trovato con i filtri attuali.</div>`;
    return;
  }

  nearbyList.innerHTML = withDist.map(x => poiCardHtml(x.p)).join("");
  bindPoiCardActions(nearbyList);
}

// ===== 10) Preferiti =====
function renderFavsList(){
  if (!favsList) return;

  const favPois = allPois.filter(p => favSet.has(poiId(p)));

  if (favPois.length === 0){
    favsList.innerHTML = `<div class="hint-box">Nessun preferito salvato.</div>`;
    return;
  }

  let sorted = [...favPois];
  if (userLatLng){
    sorted.sort((a,b) => (distanceMetersTo(a) ?? 1e12) - (distanceMetersTo(b) ?? 1e12));
  } else {
    sorted.sort((a,b) => String(a.name).localeCompare(String(b.name), "it"));
  }

  favsList.innerHTML = sorted.map(p => favCardHtml(p)).join("");
  bindPoiCardActions(favsList);
}

// ===== 11) Geolocalizzazione =====

const userArrowIcon = L.divIcon({
  className: "user-arrow",
  html: "➤",
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

let compassOn = false;

function enableCompassOnce(){
  if (compassOn) return;

  const start = () => {
    compassOn = true;

    // usa absolute quando c'è, ma su alcuni device arriva solo "deviceorientation"
    const handler = (e) => {
      if (!userMarker) return;

      const alpha = (e && typeof e.alpha === "number") ? e.alpha : null;
      if (alpha == null) return;

      const heading = 360 - alpha;
      const el = userMarker.getElement();
      if (el) el.style.transform = `rotate(${heading}deg)`;
    };

    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
  };

  // iOS: chiede permesso
  if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission()
      .then(state => { if (state === "granted") start(); })
      .catch(() => {});
  } else {
    start();
  }
}

function locateMe() {
  if (!("geolocation" in navigator)) {
    alert("Geolocalizzazione non supportata dal browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      userLatLng = L.latLng(latitude, longitude);

      map.setView([latitude, longitude], 16, { animate: true });

      // evita frecce duplicate
      if (userMarker) userMarker.remove();
      userMarker = L.marker([latitude, longitude], { icon: userArrowIcon }).addTo(map);

      // attiva bussola UNA sola volta
      enableCompassOnce();

      // niente popup "fastidioso": solo marker
      renderMarkers(); // aggiorna distanze
      if (nearbyDrawer && !nearbyDrawer.classList.contains("hidden")) renderNearbyList();
      if (favsDrawer && !favsDrawer.classList.contains("hidden")) renderFavsList();
    },
    () => alert("Posizione non disponibile (permesso negato o segnale debole).")
  );
}


// ===== 12) Search: X interna =====
function syncClearBtn(){
  if (!clearSearchBtn || !searchInput) return;
  const has = !!searchInput.value.trim();
  clearSearchBtn.style.opacity = has ? "1" : "0";
  clearSearchBtn.style.pointerEvents = has ? "auto" : "none";
  clearSearchBtn.setAttribute("aria-hidden", has ? "false" : "true");
}

if (searchInput){
  searchInput.addEventListener("input", () => {
    closeSidePanel();
    renderMarkers();
    updateLegendActiveState();
    syncClearBtn();
  });
}

if (clearSearchBtn && searchInput){
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    syncClearBtn();
    closeSidePanel();
    renderMarkers({ shouldZoom: false });
    updateLegendActiveState();
    searchInput.focus();
  });
}

syncClearBtn();

// ===== 13) Init =====
async function init() {
  loadFavs();

  const res = await fetch("poi.json");
  allPois = await res.json();

  buildLegend();
  renderMarkers();

  // deep-link: ?poi=
  const url = new URL(window.location.href);
  const poiParam = url.searchParams.get("poi");
  if (poiParam){
    const p = allPois.find(x => poiId(x) === poiParam);
    if (p){
      map.setView([p.lat, p.lon], 17, { animate: false });
      openPanel(p, getPrettyDistance(p));
    }
  }

  // carica itinerari dopo tutto
  loadItinerari();
}

init();

// ===== Carica Itinerari =====
async function loadItinerari(){
  try{
    const res = await fetch("itinerari.geojson", { cache: "no-store" });
    if (!res.ok) throw new Error("Impossibile caricare itinerari.geojson");
    const geo = await res.json();

    if (itinerariLayer) itinerariLayer.remove();

    // reset route mode storage
    routePolylines = [];
    activeRouteLayer = null;
    showExitRouteBtn(false);
    showRouteInfo(false);
    showTrackUI(false);
    stopTracking();

    itinerariLayer = L.geoJSON(geo, {
      pane: "routesPane",

      // stile linee (colori stabili per nome)
      style: (f) => {
        const t = f.geometry?.type;
        if (t !== "LineString" && t !== "MultiLineString") return null;

        const name = String(
          f.properties?.name || f.properties?.Nome || f.properties?.title || "Itinerario"
        );

        const palette = ["#C8A15A", "#4DA3FF", "#38D39F", "#F05D5E", "#9B8CFF", "#FFB020"];

        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        const color = palette[h % palette.length];

        return { color, weight: 5, opacity: 0.9 };
      },

      // punti pericolosi come cerchi rossi (sotto ai marker)
      pointToLayer: (f, latlng) => {
        return L.circleMarker(latlng, {
          pane: "routesPane",
          radius: 7,
          color: "#ff3b30",
          fillColor: "#ff3b30",
          fillOpacity: 0.9,
          weight: 2
        });
      },

      onEachFeature: (f, layer) => {
        const g = f.geometry?.type;

        if (g === "Point") {
          const name =
            f.properties?.name ||
            f.properties?.Nome ||
            f.properties?.title ||
            "Punto pericoloso";

          // popup minimo (solo tap), non invasivo
          layer.bindPopup(`<strong>${escapeHtml(name)}</strong>`, { autoPan: true });
        }

        if (g === "LineString" || g === "MultiLineString") {
          const name =
            f.properties?.name ||
            f.properties?.Nome ||
            f.properties?.title ||
            "Itinerario";

          const desc =
            f.properties?.desc ||
            f.properties?.descrizione ||
            f.properties?.short ||
            "";

          routePolylines.push(layer);
          layer.on("click", () => applyRouteMode(layer, name, desc));
        }
      }
    }).addTo(map);

  } catch(err){
    console.warn(err);
  }
}

// ===== Lightbox (fullscreen) =====
const lightbox = document.getElementById("lightbox");
const lbImg = document.getElementById("lbImg");
const lbClose = document.getElementById("lbClose");
const lbPrev = document.getElementById("lbPrev");
const lbNext = document.getElementById("lbNext");
const lbCounter = document.getElementById("lbCounter");

let lbImgs = [];
let lbIndex = 0;
let lbTitle = "";

function openLightbox(imgs, startIndex = 0, title = ""){
  if (!lightbox || !lbImg) return;

  lbImgs = imgs;
  lbIndex = startIndex;
  lbTitle = title;

  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  renderLightbox();
}

function closeLightbox(){
  if (!lightbox) return;
  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderLightbox(){
  if (!lbImg) return;
  const total = lbImgs.length;
  const src = lbImgs[lbIndex];

  lbImg.src = src;
  lbImg.alt = lbTitle ? `${lbTitle} (${lbIndex+1}/${total})` : `Foto ${lbIndex+1}/${total}`;

  if (lbCounter) lbCounter.textContent = `${lbIndex + 1}/${total}`;
  if (lbPrev) lbPrev.style.display = total > 1 ? "" : "none";
  if (lbNext) lbNext.style.display = total > 1 ? "" : "none";
}

function lbSetIndex(i){
  const total = lbImgs.length;
  lbIndex = (i + total) % total;
  renderLightbox();
}

if (lbClose) lbClose.addEventListener("click", closeLightbox);
if (lbPrev) lbPrev.addEventListener("click", () => lbSetIndex(lbIndex - 1));
if (lbNext) lbNext.addEventListener("click", () => lbSetIndex(lbIndex + 1));

if (lightbox) {
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
}

document.addEventListener("keydown", (e) => {
  if (!lightbox || lightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") lbSetIndex(lbIndex - 1);
  if (e.key === "ArrowRight") lbSetIndex(lbIndex + 1);
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}




















