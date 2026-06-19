// Painel do administrador: cria viagens, controla a simulação e acompanha ao vivo.

const $ = (id) => document.getElementById(id);
let adminKey = localStorage.getItem("adminKey") || "";
let socket = null;
let trips = [];
let selectedId = null;
let currentType = "guincho";

const sel = { origin: null, destination: null };
const TRUCK_EMOJI = { guincho: "🚚", cegonha: "🚛" };

// ---------- Mapa ----------
const map = L.map("map", { zoomControl: true }).setView([-23.55, -46.63], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap", maxZoom: 19,
}).addTo(map);

let routeLine, truckMarker, truckMarkerType, oMarker, dMarker;
const BRAND_PIN = `<svg width="34" height="38" viewBox="0 0 44 48" fill="none" style="position:relative;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))"><circle cx="22" cy="18" r="15" fill="#0F7A3D"/><path d="M22 47 L9.5 30 L34.5 30 Z" fill="#0F7A3D"/><circle cx="22" cy="18" r="6.2" fill="#fff"/><circle cx="22" cy="18" r="3" fill="#F2B705"/></svg>`;
const dotIcon = (filled) =>
  L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8],
    html: filled
      ? `<div style="width:14px;height:14px;border-radius:50%;background:#0B3D22;border:2px solid #fff;box-shadow:0 0 0 1.5px #0B3D22"></div>`
      : `<div style="width:14px;height:14px;border-radius:50%;background:#fff;border:2.5px solid #8A968D"></div>` });
const truckIcon = () =>
  L.divIcon({ className: "", iconSize: [40, 44], iconAnchor: [20, 42],
    html: `<div class="dc-pin"><div class="radar"></div>${BRAND_PIN}</div>` });

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey, ...(opts.headers || {}) },
  });
  if (res.status === 401) { showLogin(); throw new Error("Não autorizado"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro na requisição");
  return data;
}

// ---------- Login ----------
function showLogin() { $("login").style.display = "flex"; }
function hideLogin() { $("login").style.display = "none"; }

$("loginBtn").onclick = async () => {
  const pass = $("loginPass").value;
  try {
    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) throw new Error();
    adminKey = pass;
    localStorage.setItem("adminKey", pass);
    hideLogin();
    init();
  } catch { $("loginErr").style.display = "block"; }
};
$("loginPass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });
$("logoutBtn").onclick = () => { localStorage.removeItem("adminKey"); location.reload(); };

// ---------- Tipo de transporte ----------
function setupTypeToggle() {
  $("typeToggle").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      $("typeToggle").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      currentType = b.dataset.type;
      $("vehHint").textContent = currentType === "cegonha" ? "· pode levar vários" : "· normalmente 1";
    };
  });
  $("vehHint").textContent = "· normalmente 1";
}

// ---------- Veículos embarcados (repetidor) ----------
function addVehRow(model = "", plate = "") {
  const row = document.createElement("div");
  row.className = "veh-row";
  row.innerHTML = `
    <input class="veh-model" placeholder="Modelo/cor (ex.: Civic prata)" value="${escAttr(model)}" />
    <input class="veh-plate plate" placeholder="Placa" maxlength="8" value="${escAttr(plate)}" />
    <button type="button" class="rm" title="Remover">✕</button>`;
  row.querySelector(".rm").onclick = () => {
    row.remove();
    if (!$("vehList").children.length) addVehRow();
  };
  $("vehList").appendChild(row);
}
function readVehicles() {
  return [...$("vehList").querySelectorAll(".veh-row")]
    .map((r) => ({ model: r.querySelector(".veh-model").value.trim(), plate: r.querySelector(".veh-plate").value.trim() }))
    .filter((v) => v.model || v.plate);
}
function resetVehicles() { $("vehList").innerHTML = ""; addVehRow(); }

