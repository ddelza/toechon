// 광주시·하남시·양평군 고등학교 지도
// - 학교: 경기데이터드림 "경기도_고등학교 현황" API (서비스명 HgschlM)
// - 배경지도: 브이월드 WMTS (키가 없으면 OpenStreetMap)
// - 행정경계: regions.geojson (dongs.geojson의 읍면동을 시군별로 합친 것 — 두 경계가 정확히 겹침)

const REGIONS = [
  { name: "광주시", color: "#d9480f" },
  { name: "하남시", color: "#1971c2" },
  { name: "양평군", color: "#2f9e44" },
];
const cfg = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);

// ---------- 지도 ----------
const map = L.map("map").setView([37.46, 127.48], 10);
let regionBounds = L.latLngBounds([[37.26, 127.10], [37.66, 127.86]]);
function fitRegion() { map.invalidateSize(); map.fitBounds(regionBounds, { padding: [10, 10] }); }
// 사용자가 지도를 직접 움직이기 전까지는 창 크기가 바뀔 때마다 세 지역에 다시 맞춘다
let userMoved = false;
["mousedown", "wheel", "touchstart"].forEach((ev) => $("map").addEventListener(ev, () => (userMoved = true), { passive: true }));
new ResizeObserver(() => {
  if (!userMoved && $("map").clientHeight > 0) fitRegion();
}).observe($("map"));

