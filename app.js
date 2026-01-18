// ===== 1) Mappa =====
const DEFAULT_VIEW = { center: [45.497, 9.644], zoom: 15 };

const map = L.map("map", { zoomControl: true })
  .setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ===== Itinerari (LineString) + Punti pericolosi (Point) =====
let itinerariLayer = null;

async function loadItinerari(){
  try{
    const res = await fetch("itinerari.geojson", { cache: "no-store" });
    if (!res.ok) throw new Error("Impossibile caricare itinerari.geojson");
    const geo = await res.json();

    // se lo ricarichi, pulisci
    if (itinerariLayer) itinerariLayer.remove();

    itinerariLayer = L.geoJSON(geo, {
      // stile linee
      style: (f) => {
        if (f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString")){
          return {
            color: "#C8A15A",
            weight: 5,
            opacity: 0.9
          };
        }
        return null;
      },

      // punti (pericoli) come cerchi rossi
      pointToLayer: (f, latlng) => {
        return L.circleMarker(latlng, {
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
          layer.bindPopup(`<strong>${escapeHtml(name)}</strong>`);
        }
        if (g === "LineString" || g === "MultiLineString") {
          const name =
            f.properties?.name ||
            f.properties?.Nome ||
            f.properties?.title ||
            "Itinerario";
          layer.bindPopup(`<strong>${escapeHtml(name)}</strong>`);
        }
      }
    }).addTo(map);

  } catch(err){
    console.warn(err);
  }
}

loadItinerari();


// ===== 2) Stato =====
let allPois = [];
let markers = [];
let userLatLng = null;
let userMarker = null;

// ===== 3) UI =====
const categoryFilter = document.getElementById("categoryFilter");
const searchInput = document.getElementById("searchInput");
const locateBtn = document.getElementById("locateBtn");
const resetBtn = document.getElementById("resetBtn");
const resultsCount = document.getElementById("resultsCount");

const sidePanel = document.getElementById("sidePanel");
const closePanel = document.getElementById("closePanel");
const panelContent = document.getElementById("panelContent");

// Drawer categorie
const headerEl = document.querySelector(".topbar");
function syncHeaderHeight(){
  if (!headerEl) return;
  document.documentElement.style.setProperty("--header-h", headerEl.offsetHeight + "px");
}
window.addEventListener("resize", syncHeaderHeight);
syncHeaderHeight();
// ===== Topbar collassabile (mobile) =====
const topbarToggle = document.getElementById("toggleTopbar");

function setTopbarCollapsed(collapsed){
  if (!headerEl) return;
  headerEl.classList.toggle("is-collapsed", collapsed);

  if (topbarToggle){
    topbarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    topbarToggle.textContent = collapsed ? "▴" : "▾";
    topbarToggle.setAttribute("aria-label", collapsed ? "Espandi pannello" : "Comprimi pannello");
  }

  // importantissimo: aggiorna variabile CSS usata dal drawer e layout
  syncHeaderHeight();

  // Leaflet: dopo cambi di layout, forza ridisegno mappa (evita glitch)
  setTimeout(() => map.invalidateSize(), 220);
}

if (topbarToggle){
  topbarToggle.addEventListener("click", () => {
    const isCollapsed = headerEl.classList.contains("is-collapsed");
    setTopbarCollapsed(!isCollapsed);
  });
}

const toggleCats = document.getElementById("toggleCats");
const catsDrawer = document.getElementById("catsDrawer");
const closeCats = document.getElementById("closeCats");
const legendEl = document.getElementById("legend");

function openCats(){
  if (!catsDrawer) return;
  catsDrawer.classList.remove("hidden");
  catsDrawer.setAttribute("aria-hidden","false");
}
function closeCatsDrawer(){
  if (!catsDrawer) return;
  catsDrawer.classList.add("hidden");
  catsDrawer.setAttribute("aria-hidden","true");
}

if (toggleCats) toggleCats.addEventListener("click", () => {
  if (!catsDrawer) return;
  catsDrawer.classList.contains("hidden") ? openCats() : closeCatsDrawer();
});
if (closeCats) closeCats.addEventListener("click", closeCatsDrawer);

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
  "Opere militari": makeIcon("icons/militari.png"),
  "Personaggi della storia": makeIcon("icons/personaggi.png"),
  "Porta": makeIcon("icons/porta.png"),
  "Storia": makeIcon("icons/storia.png"),
  "Tesori nascosti": makeIcon("icons/tesori.png"),
  "Edifici pubblici": makeIcon("icons/pubblici.png"),
  "Edifici privati": makeIcon("icons/privati.png"),
  "Località": makeIcon("icons/localita.png"),
  "Luoghi del quotidiano": makeIcon("icons/quotidiano.png"),
  "Luoghi di oggi": makeIcon("icons/oggi.png"),
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

function getPrettyDistance(p){
  if (!userLatLng) return "";
  const meters = userLatLng.distanceTo(L.latLng(p.lat, p.lon));
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

  // bottone indicazioni sempre presente
  const directionsUrl = googleMapsDirectionsUrl(p);

  panelContent.innerHTML = `
    <div class="panel-title">${escapeHtml(p.name)}</div>
    <div class="badge">${escapeHtml(p.category)}</div>

    ${sliderHtml}

    <div class="panel-actions">
      <a class="btn-primary" href="${directionsUrl}" target="_blank" rel="noopener">Apri Google Maps</a>
    </div>

    <div class="panel-text">${escapeHtml(p.long || p.short || "")}</div>

    <div class="panel-meta">
      ${distancePretty ? `📍 Distanza: <strong>${escapeHtml(distancePretty)}</strong><br>` : ""}
      Lat: ${Number(p.lat).toFixed(6)} · Lon: ${Number(p.lon).toFixed(6)}
    </div>
  `;

  sidePanel.classList.remove("hidden");

  // slider + lightbox
  setupSliderAndLightbox(imgs, p.name);
}

function closeSidePanel(){
  if (!sidePanel) return;
  sidePanel.classList.add("hidden");
}

if (closePanel) closePanel.addEventListener("click", closeSidePanel);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSidePanel();
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

  dots.forEach(d => {
    d.addEventListener("click", () => {
      scrollToIndex(Number(d.dataset.dot));
    });
  });

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
  const cat = categoryFilter ? categoryFilter.value : "all";
  const q = searchInput ? searchInput.value.trim().toLowerCase() : "";

  return allPois.filter(p => {
    const matchCat = (cat === "all") || (p.category === cat);
    const hay = `${p.name} ${p.short || ""} ${p.long || ""}`.toLowerCase();
    const matchQ = !q || hay.includes(q);
    return matchCat && matchQ;
  });
}