// ---------- Busca avançada (endereço / CEP / comércio) ----------
const CATEGORY_OPTIONS = [
  ["", "Todas as categorias"],
  ["posto", "⛽ Posto de combustível"], ["oficina", "🔧 Oficina mecânica"],
  ["guincho", "🚛 Guincho / reboque"], ["funilaria", "🔨 Funilaria"],
  ["concessionaria", "🚗 Concessionária"], ["estacionamento", "🅿️ Estacionamento"],
  ["borracharia", "🛞 Borracharia"], ["shopping", "🏬 Shopping"],
  ["hospital", "🏥 Hospital"], ["hotel", "🏨 Hotel"],
  ["restaurante", "🍽️ Restaurante"], ["posto_policia", "🚓 Delegacia"],
];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const escAttr = (s) => esc(s);
const isCep = (v) => /^\d{5}-?\d{3}$/.test(v.trim());

function populateCategories() {
  const opts = CATEGORY_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  ["originCategory", "destCategory"].forEach((id) => ($(id).innerHTML = opts));
}

function setupAutocomplete(prefix, field) {
  const input = $(`${prefix}Input`);
  const box = $(`${prefix}Sug`);
  let timer;

  const pick = (r) => {
    input.value = r.label;
    sel[field] = { lat: r.lat, lng: r.lng, label: r.label };
    box.classList.remove("open");
    previewRoute();
  };
  const showInfo = (msg) => { box.innerHTML = `<div class="sug info">${esc(msg)}</div>`; box.classList.add("open"); };
  const renderResults = (results, emptyMsg) => {
    if (!results.length) return showInfo(emptyMsg);
    box.innerHTML = "";
    results.forEach((r) => {
      if (r.lat == null || r.lng == null) return;
      const div = document.createElement("div");
      div.className = "sug";
      div.innerHTML = `<span class="nm">${esc(r.name)}${r.cep ? `<span class="cepbadge">${esc(r.cep)}</span>` : ""}</span>` +
        `<span class="ad">${esc(r.label)}</span>`;
      div.onclick = () => pick(r);
      box.appendChild(div);
    });
    box.classList.add("open");
  };

  async function searchCep(raw) {
    showInfo("Buscando CEP…");
    try {
      const r = await api(`/api/cep/${raw.replace(/\D/g, "")}`);
      if (!r.found) return showInfo(`CEP ${r.cep} (${r.cidade}/${r.uf}) — não localizado no mapa. Refine o endereço.`);
      box.innerHTML = "";
      const div = document.createElement("div");
      div.className = "sug";
      div.innerHTML = `<span class="nm">${esc(r.logradouro || r.cidade)}<span class="cepbadge">${r.cep}</span></span>` +
        `<span class="ad">${esc([r.bairro, r.cidade, r.uf].filter(Boolean).join(", "))}</span>`;
      div.onclick = () => pick(r);
      box.appendChild(div);
      box.classList.add("open");
    } catch (err) { showInfo(err.message); }
  }
  async function searchText(raw) {
    const params = new URLSearchParams({ q: raw });
    const city = $(`${prefix}City`).value.trim();
    const uf = $(`${prefix}Uf`).value.trim();
    if (city) params.set("city", city);
    if (uf) params.set("uf", uf);
    try { renderResults(await api(`/api/geocode?${params}`), "Nenhum resultado para esses filtros."); } catch {}
  }
  async function searchCategory(cat) {
    const city = $(`${prefix}City`).value.trim();
    const uf = $(`${prefix}Uf`).value.trim();
    const raw = input.value.trim();
    const area = city ? `${city}${uf ? " " + uf : ""}` : raw;
    if (area.length < 3) return showInfo("Digite a cidade (nos filtros ou na busca) para listar os comércios.");
    showInfo("Buscando comércios…");
    try {
      renderResults(await api(`/api/places?category=${encodeURIComponent(cat)}&area=${encodeURIComponent(area)}`),
        "Nenhum comércio dessa categoria encontrado na área.");
    } catch (err) { showInfo(err.message); }
  }

  const run = () => {
    const raw = input.value.trim();
    const cat = $(`${prefix}Category`).value;
    if (isCep(raw)) return searchCep(raw);
    if (cat) return searchCategory(cat);
    if (raw.length < 3) { box.classList.remove("open"); return; }
    searchText(raw);
  };

  input.addEventListener("input", () => { sel[field] = null; clearTimeout(timer); timer = setTimeout(run, 500); });
  $(`${prefix}Category`).addEventListener("change", run);
  $(`${prefix}City`).addEventListener("change", () => { if ($(`${prefix}Category`).value) run(); });
  document.addEventListener("click", (e) => { if (!box.contains(e.target) && e.target !== input) box.classList.remove("open"); });
}

