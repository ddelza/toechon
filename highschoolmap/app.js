// 광주시·하남시·양평군 고등학교 지도
// - 학교: 경기데이터드림 "경기도_고등학교 현황" API (서비스명 HgschlM)
// - 배경지도: 브이월드 WMTS (키가 없으면 OpenStreetMap)
// - 행정경계: regions.geojson (통계청 2013 시군구 경계에서 세 곳만 추출)

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
let fittedOnce = false;
new ResizeObserver(() => {
  if (!fittedOnce && $("map").clientHeight > 0) { fittedOnce = true; fitRegion(); }
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
  const fc = await (await fetch("regions.geojson")).json();
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
    m.bindTooltip(s.name.replace(/고등학교$/, "고"), {
      permanent: state.labels, direction: dup ? "left" : "right", offset: [dup ? -8 : 8, 0], className: "hs-label",
    });
    m.on("mouseover", () => { const el = m.getTooltip()?.getElement(); if (el) el.style.visibility = ""; });
    m.bindPopup(`<b>${s.name}</b><br>${s.region.name} · ${s.found}<br>${s.addr}<br>☎ ${s.tel}`);

    const li = document.createElement("li");
    li.innerHTML = `<span class="ldot" style="background:${s.region.color}"></span>${s.name}<small>${s.region.name} · ${s.found}</small>`;
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
    .sort((a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || a.name.localeCompare(b.name, "ko"));
  render();
}

// ---------- 시작 ----------
buildFilters();
loadBoundaries().catch((e) => console.error("경계 불러오기 실패", e));
loadSchools().catch((e) => {
  $("count").textContent = "학교 정보를 불러오지 못했습니다: " + e.message;
});
