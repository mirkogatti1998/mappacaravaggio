// 1) Mappa
const DEFAULT_VIEW = { center: [45.497, 9.644], zoom: 15 };

const map = L.map("map", { zoomControl: true })
  .setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

// Base map
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// 2) Stato
let allPois = [];
let markers = [];
let userLatLng = null;
let userMarker = null;

// 3) UI
const categoryFilter = document.getElementById("categoryFilter");
const searchInput = document.getElementById("searchInput");
const locateBtn = document.getElementById("locateBtn");
const resetBtn = document.getElementById("resetBtn");
const resultsCount = document.getElementById("resultsCount");

const sidePanel = document.getElementById("sidePanel");
const closePanel = document.getElementById("closePanel");
const panelContent = document.getElementById("panelContent");
// --- Drawer categorie (legend) ---
const headerEl = document.querySelector(".topbar");
function syncHeaderHeight(){
  if (!headerEl) return;
  document.documentElement.style.setProperty("--header-h", headerEl.offsetHeight + "px");
}
window.addEventListener("resize", syncHeaderHeight);
syncHeaderHeight();

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

// 4) Icone (le tue)
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

// 5) Helpers
function escapeHtml(str){
  return String(str || "")
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
  if (!userLatLng) return null;
  const meters = userLatLng.distanceTo(L.latLng(p.lat, p.lon));
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

// 6) Side panel
function openPanel(p, distancePretty){
  if (!sidePanel || !panelContent) return;

  // supporta sia p.imgs (array) sia p.img (singola)
  const imgs = Array.isArray(p.imgs) && p.imgs.length
    ? p.imgs
    : (p.img ? [p.img] : []);

  const sliderHtml = imgs.length
    ? buildSliderHtml(imgs, p.name)
    : "";

  panelContent.innerHTML = `
    <div class="panel-title">${escapeHtml(p.name)}</div>
    <div class="badge">${escapeHtml(p.category || "")}</div>

    ${sliderHtml}

    <div class="panel-text">${escapeHtml(p.long || p.short || "")}</div>
    <div class="panel-meta">
      ${distancePretty ? `📍 Distanza: <strong>${escapeHtml(distancePretty)}</strong><br>` : ""}
      Lat: ${Number(p.lat).toFixed(6)} · Lon: ${Number(p.lon).toFixed(6)}
    </div>
  `;

  sidePanel.classList.remove("hidden");

  // attiva slider (se c’è)
  if (imgs.length) initSlider(panelContent);
}

function buildSliderHtml(imgs, altBase){
  const slides = imgs.map((src, i) => `
    <div class="slide ${i === 0 ? "is-active" : ""}">
      <img src="${src}" alt="${escapeHtml(altBase)} (${i+1})">
    </div>
  `).join("");

  const dots = imgs.map((_, i) => `
    <button class="dot ${i === 0 ? "is-active" : ""}" type="button" data-i="${i}" aria-label="Foto ${i+1}"></button>
  `).join("");

  return `
  <div class="slider" data-index="0" data-total="${imgs.length}">
    <div class="slides">
      ${slides}
    </div>

    <div class="counter">1/${imgs.length}</div>

    ${imgs.length > 1 ? `
      <button class="nav prev" type="button" aria-label="Foto precedente">‹</button>
      <button class="nav next" type="button" aria-label="Foto successiva">›</button>
      <div class="dots">${dots}</div>
    ` : ""}
  </div>
`;
}

function initSlider(root){
  const slider = root.querySelector(".slider");
  if (!slider) return;

  const slides = Array.from(slider.querySelectorAll(".slide"));
  const dots = Array.from(slider.querySelectorAll(".dot"));
  const prevBtn = slider.querySelector(".prev");
  const nextBtn = slider.querySelector(".next");
  const counterEl = slider.querySelector(".counter");

  const imgs = slides.map(s => s.querySelector("img")?.getAttribute("src")).filter(Boolean);
  const total = slides.length;

  function setIndex(i){
    const idx = (i + total) % total;
    slider.dataset.index = String(idx);

    slides.forEach((s, k) => s.classList.toggle("is-active", k === idx));
    dots.forEach((d, k) => d.classList.toggle("is-active", k === idx));
    if (counterEl) counterEl.textContent = `${idx + 1}/${total}`;
  }

  if (prevBtn) prevBtn.addEventListener("click", () => setIndex(Number(slider.dataset.index) - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => setIndex(Number(slider.dataset.index) + 1));
  dots.forEach(d => d.addEventListener("click", () => setIndex(Number(d.dataset.i))));

  // click su immagine -> fullscreen
  slides.forEach((s, i) => {
    const img = s.querySelector("img");
    if (!img) return;
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => openLightbox(imgs, i));
  });

  // swipe semplice
  let startX = null;
  slider.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  slider.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) < 30) return;
    if (dx > 0) setIndex(Number(slider.dataset.index) - 1);
    else setIndex(Number(slider.dataset.index) + 1);
  });

  setIndex(0);
}

// per evitare che descrizioni con < > rompano l’HTML
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function closeSidePanel(){
  if (!sidePanel) return;
  sidePanel.classList.add("hidden");
}

if (closePanel) closePanel.addEventListener("click", closeSidePanel);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSidePanel();
});