if (cfg.VWORLD_KEY) {
  L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${cfg.VWORLD_KEY}/Base/{z}/{y}/{x}.png`, {
    minZoom: 6, maxZoom: 19,
    attribution: '&copy; <a href="https://www.vworld.kr">VWorld</a> 국토교통부',
  }).addTo(map);
} else {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

// ---------- 행정경계 ----------
async function loadBoundaries() {
  const fc = await (await fetch("regions.geojson?v=20261126d")).json();
  const layer = L.geoJSON(fc, {
    style: (f) => {
      const r = REGIONS.find((r) => r.name === f.properties.name);
      return { color: r.color, weight: 3, fillColor: r.color, fillOpacity: 0.08 };
    },
    interactive: false,
  }).addTo(map);
  layer.eachLayer((l) => {
    L.tooltip({ permanent: true, direction: "center", className: "region-label" })
      .setContent(l.feature.properties.name).setLatLng(l.getBounds().getCenter()).addTo(map);
  });
  regionBounds = layer.getBounds();
  fitRegion();
}

// ---------- 읍·면·동 (마우스 올리면 파랗게 떠오름, 클릭하면 인구·고등학교 수) ----------
map.createPane("dongs").style.zIndex = 350; // 시군 경계·학교 점보다 아래
const dongStyle = { color: "#868e96", weight: 1, opacity: 0.7, fillColor: "#fff", fillOpacity: 0.01, className: "dong-path" };
const dongHover = { color: "#1c7ed6", weight: 2.5, opacity: 1, fillColor: "#339af0", fillOpacity: 0.45 };
let dongLayer = null;

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(lng, lat, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some((p) => inRing([lng, lat], p[0]) && !p.slice(1).some((h) => inRing([lng, lat], h)));
}
const fmt = (n) => (n == null ? "-" : n.toLocaleString("ko-KR"));

function dongPopup(f) {
  const p = f.properties;
  const hs = state.schools.filter((s) => s.region.name === p.sgg && inFeature(s.lng, s.lat, f.geometry));
  return `<div class="dong-pop"><b>${p.sgg} ${p.dong}</b>
    <div class="dp-row">인구 <b>${fmt(p.pop)}명</b> <span class="dp-sub">(${fmt(p.hh)}세대)</span></div>
    <div class="dp-row">고등학교 <b>${hs.length}개</b></div>
    ${hs.length ? "<div class=\"dp-sub\">" + hs.map((s) => s.name).join(", ") + "</div>" : ""}
    <div class="dp-src">주민등록 인구 2026년 10월 · 행정안전부</div></div>`;
}

async function loadDongs() {
  const fc = await (await fetch("dongs.geojson?v=20261126d")).json();
  dongLayer = L.geoJSON(fc, {
    pane: "dongs",
    style: dongStyle,
    onEachFeature: (f, layer) => {
      layer.on("mouseover", () => {
        layer.setStyle(dongHover);
        layer.bringToFront();
        layer.getElement()?.classList.add("lift");
      });
      layer.on("mouseout", () => {
        layer.setStyle(dongStyle);
        layer.getElement()?.classList.remove("lift");
      });
      layer.on("click", (e) => {
        L.popup({ className: "dong-popup" }).setLatLng(e.latlng).setContent(dongPopup(f)).openOn(map);
      });
    },
  }).addTo(map);
}

// ---------- 학교 ----------
async function fetchSchools() {
  const all = [];
  for (let page = 1; page < 10; page++) {
    const qs = new URLSearchParams({ KEY: cfg.GG_KEY, Type: "json", pIndex: page, pSize: 1000 });
    const j = await (await fetch("https://openapi.gg.go.kr/HgschlM?" + qs)).json();
    if (!j.HgschlM) {
      if (j.RESULT?.CODE === "INFO-200") break; // 더 이상 데이터 없음
      throw new Error(j.RESULT?.MESSAGE || "응답 오류");
    }
    all.push(...j.HgschlM[1].row);
    if (all.length >= j.HgschlM[0].head[0].list_total_count) break;
  }
  return all;
}

function regionOf(row) {
  const addr = `${row.REFINE_ROADNM_ADDR || ""} ${row.REFINE_LOTNO_ADDR || ""}`;
  return REGIONS.find((r) => addr.includes("경기도 " + r.name));
}

// ---------- 광수중학교 기준 거리 ----------
const HOME = { name: "광수중학교", lat: 37.47304, lng: 127.3196 }; // 광주시 퇴촌면 도수길23번길 23
function distKm(lat, lng) { // 직선거리(하버사인)
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat - HOME.lat) * rad, dLng = (lng - HOME.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(HOME.lat * rad) * Math.cos(lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
L.marker([HOME.lat, HOME.lng], {
  icon: L.divIcon({ className: "home-icon", html: "★", iconSize: [26, 26], iconAnchor: [13, 13] }),
  zIndexOffset: 1000,
}).bindTooltip(HOME.name, { permanent: true, direction: "top", offset: [0, -12], className: "home-label" }).addTo(map);
const lineLayer = L.layerGroup().addTo(map);
function showLine(s) {
  lineLayer.clearLayers();
  L.polyline([[HOME.lat, HOME.lng], [s.lat, s.lng]], { color: "#222", weight: 2, dashArray: "6 6" }).addTo(lineLayer);
}

const markerLayer = L.layerGroup().addTo(map);
const state = { schools: [], off: new Set(), q: "", labels: true };

function render() {
  markerLayer.clearLayers();
  const list = $("list");
  list.innerHTML = "";
  const visible = state.schools.filter((s) => !state.off.has(s.region.name) && s.name.includes(state.q));
  const seen = new Map(); // 같은 좌표(한 캠퍼스 두 학교) 이름표 겹침 방지
  for (const s of visible) {
    const k = s.lat.toFixed(5) + "," + s.lng.toFixed(5);
    const dup = seen.get(k) || 0;
    seen.set(k, dup + 1);
    const m = L.circleMarker([s.lat, s.lng], {
      radius: 7, color: "#fff", weight: 2, fillColor: s.region.color, fillOpacity: 1,
    }).addTo(markerLayer);
    m.bindTooltip(`${s.name.replace(/고등학교$/, "고")} <span class="km">${s.km.toFixed(1)}km</span>`, {
      permanent: state.labels, direction: dup ? "left" : "right", offset: [dup ? -8 : 8, 0], className: "hs-label",
    });
    m.on("popupopen", () => showLine(s));
    m.on("popupclose", () => lineLayer.clearLayers());
    m.on("mouseover", () => { const el = m.getTooltip()?.getElement(); if (el) el.style.visibility = ""; });
    m.bindPopup(`<b>${s.name}</b><br>광수중에서 직선 <b>${s.km.toFixed(1)}km</b><br>${s.region.name} · ${s.found}<br>${s.addr}<br>☎ ${s.tel}`);

    const li = document.createElement("li");
    li.innerHTML = `<span class="ldot" style="background:${s.region.color}"></span>${s.name}<span class="lkm">${s.km.toFixed(1)}km</span><small>${s.region.name} · ${s.found}</small>`;
    li.onclick = () => { map.setView([s.lat, s.lng], 15); m.openPopup(); };
    list.appendChild(li);
  }
  requestAnimationFrame(declutter);
  const by = REGIONS.map((r) => `${r.name} ${state.schools.filter((s) => s.region === r).length}`).join(" · ");
  $("count").textContent = `총 ${state.schools.length}개교 (${by})`;
}

// 이름표끼리 겹치면 뒤에 오는 것을 숨김 (확대하면 다시 보임, 점에 마우스를 올리면 항상 보임)
function declutter() {
  const placed = [];
  document.querySelectorAll(".hs-label").forEach((el) => {
    el.style.visibility = "";
    const r = el.getBoundingClientRect();
    const hit = placed.some((p) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top);
    if (hit && state.labels) el.style.visibility = "hidden";
    else placed.push(r);
  });
}
map.on("zoomend moveend", () => requestAnimationFrame(declutter));
map.on("tooltipopen", (e) => { e.tooltip.getElement().style.visibility = ""; });

function buildFilters() {
  for (const r of REGIONS) {
    const c = document.createElement("span");
    c.className = "chip";
    c.innerHTML = `<span class="dot" style="background:${r.color}"></span>${r.name}`;
    c.onclick = () => {
      state.off.has(r.name) ? state.off.delete(r.name) : state.off.add(r.name);
      c.classList.toggle("off");
      render();
    };
    $("filters").appendChild(c);
  }
  $("search").oninput = (e) => { state.q = e.target.value.trim(); render(); };
  $("showLabels").onchange = (e) => { state.labels = e.target.checked; render(); };
  $("fitAll").onclick = fitRegion;
}

async function loadSchools() {
  const rows = await fetchSchools();
  state.schools = rows
    .map((row) => ({ row, region: regionOf(row) }))
    .filter((x) => x.region && x.row.REFINE_WGS84_LAT)
    .map(({ row, region }) => ({
      name: row.FACLT_NM, region, found: row.FOUND_DIV_NM || "",
      addr: row.REFINE_ROADNM_ADDR || row.REFINE_LOTNO_ADDR || "", tel: row.TELNO || "-",
      lat: +row.REFINE_WGS84_LAT, lng: +row.REFINE_WGS84_LOGT,
    }))
    .map((s) => ({ ...s, km: distKm(s.lat, s.lng) }))
    .sort((a, b) => a.km - b.km); // 가까운 순
  render();
}

// ---------- 시작 ----------
buildFilters();
loadDongs().catch((e) => console.error("읍면동 불러오기 실패", e));
loadBoundaries().catch((e) => console.error("경계 불러오기 실패", e));
loadSchools().catch((e) => {
  $("count").textContent = "학교 정보를 불러오지 못했습니다: " + e.message;
});
