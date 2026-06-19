// Cliente — Brasil Auto Rastreios: tela de entrada (código) + tela de rastreamento ao vivo.

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

let trip = null, map = null, truckMarker = null, socket = null;
let clockTimer = null, lastRevAt = 0, lastRevPos = null, currentLoc = "";

// Logos
const LOGO_DARK = `<svg width="40" height="44" viewBox="0 0 44 48" fill="none"><circle cx="22" cy="18" r="15" fill="#fff"/><path d="M22 47 L9.5 30 L34.5 30 Z" fill="#fff"/><circle cx="22" cy="18" r="6.2" fill="#072D1A"/><circle cx="22" cy="18" r="3" fill="#F2B705"/></svg>`;
const LOGO_GREEN = `<svg width="34" height="38" viewBox="0 0 44 48" fill="none"><circle cx="22" cy="18" r="15" fill="#0F7A3D"/><path d="M22 47 L9.5 30 L34.5 30 Z" fill="#0F7A3D"/><circle cx="22" cy="18" r="6.2" fill="#fff"/><circle cx="22" cy="18" r="3" fill="#F2B705"/></svg>`;
const BRAND_PIN = `<svg width="34" height="38" viewBox="0 0 44 48" fill="none" style="position:relative;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))"><circle cx="22" cy="18" r="15" fill="#0F7A3D"/><path d="M22 47 L9.5 30 L34.5 30 Z" fill="#0F7A3D"/><circle cx="22" cy="18" r="6.2" fill="#fff"/><circle cx="22" cy="18" r="3" fill="#F2B705"/></svg>`;

const codeFromUrl = location.pathname.startsWith("/t/")
  ? location.pathname.split("/t/")[1].replace(/\/+$/, "")
  : new URLSearchParams(location.search).get("id");

// ============================ ENTRY ============================
function renderEntry(errorMsg = "", prefill = "") {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  map = null; truckMarker = null;
  app.innerHTML = `
  <div class="entry">
    <div class="grid-tex"></div>
    <header>
      <div class="brand dark">${LOGO_DARK}
        <div class="name"><div class="t1">Brasil Auto <span class="g">Rastreios</span></div><div class="t2">RASTREAMENTO DE CARGAS</div></div>
      </div>
      <span class="central"><span class="d"></span><span>Central de atendimento</span></span>
    </header>
    <main>
      <div class="kicker"><span class="d"></span>ACOMPANHAMENTO 24H · COBERTURA NACIONAL</div>
      <h1>Acompanhe sua carga<br>em <span class="g">tempo real</span></h1>
      <p class="lead">Insira o código de rastreio recebido no momento da coleta e veja exatamente onde sua carga está agora.</p>
      <div class="box">
        <label>Código de rastreio</label>
        <div class="row">
          <input id="codeInput" type="text" placeholder="Ex.: ABC123" autocomplete="off" value="${esc(prefill)}" />
          <button class="btn primary" id="goBtn" style="height:54px">Rastrear →</button>
        </div>
        ${errorMsg ? `<div class="err">⚠ ${esc(errorMsg)}</div>` : ""}
        <div class="foot"><span>Não encontra o código?</span><span class="link-btn" id="helpLink">Falar com o suporte →</span></div>
      </div>
      <div class="trust">
        <div>⏱️ Atualizações em tempo real</div>
        <div>✅ Sem cadastro ou login</div>
        <div>🛡️ Dados protegidos</div>
      </div>
    </main>
  </div>`;

  const input = document.getElementById("codeInput");
  const go = () => {
    const v = (input.value || "").trim().toUpperCase();
    if (!v) return renderEntry("Digite um código de rastreio para continuar.");
    startTracking(v);
  };
  document.getElementById("goBtn").onclick = go;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  document.getElementById("helpLink").onclick = () => alert("Central de atendimento: (11) 4000-0000");
  input.focus();
}