async function previewRoute() {
  if (!sel.origin || !sel.destination) return;
  try {
    const route = await api("/api/route", { method: "POST", body: JSON.stringify({ origin: sel.origin, destination: sel.destination }) });
    drawRoute(route, sel.origin, sel.destination);
    $("rcDist").textContent = (route.distance / 1000).toFixed(1) + " km";
    $("rcTime").textContent = fmtDur(route.duration);
    $("routeChip").classList.add("show");
  } catch { $("routeChip").classList.remove("show"); }
}

function drawRoute(route, origin, destination) {
  [routeLine, oMarker, dMarker, truckMarker].forEach((l) => l && map.removeLayer(l));
  truckMarker = null;
  routeLine = L.polyline(route.points, { color: "#0F7A3D", weight: 5, opacity: .9 }).addTo(map);
  oMarker = L.marker([origin.lat, origin.lng], { icon: dotIcon(true) }).addTo(map).bindPopup("Coleta");
  dMarker = L.marker([destination.lat, destination.lng], { icon: dotIcon(false) }).addTo(map).bindPopup("Entrega");
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
}

// ---------- Criar viagem ----------
$("createBtn").onclick = async () => {
  if (!sel.origin || !sel.destination) { alert("Selecione origem e destino a partir das sugestões."); return; }
  $("createBtn").disabled = true;
  try {
    const body = {
      type: currentType,
      origin: sel.origin, destination: sel.destination,
      driver: $("driver").value, driverPhone: $("driverPhone").value,
      plate: $("plate").value, vehicle: $("vehicle").value,
      vehicles: readVehicles(),
      customer: $("customer").value,
      speedFactor: $("speedFactor").value,
    };
    await api("/api/trips", { method: "POST", body: JSON.stringify(body) });
    ["originInput", "destInput", "driver", "driverPhone", "plate", "vehicle", "customer"].forEach((i) => ($(i).value = ""));
    sel.origin = sel.destination = null;
    resetVehicles();
    $("routeChip").classList.remove("show");
    await loadTrips();
  } catch (err) { alert("Erro ao criar viagem: " + err.message); }
  finally { $("createBtn").disabled = false; }
};

// ---------- Lista de viagens ----------
async function loadTrips() {
  trips = await api("/api/trips");
  renderTrips();
}

function vehiclesSummary(t) {
  if (!t.vehicles?.length) return '<span class="muted">sem veículo</span>';
  return t.vehicles.map((v) => `<span class="plate-tag">${esc(v.plate || v.model)}</span>`).join(" ");
}

function renderTrips() {
  const box = $("tripList");
  $("tripCount").textContent = trips.length ? `${trips.length} ativa(s)` : "";
  if (!trips.length) { box.innerHTML = '<div class="empty"><span class="em">🗺️</span>Nenhuma viagem ainda.<br>Crie a primeira acima.</div>'; return; }
  box.innerHTML = "";
  trips.sort((a, b) => b.createdAt - a.createdAt).forEach((t) => box.appendChild(tripCard(t)));
}

