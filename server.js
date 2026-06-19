// Servidor principal: Express (API REST + arquivos estáticos) + Socket.io (tempo real).

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as store from "./src/store.js";
import { geocode, getRoute, lookupCep, searchPlaces, reverseGeocode } from "./src/routing.js";
import { startSimulator, snapshot, invalidate } from "./src/simulator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

store.load();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ---- Autenticação simples do admin (chave compartilhada via header) ----
function requireAdmin(req, res, next) {
  const key = req.get("x-admin-key");
  if (key !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}

app.post("/api/login", (req, res) => {
  if (req.body?.password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: "Senha incorreta." });
});

// ---- Geocodificação e rota (usados pelo admin ao criar a viagem) ----
app.get("/api/geocode", requireAdmin, async (req, res) => {
  try {
    const results = await geocode(String(req.query.q || ""), {
      category: req.query.category ? String(req.query.category) : undefined,
      city: req.query.city ? String(req.query.city) : undefined,
      uf: req.query.uf ? String(req.query.uf) : undefined,
    });
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/cep/:cep", requireAdmin, async (req, res) => {
  try {
    res.json(await lookupCep(req.params.cep));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/places", requireAdmin, async (req, res) => {
  try {
    const category = String(req.query.category || "");
    const area = String(req.query.area || "").trim();
    if (!category) return res.status(400).json({ error: "Categoria obrigatória." });
    if (!area) return res.status(400).json({ error: "Informe a cidade/área." });
    res.json(await searchPlaces(category, area));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/route", requireAdmin, async (req, res) => {
  try {
    const { origin, destination } = req.body;
    const route = await getRoute(origin, destination);
    res.json(route);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- CRUD de viagens ----
app.get("/api/trips", requireAdmin, (req, res) => {
  res.json(store.all().map(publicTrip));
});

app.post("/api/trips", requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    const route = await getRoute(b.origin, b.destination);
    const id = store.newCode();
    const trip = {
      id,
      status: "pending",
      type: b.type === "cegonha" ? "cegonha" : "guincho",
      origin: b.origin,
      destination: b.destination,
      driver: b.driver || "",
      driverPhone: b.driverPhone || "",
      plate: (b.plate || "").toUpperCase(),
      vehicle: b.vehicle || "",
      // Veículos embarcados (modelo + placa). Cegonha pode levar vários.
      vehicles: Array.isArray(b.vehicles)
        ? b.vehicles
            .map((v) => ({ model: String(v.model || "").trim(), plate: String(v.plate || "").toUpperCase().trim() }))
            .filter((v) => v.model || v.plate)
        : [],
      customer: b.customer || "",
      route,
      simElapsed: 0,
      speedFactor: Number(b.speedFactor) || 1,
      createdAt: Date.now(),
      lastTick: null,
    };
    store.save(trip);
    res.status(201).json(publicTrip(trip));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/trips/:id", (req, res) => {
  const trip = store.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada." });
  res.json(publicTrip(trip));
});

// Geocodificação reversa pública (usada pelo cliente para mostrar a localização atual).
app.get("/api/reverse", async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "Coordenadas inválidas." });
    res.json(await reverseGeocode(lat, lng));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Controles de simulação
app.post("/api/trips/:id/:action", requireAdmin, (req, res) => {
  const trip = store.get(req.params.id);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada." });
  const action = req.params.action;

  switch (action) {
    case "start":
    case "resume":
      if (trip.status === "arrived") return res.status(400).json({ error: "Viagem já finalizada. Reinicie para começar de novo." });
      trip.status = "running";
      trip.lastTick = Date.now();
      if (!trip.startedAt) trip.startedAt = Date.now();
      break;
    case "pause":
      trip.status = "paused";
      break;
    case "reset":
      trip.status = "pending";
      trip.simElapsed = 0;
      trip.lastTick = null;
      trip.startedAt = null;
      trip.arrivedAt = null;
      break;
    case "speed": {
      const f = Number(req.body?.factor);
      if (!(f > 0)) return res.status(400).json({ error: "Fator inválido." });
      trip.speedFactor = f;
      break;
    }
    default:
      return res.status(400).json({ error: "Ação desconhecida." });
  }

  store.save(trip);
  const snap = snapshot(trip);
  io.to(`trip:${trip.id}`).emit("trip:update", snap);
  io.to("admin").emit("trip:update", snap);
  res.json(publicTrip(trip));
});

app.delete("/api/trips/:id", requireAdmin, (req, res) => {
  invalidate(req.params.id);
  const ok = store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Viagem não encontrada." });
  io.to(`trip:${req.params.id}`).emit("trip:removed");
  res.json({ ok: true });
});

// Tela do cliente: "/" e "/rastrear" mostram a entrada; "/t/CODIGO" abre direto o rastreio.
const clientPage = (req, res) => res.sendFile(join(__dirname, "public", "track.html"));
app.get("/", clientPage);
app.get("/rastrear", clientPage);
app.get("/t/:id", clientPage);

// Remove dados sensíveis e anexa o snapshot atual de movimento.
function publicTrip(trip) {
  return {
    id: trip.id,
    status: trip.status,
    origin: trip.origin,
    destination: trip.destination,
    driver: trip.driver,
    driverPhone: trip.driverPhone,
    plate: trip.plate,
    vehicle: trip.vehicle,
    type: trip.type || "guincho",
    vehicles: trip.vehicles || [],
    customer: trip.customer,
    route: trip.route,
    speedFactor: trip.speedFactor,
    createdAt: trip.createdAt,
    startedAt: trip.startedAt || null,
    arrivedAt: trip.arrivedAt || null,
    snapshot: snapshot(trip),
  };
}

// ---- Tempo real ----
io.on("connection", (socket) => {
  socket.on("join", (id) => {
    socket.join(`trip:${id}`);
    const trip = store.get(id);
    if (trip) socket.emit("trip:update", snapshot(trip));
  });
  socket.on("admin:join", (key) => {
    if (key === ADMIN_PASSWORD) socket.join("admin");
  });
});

startSimulator(io);

httpServer.listen(PORT, () => {
  console.log(`\nRastreador rodando em http://localhost:${PORT}`);
  console.log(`Painel admin:  http://localhost:${PORT}/admin.html`);
  console.log(`Senha do admin: ${ADMIN_PASSWORD}\n`);
});