function updateResultsCount(n){
  if (!resultsCount) return;
  resultsCount.textContent = `${n} ${n === 1 ? "risultato" : "risultati"}`;
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
  updateResultsCount(filtered.length);

  filtered.forEach(p => {
    const pretty = getPrettyDistance(p);
    const icon = categoryIcons[p.category] || defaultIcon;

    const m = L.marker([p.lat, p.lon], { icon }).addTo(map);

    // IMPORTANTISSIMO: niente popup bianco. Click = solo pannello.
    m.on("click", () => openPanel(p, pretty));

    markers.push(m);
  });

  if (shouldZoom) zoomToVisibleMarkers();
}

// ===== 8) Categorie + legenda (drawer) =====
function populateCategories(pois) {
  if (!categoryFilter) return;
  const cats = Array.from(new Set(pois.map(p => p.category))).sort((a,b) => a.localeCompare(b, "it"));
  cats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categoryFilter.appendChild(opt);
  });
}

function updateLegendActiveState(){
  if (!legendEl) return;
  const active = categoryFilter ? categoryFilter.value : "all";
  legendEl.querySelectorAll(".legend-item").forEach(el => {
    el.classList.toggle("active", active !== "all" && el.dataset.cat === active);
  });
}

function buildLegend(){
  if (!legendEl) return;
  legendEl.innerHTML = "";

  const counts = {};
  allPois.forEach(p => {
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
      if (categoryFilter && categoryFilter.value === cat) categoryFilter.value = "all";
      else if (categoryFilter) categoryFilter.value = cat;

      closeCatsDrawer();
      closeSidePanel();
      renderMarkers({ shouldZoom: true });
      updateLegendActiveState();
    });

    legendEl.appendChild(row);
  });

  updateLegendActiveState();
}

// ===== 9) Geolocalizzazione =====
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

      if (userMarker) userMarker.remove();
      userMarker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color: "#0077ff",
        fillColor: "#0077ff",
        fillOpacity: 0.8
      }).addTo(map);

      userMarker.bindPopup("Sei qui").openPopup();

      renderMarkers(); // aggiorna distanze
    },
    () => alert("Posizione non disponibile (permesso negato o segnale debole).")
  );
}

if (locateBtn) locateBtn.addEventListener("click", locateMe);

// ===== 10) Reset =====
function resetAll(){
  if (categoryFilter) categoryFilter.value = "all";
  if (searchInput) searchInput.value = "";
  closeSidePanel();
  map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { animate: true });
  renderMarkers();
  updateLegendActiveState();
}

if (resetBtn) resetBtn.addEventListener("click", resetAll);

// ===== 11) Init =====
async function init() {
  const res = await fetch("poi.json");
  allPois = await res.json();

  populateCategories(allPois);
  buildLegend();
  renderMarkers();

  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => {
      closeSidePanel();
      renderMarkers({ shouldZoom: true });
      updateLegendActiveState();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      closeSidePanel();
      renderMarkers();
      updateLegendActiveState();
    });
  }
}

init();

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