function tripCard(t) {
  const s = t.snapshot;
  const el = document.createElement("div");
  el.className = "trip" + (t.id === selectedId ? " selected" : "");
  el.dataset.id = t.id;
  const link = `${location.origin}/t/${t.id}`;
  el.innerHTML = `
    <div class="top">
      <span class="type-ic">${TRUCK_EMOJI[t.type] || "🚚"}</span>
      <span class="code">${t.id}</span>
      <span class="status ${s.status}" data-status>${statusLabel(s.status)}</span>
      <span class="km">${(t.route.distance / 1000).toFixed(1)} km</span>
    </div>
    <div class="route-line">${esc(shortName(t.origin.label))} <span class="arr">→</span> ${esc(shortName(t.destination.label))}</div>
    <div class="sub"><span>👤 ${esc(t.driver || "—")}</span> ${vehiclesSummary(t)}</div>
    <div class="progress"><span data-bar style="width:${(s.progress * 100).toFixed(1)}%"></span></div>
    <div class="eta" data-eta>Chega em ~${fmtDur(s.etaSeconds)} · faltam ${(s.remainingDist / 1000).toFixed(1)} km</div>
    <div class="linkrow"><span class="link">${link}</span><button class="btn icon sm" data-copy title="Copiar link">📋</button></div>
    <div class="controls">
      <button class="btn sm green" data-act="${s.status === 'running' ? 'pause' : 'start'}">${s.status === 'running' ? '⏸ Pausar' : '▶ Iniciar'}</button>
      <button class="btn sm ghost" data-act="reset">↺ Reiniciar</button>
      <select data-speed>${[1, 5, 10, 30, 60].map((v) => `<option value="${v}" ${t.speedFactor == v ? 'selected' : ''}>${v}×</option>`).join("")}</select>
      <button class="btn sm danger" data-act="delete" title="Excluir">🗑</button>
    </div>`;

  el.querySelector("[data-copy]").onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(link);
    e.target.textContent = "✓";
    setTimeout(() => (e.target.textContent = "📋"), 1200);
  };
  el.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      try {
        if (act === "delete") { if (!confirm("Excluir esta viagem?")) return; await api(`/api/trips/${t.id}`, { method: "DELETE" }); }
        else await api(`/api/trips/${t.id}/${act}`, { method: "POST" });
        await loadTrips();
      } catch (err) { alert(err.message); }
    };
  });
  el.querySelector("[data-speed]").onclick = (e) => e.stopPropagation();
  el.querySelector("[data-speed]").onchange = async (e) => {
    e.stopPropagation();
    try { await api(`/api/trips/${t.id}/speed`, { method: "POST", body: JSON.stringify({ factor: Number(e.target.value) }) }); }
    catch (err) { alert(err.message); }
  };
  el.onclick = () => selectTrip(t.id);
  return el;
}

function selectTrip(id) {
  selectedId = id;
  renderTrips();
  const t = trips.find((x) => x.id === id);
  if (!t) return;
  drawRoute(t.route, t.origin, t.destination);
  truckMarkerType = t.type;
  updateTruck(t.snapshot);
}

function updateTruck(s) {
  if (!s.position) return;
  if (!truckMarker) truckMarker = L.marker(s.position, { icon: truckIcon(), zIndexOffset: 1000 }).addTo(map);
  else truckMarker.setLatLng(s.position);
}

// ---------- Tempo real ----------
function connect() {
  socket = io();
  socket.on("connect", () => { socket.emit("admin:join", adminKey); setBadge(true); });
  socket.on("disconnect", () => setBadge(false));
  socket.on("trip:update", (s) => {
    const t = trips.find((x) => x.id === s.id);
    if (t) t.snapshot = s;
    const card = document.querySelector(`.trip[data-id="${s.id}"]`);
    if (card) {
      card.querySelector("[data-bar]").style.width = (s.progress * 100).toFixed(1) + "%";
      card.querySelector("[data-eta]").textContent = `Chega em ~${fmtDur(s.etaSeconds)} · faltam ${(s.remainingDist / 1000).toFixed(1)} km`;
      const st = card.querySelector("[data-status]");
      st.textContent = statusLabel(s.status);
      st.className = "status " + s.status;
    }
    if (s.id === selectedId) updateTruck(s);
  });
}
function setBadge(on) {
  const b = $("connBadge");
  b.className = "live-badge" + (on ? "" : " off");
  b.innerHTML = `<span class="dot"></span>${on ? "AO VIVO" : "OFFLINE"}`;
}

// ---------- Utilidades ----------
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m} min`;
  return `${sec}s`;
}
function statusLabel(s) { return { pending: "Aguardando", running: "Em rota", paused: "Pausado", arrived: "Entregue" }[s] || s; }
function shortName(a) { return a ? a.split(",")[0] : "—"; }

// ---------- Início ----------
async function init() {
  try {
    populateCategories();
    setupTypeToggle();
    resetVehicles();
    $("addVeh").onclick = () => addVehRow();
    document.querySelectorAll("[data-toggle]").forEach((btn) => { btn.onclick = () => $(btn.dataset.toggle).classList.toggle("open"); });
    await loadTrips();
    connect();
    setupAutocomplete("origin", "origin");
    setupAutocomplete("dest", "destination");
  } catch (err) { if (err.message !== "Não autorizado") console.error(err); }
}

if (adminKey) { hideLogin(); init(); } else { showLogin(); }