// 7) Markers
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

    const popupHtml = `
      <div class="popup-title">${escapeHtml(p.name)}</div>
      <div class="popup-badge">${escapeHtml(p.category || "")}</div>
      ${p.short ? `<p class="popup-text">${escapeHtml(truncate(p.short, 240))}</p>` : ""}
      <div class="popup-meta">
        ${pretty ? `<strong>Distanza:</strong> ${pretty}` : `Premi “Dove sono io?” per vedere la distanza.`}
      </div>
      <div class="popup-actions">
        <a href="#" class="popup-btn primary" data-open="1">Dettagli</a>
        ${p.links?.[0]?.url ? `<a href="${p.links[0].url}" target="_blank" rel="noopener" class="popup-btn">Google Maps</a>` : ""}
      </div>
    `;

    const icon = categoryIcons[p.category] || defaultIcon;

    const m = L.marker([p.lat, p.lon], { icon }).addTo(map);

m.on("click", () => {
  // distanza “pretty” se disponibile
  let pretty = "";
  if (userLatLng) {
    const meters = userLatLng.distanceTo(L.latLng(p.lat, p.lon));
    pretty = meters < 1000 ? `${Math.round(meters)} m` : `${(meters/1000).toFixed(1)} km`;
  }
  openPanel(p, pretty);
});

    // Apri pannello al click sul marker
    m.on("click", () => openPanel(p, pretty));

    // Bottone "Dettagli" dentro popup
    m.on("popupopen", (e) => {
      const el = e.popup.getElement();
      const btn = el ? el.querySelector('[data-open="1"]') : null;
      if (btn) {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          openPanel(p, pretty);
        }, { once: true });
      }
    });

    markers.push(m);
  });

  if (shouldZoom) zoomToVisibleMarkers();
}

// 8) Categorie + legenda cliccabile
function populateCategories(pois) {
  if (!categoryFilter) return;
  const cats = Array.from(new Set(pois.map(p => p.category))).sort();
  cats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categoryFilter.appendChild(opt);
  });
}

// Leaflet control legenda
let legendControl = null;

function buildLegend(){
  if (!legendEl) return;
  legendEl.innerHTML = "";

  // conta per categoria (solo tra i POI caricati)
  const counts = {};
  allPois.forEach(p => {
    if (!p.category) return;
    counts[p.category] = (counts[p.category] || 0) + 1;
  });

  const cats = Object.keys(counts).sort((a,b) => a.localeCompare(b, "it"));

  cats.forEach(cat => {
    const row = document.createElement("div");
    row.className = "legend-item";
    row.innerHTML = `
      <div class="legend-left">
        <img class="legend-icon" src="${(categoryIcons[cat] || defaultIcon).options.iconUrl}" alt="">
        <div class="legend-name">${cat}</div>
      </div>
      <div class="legend-count">${counts[cat]}</div>
    `;

    // click: seleziona categoria e chiude drawer
    row.addEventListener("click", () => {
      if (categoryFilter) categoryFilter.value = cat;
      closeCatsDrawer();
      renderMarkers();
    });

    legendEl.appendChild(row);
  });
}


  legendControl.addTo(map);

  // Popola voci legenda con conteggi
  const listEl = document.getElementById("legendList");
  if (!listEl) {
    console.warn("legendList non trovato: salto popolamento legenda.");
               } else {

  const counts = {};
  allPois.forEach(p => {
    counts[p.category] = (counts[p.category] || 0) + 1;
  });

  const cats = Array.from(new Set(allPois.map(p => p.category))).sort();

  // Impedisce che clic sulla legenda trascini la mappa
  L.DomEvent.disableClickPropagation(listEl);
  L.DomEvent.disableScrollPropagation(listEl);

  cats.forEach(cat => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.cat = cat;
  }
    const iconUrl = (categoryIcons[cat]?.options?.iconUrl) || "icons/default.png";

    item.innerHTML = `
      <img class="legend-icon" src="${iconUrl}" alt="">
      <div class="legend-name">${escapeHtml(cat)}</div>
      <div class="legend-count">${counts[cat] || 0}</div>
    `;

    item.addEventListener("click", () => {
      // toggle: se già selezionata, torna "all"
      if (categoryFilter.value === cat) {
        categoryFilter.value = "all";
      } else {
        categoryFilter.value = cat;
      }
      closeSidePanel();
      renderMarkers({ shouldZoom: true });
      updateLegendActiveState();
    });

    listEl.appendChild(item);
  });

  updateLegendActiveState();
}

function updateLegendActiveState() {
  const listEl = document.getElementById("legendList");
  if (!listEl) return;
  const active = categoryFilter ? categoryFilter.value : "all";
  listEl.querySelectorAll(".legend-item").forEach(el => {
    el.classList.toggle("active", active !== "all" && el.dataset.cat === active);
  });
}

// 9) Geolocalizzazione
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

// 10) Reset filtri (micro-dettaglio)
function resetAll(){
  if (categoryFilter) categoryFilter.value = "all";
  if (searchInput) searchInput.value = "";
  closeSidePanel();
  map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { animate: true });
  renderMarkers();
  updateLegendActiveState();
}

if (resetBtn) resetBtn.addEventListener("click", resetAll);

// 11) Init
async function init() {
  const res = await fetch("poi.json");
  allPois = await res.json();

  populateCategories(allPois);
  buildLegend();

  renderMarkers();

  // Zoom solo quando cambi categoria dal select
  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => {
      closeSidePanel();
      renderMarkers({ shouldZoom: true });
      updateLegendActiveState();
    });
  }

  // Niente zoom mentre scrivi
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

function openLightbox(imgs, startIndex){
  if (!lightbox || !lbImg) return;

  lbImgs = imgs;
  lbIndex = startIndex;

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

// click sullo sfondo chiude (non sul frame)
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



