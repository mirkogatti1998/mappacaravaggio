// csv_to_json.js
// Converte poi.csv (separatore ;) in poi.json per la mappa
// Output: { name, category, short, long, lat, lon, links: [] }
//
// NOTE:
// - NON usare Leaflet qui (niente L.map / L.tileLayer). Questo gira in Node.
// - "descrizione" va in long
// - "breve" (se esiste) va in short
// - categoria vuota -> "" (NON "Altro") così non compare nei filtri

const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "poi.csv");
const JSON_PATH = path.join(__dirname, "poi.json");

// ---------------- Helpers ----------------
function stripBOM(s) {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// parser CSV semplice ma robusto (gestisce ; , virgolette, "" dentro le virgolette)
function parseCSVLine(line, sep = ";") {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // doppie virgolette dentro campo quoted: "" -> "
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === sep) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map(v => v.trim());
}

function parsePointWKT(wktRaw) {
  if (!wktRaw) return null;
  const wkt = String(wktRaw).trim();

  // accetta: POINT (lon lat)
  const m = wkt.match(/^POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)\s*$/i);
  if (!m) return null;

  const lon = Number(m[1]);
  const lat = Number(m[2]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function normHeader(h) {
  return stripBOM(String(h || "")).trim().toLowerCase();
}

function pickCategory(rowCategory) {
  // niente "Altro": se vuoto lasciamo stringa vuota
  return (rowCategory || "").trim();
}

// ---------------- Main ----------------
if (!fs.existsSync(CSV_PATH)) {
  console.error("ERRORE: non trovo poi.csv nella cartella del progetto:", CSV_PATH);
  process.exit(1);
}

const raw = fs.readFileSync(CSV_PATH, "utf8");

// normalizza righe (Excel a volte usa \r\n)
const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);

if (lines.length < 2) {
  console.error("ERRORE: poi.csv sembra vuoto o ha solo intestazioni.");
  process.exit(1);
}

// intestazioni
const headerCols = parseCSVLine(lines[0], ";").map(normHeader);

// mappa colonne (breve è opzionale)
const idxWkt = headerCols.indexOf("wkt");
const idxNome = headerCols.indexOf("nome");
const idxBreve = headerCols.indexOf("breve"); // opzionale
const idxDesc = headerCols.indexOf("descrizione");
const idxCat = headerCols.indexOf("categoria");
const idxImgs = headerCols.indexOf("imgs"); // opzionale


if (idxWkt === -1 || idxNome === -1 || idxDesc === -1 || idxCat === -1) {
  console.error("ERRORE: intestazioni mancanti.");
  console.error("Servono: WKT;nome;descrizione;categoria  (breve opzionale)");
  console.error("Trovate:", headerCols.join(";"));
  process.exit(1);
}

const pois = [];
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i], ";");

  const wkt = (cols[idxWkt] || "").trim();
  const nome = (cols[idxNome] || "").trim();
  const descrizione = (cols[idxDesc] || "").trim(); // -> long
  const breve = idxBreve >= 0 ? (cols[idxBreve] || "").trim() : ""; // -> short
  const categoria = pickCategory(cols[idxCat]);
  const imgsRaw = idxImgs >= 0 ? (cols[idxImgs] || "").trim() : "";
const imgs = imgsRaw
  ? imgsRaw.split("|").map(s => s.trim()).filter(Boolean)
  : [];


  if (!wkt || !nome) {
    skipped++;
    continue;
  }

  const p = parsePointWKT(wkt);
  if (!p) {
    skipped++;
    continue;
  }

  pois.push({
    name: nome,
    category: categoria,
    short: breve,
    long: descrizione,
    lat: p.lat,
    lon: p.lon,
    links: [],
    imgs: imgs
  });
}

fs.writeFileSync(JSON_PATH, JSON.stringify(pois, null, 2), "utf8");
console.log(`OK: creato ${JSON_PATH} con ${pois.length} punti.`);
if (skipped) console.log(`Righe saltate: ${skipped} (vuote o WKT non valido).`);