// ============================ TRACKING ============================
async function startTracking(code) {
  try {
    const res = await fetch(`/api/trips/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error();
    trip = await res.json();
    history.replaceState(null, "", `/t/${trip.id}`);
    renderTracking();
  } catch {
    renderEntry("Código não encontrado. Verifique e tente novamente.", code);
  }
}

function renderTracking() {
  app.innerHTML = `
  <div class="track-wrap">
    <header class="track-head"><div class="inner">
      <div class="brand">${LOGO_GREEN}<div class="name"><div class="t1">Brasil Auto <span class="g">Rastreios</span></div></div></div>
      <button class="btn" id="resetBtn">↻ Nova consulta</button>
    </div></header>
    <main class="track-main">
      <div class="crumb">
        <span class="lbl">Rastreando o código</span>
        <span class="code">▦ ${esc(trip.id)}</span>
        <span class="live-badge off" id="connBadge" style="margin-left:auto"><span class="dot"></span>conectando…</span>
      </div>

      <!-- HERO -->
      <section class="hero">
        <div class="glow"></div>
        <div class="row">
          <div style="min-width:240px">
            <div class="gold-pill"><span class="d"></span>AO VIVO</div>
            <div class="slabel">Status atual</div>
            <div class="status-big" id="statusBig">—</div>
            <div class="loc">📍 <span id="heroLoc">—</span></div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0">
            <div class="eta-box">
              <div class="t">⏱ Previsão de entrega</div>
              <div class="v" id="etaDate">—</div>
              <div class="w" id="etaWindow"></div>
            </div>
            <div class="updated"><span class="d"></span>Atualizado às <span id="clock"></span></div>
          </div>
        </div>
        <div class="pbar">
          <div class="track"><div class="fill" id="pbFill" style="width:0"></div><div class="knob" id="pbKnob" style="left:0"></div></div>
          <div class="ends">
            <div><div class="cap">ORIGEM · COLETA</div><div class="pl" id="endL">—</div></div>
            <div class="mid" id="pbMid">—</div>
            <div style="text-align:right"><div class="cap">DESTINO · ENTREGA</div><div class="pl" id="endR">—</div></div>
          </div>
        </div>
      </section>

      <!-- GRID -->
      <div class="grid-mt">
        <section class="panel">
          <div class="ph"><h2>Localização no mapa</h2><span class="live-badge"><span class="dot"></span>AO VIVO</span></div>
          <div id="map"></div>
        </section>
        <section class="panel pad">
          <h2 style="margin-bottom:4px">Linha do tempo</h2>
          <p style="margin:0 0 18px;font-size:13px;color:var(--muted-2)">Movimentações da sua carga</p>
          <div id="timeline"></div>
        </section>
      </div>

      <!-- DRIVER + VEHICLES -->
      <div class="grid-mt" style="margin-top:22px">
        <section class="panel">
          <div class="cli-block" style="border-top:none">
            <div class="driver">
              <div class="avatar">👤</div>
              <div class="info"><div class="nm">${esc(trip.driver || "Motorista")}</div>
                <div class="role">${trip.type === "cegonha" ? "Cegonha" : "Guincho"}${trip.vehicle ? " · " + esc(trip.vehicle) : ""}${trip.plate ? " · " + esc(trip.plate) : ""}</div></div>
              ${trip.driverPhone ? `<a class="call" href="tel:${esc(trip.driverPhone)}" title="Ligar">📞</a>` : ""}
            </div>
          </div>
          ${trip.vehicles?.length ? `<div class="cli-block"><div class="section-label" style="margin:0 0 4px">Veículo(s) embarcado(s)</div>
            ${trip.vehicles.map((v) => `<div class="veh-chip"><span class="em">🚗</span><span class="m">${esc(v.model || "Veículo")}${v.plate ? "<small>Placa do veículo</small>" : ""}</span>${v.plate ? `<span class="plate-tag">${esc(v.plate)}</span>` : ""}</div>`).join("")}
          </div>` : ""}
        </section>
        <section class="panel pad">
          <div class="kv-list">
            <div class="cli-block" style="border-top:none;padding:0">
              <div class="section-label" style="margin:0 0 8px">Detalhes do transporte</div>
              <div style="font-size:13.5px;line-height:1.9;color:var(--muted)">
                <div><b style="color:var(--ink)">Coleta:</b> ${esc(shortAddr(trip.origin.label))}</div>
                <div><b style="color:var(--ink)">Entrega:</b> ${esc(shortAddr(trip.destination.label))}</div>
                ${trip.customer ? `<div><b style="color:var(--ink)">Cliente:</b> ${esc(trip.customer)}</div>` : ""}
                <div><b style="color:var(--ink)">Distância:</b> ${(trip.route.distance / 1000).toFixed(1)} km</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="help">
        <div class="l"><div class="ic">💬</div><div><div class="tt">Alguma divergência no rastreio?</div><div class="ds">Nossa equipe de logística responde em minutos.</div></div></div>
        <button class="btn primary" onclick="alert('Central: (11) 4000-0000')">Falar com suporte</button>
      </div>
    </main>
  </div>`;

  document.getElementById("resetBtn").onclick = () => { if (socket) socket.disconnect(); renderEntry(); };

  initMap();
  fillEndpoints();
  applySnapshot(trip.snapshot);
  connect();
  clockTimer = setInterval(() => { const c = document.getElementById("clock"); if (c) c.textContent = nowClock(); }, 1000);
}

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([-23.55, -46.63], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
  const routeLine = L.polyline(trip.route.points, { color: "#0F7A3D", weight: 5, opacity: .9 }).addTo(map);
  L.marker([trip.origin.lat, trip.origin.lng], { icon: dotIcon(true) }).addTo(map).bindPopup("Coleta");
  L.marker([trip.destination.lat, trip.destination.lng], { icon: dotIcon(false) }).addTo(map).bindPopup("Entrega");
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
  setTimeout(() => map && map.invalidateSize(), 200);
}

const dotIcon = (filled) => L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8],
  html: filled ? `<div style="width:14px;height:14px;border-radius:50%;background:#0B3D22;border:2px solid #fff;box-shadow:0 0 0 1.5px #0B3D22"></div>`
               : `<div style="width:14px;height:14px;border-radius:50%;background:#fff;border:2.5px solid #8A968D"></div>` });
const truckIcon = () => L.divIcon({ className: "", iconSize: [40, 44], iconAnchor: [20, 42], html: `<div class="dc-pin"><div class="radar"></div>${BRAND_PIN}</div>` });

// Preenche origem/destino por extenso (cidade/UF) via reverse geocode.
async function fillEndpoints() {
  try {
    const [o, d] = await Promise.all([
      fetch(`/api/reverse?lat=${trip.origin.lat}&lng=${trip.origin.lng}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/reverse?lat=${trip.destination.lat}&lng=${trip.destination.lng}`).then((r) => r.json()).catch(() => null),
    ]);
    const L_ = document.getElementById("endL"), R_ = document.getElementById("endR");
    if (L_ && o) L_.textContent = endLabel(o) || shortAddr(trip.origin.label);
    else if (L_) L_.textContent = shortAddr(trip.origin.label);
    if (R_ && d) R_.textContent = endLabel(d) || shortAddr(trip.destination.label);
    else if (R_) R_.textContent = shortAddr(trip.destination.label);
  } catch {}
}
const endLabel = (r) => [r.cidade, r.uf].filter(Boolean).join("/");

// ============================ ATUALIZAÇÃO AO VIVO ============================
function applySnapshot(s) {
  if (!s || !map) return;
  if (s.position) {
    if (!truckMarker) truckMarker = L.marker(s.position, { icon: truckIcon(), zIndexOffset: 1000 }).addTo(map);
    else truckMarker.setLatLng(s.position);
  }

  setText("statusBig", statusBig(s.status));
  const pct = Math.round(s.progress * 100);
  styleWidth("pbFill", pct + "%");
  const knob = document.getElementById("pbKnob"); if (knob) knob.style.left = pct + "%";
  setText("pbMid", s.status === "arrived" ? "Trajeto concluído" : `${pct}% concluído · ~${(s.remainingDist / 1000).toFixed(0)} km restantes`);

  // Previsão de entrega (tempo real considerando a velocidade da simulação)
  const realRemaining = s.etaSeconds / (trip.speedFactor || 1);
  updateEta(s.status, realRemaining);

  // Localização por extenso (throttled)
  if (s.status === "arrived") { currentLoc = endText("R") || shortAddr(trip.destination.label); setText("heroLoc", currentLoc); }
  else if (s.status === "pending") { currentLoc = endText("L") || shortAddr(trip.origin.label); setText("heroLoc", "Aguardando coleta em " + currentLoc); }
  else maybeReverse(s.position);

  renderTimeline(s);
}

function maybeReverse(pos) {
  if (!pos) return;
  const now = Date.now();
  const moved = !lastRevPos || Math.abs(pos[0] - lastRevPos[0]) + Math.abs(pos[1] - lastRevPos[1]) > 0.0015;
  if (now - lastRevAt < 12000 || !moved) { if (currentLoc) setText("heroLoc", currentLoc); return; }
  lastRevAt = now; lastRevPos = pos;
  fetch(`/api/reverse?lat=${pos[0]}&lng=${pos[1]}`).then((r) => r.json()).then((r) => {
    currentLoc = r.label || currentLoc;
    setText("heroLoc", currentLoc);
    renderTimeline(trip.snapshot);
  }).catch(() => {});
}

function updateEta(status, realRemainingSec) {
  if (status === "arrived") { setText("etaDate", "Entregue"); setText("etaWindow", trip.arrivedAt ? fmtStamp(trip.arrivedAt) : "concluído"); return; }
  if (status === "pending") { setText("etaDate", "A definir"); setText("etaWindow", "aguardando coleta"); return; }
  const arr = new Date(Date.now() + realRemainingSec * 1000);
  setText("etaDate", dayLabel(arr));
  setText("etaWindow", "às " + hhmm(arr) + (status === "paused" ? " (parado)" : ""));
}

function renderTimeline(s) {
  const box = document.getElementById("timeline"); if (!box) return;
  const oCity = endText("L") || shortAddr(trip.origin.label);
  const dCity = endText("R") || shortAddr(trip.destination.label);
  const ev = [];

  if (s.status === "arrived") {
    ev.push(item(true, "✓", "Carga entregue", dCity, fmtStamp(trip.arrivedAt), false));
    ev.push(item(true, "✓", "Em trânsito", currentLoc || "Rota concluída", "", false));
    ev.push(item(true, "✓", "Saída da origem", oCity, fmtStamp(trip.startedAt), false));
    ev.push(item(true, "✓", "Pedido registrado", "Brasil Auto Rastreios", fmtStamp(trip.createdAt), true));
  } else if (s.status === "running" || s.status === "paused") {
    ev.push(item(true, "", s.status === "paused" ? "Parado momentaneamente" : "Em trânsito", currentLoc || "A caminho do destino", nowClock(), false, s.status === "running"));
    ev.push(item(true, "✓", "Saída da origem", oCity, fmtStamp(trip.startedAt), false));
    ev.push(item(true, "✓", "Pedido registrado", "Brasil Auto Rastreios", fmtStamp(trip.createdAt), true));
  } else {
    ev.push(item(false, "", "Aguardando coleta", oCity, "Em breve", false));
    ev.push(item(true, "✓", "Pedido registrado", "Brasil Auto Rastreios", fmtStamp(trip.createdAt), true));
  }
  box.innerHTML = ev.join("");
}

function item(done, mark, title, place, time, last, live) {
  const dotCls = !done ? "tl-dot future" : live ? "tl-dot live" : "tl-dot";
  return `<div class="tl-event">
    <div class="tl-rail"><div class="${dotCls}">${mark || ""}</div>${last ? "" : '<div class="tl-line"></div>'}</div>
    <div class="tl-body${last ? " last" : ""}">
      <div class="tl-title"><span class="tt">${esc(title)}</span>${live ? '<span class="now">AGORA</span>' : ""}</div>
      <div class="tl-place">${esc(place)}</div>
      ${time ? `<div class="tl-time">${esc(time)}</div>` : ""}
    </div>
  </div>`;
}

// ============================ SOCKET ============================
function connect() {
  socket = io();
  socket.on("connect", () => { socket.emit("join", trip.id); setBadge(true); });
  socket.on("disconnect", () => setBadge(false));
  socket.on("trip:update", applySnapshot);
  socket.on("trip:removed", () => { app.innerHTML = `<div class="track-wrap"><div class="client-status">Esta viagem foi encerrada.</div></div>`; });
}
function setBadge(on) {
  const b = document.getElementById("connBadge"); if (!b) return;
  b.className = "live-badge" + (on ? "" : " off"); b.style.marginLeft = "auto";
  b.innerHTML = `<span class="dot"></span>${on ? "AO VIVO" : "OFFLINE"}`;
}

// ============================ UTILS ============================
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function styleWidth(id, w) { const el = document.getElementById(id); if (el) el.style.width = w; }
function endText(side) { const el = document.getElementById(side === "L" ? "endL" : "endR"); const t = el && el.textContent; return t && t !== "—" ? t : ""; }
function statusBig(s) { return { pending: "Aguardando coleta", running: "Em trânsito", paused: "Parado", arrived: "Entregue" }[s] || "—"; }
function shortAddr(a) { return a ? a.split(",").slice(0, 3).join(", ") : "—"; }
function nowClock() { return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function hhmm(d) { return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function dayLabel(d) {
  const today = new Date(), tom = new Date(); tom.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === tom.toDateString()) return "Amanhã";
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}
function fmtStamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const day = dayLabel(d);
  return (day === "Hoje" || day === "Amanhã") ? `${day}, ${hhmm(d)}` : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}, ${hhmm(d)}`;
}

// ============================ INÍCIO ============================
if (codeFromUrl) startTracking(codeFromUrl.toUpperCase());
else renderEntry();
