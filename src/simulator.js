// Motor de simulação: o servidor é a autoridade. A cada "tick" avança a
// posição das viagens em andamento ao longo da rota real do OSRM e
// transmite a atualização para todos os clientes conectados àquela viagem.

import { all, save } from "./store.js";
import { cumulativeDistances, pointAtDistance } from "./geo.js";

const TICK_MS = 1000;

// Cache em memória das distâncias acumuladas por viagem (não persiste).
const cumCache = new Map();

function getCum(trip) {
  if (!cumCache.has(trip.id)) {
    cumCache.set(trip.id, cumulativeDistances(trip.route.points));
  }
  return cumCache.get(trip.id);
}

export function invalidate(id) {
  cumCache.delete(id);
}

// Calcula o estado atual de movimento de uma viagem (sem efeitos colaterais).
export function snapshot(trip) {
  const total = trip.route.distance;
  const cum = getCum(trip);
  const targetDist = Math.min(total, (trip.simElapsed / trip.route.duration) * total);
  const { position, heading } = pointAtDistance(trip.route.points, cum, targetDist);
  const remainingDist = Math.max(0, total - targetDist);
  const etaSeconds = Math.max(0, Math.round(trip.route.duration - trip.simElapsed));
  const progress = total > 0 ? Math.min(1, targetDist / total) : 0;
  return {
    id: trip.id,
    status: trip.status,
    position,
    heading,
    remainingDist,
    etaSeconds,
    progress,
    speedFactor: trip.speedFactor,
    traveledDist: targetDist,
  };
}

export function startSimulator(io) {
  setInterval(() => {
    const now = Date.now();
    for (const trip of all()) {
      if (trip.status !== "running") continue;

      const dt = (now - (trip.lastTick || now)) / 1000; // segundos reais
      trip.lastTick = now;
      trip.simElapsed += dt * trip.speedFactor;

      let changed = false;
      if (trip.simElapsed >= trip.route.duration) {
        trip.simElapsed = trip.route.duration;
        trip.status = "arrived";
        trip.arrivedAt = now;
        changed = true;
      }

      const snap = snapshot(trip);
      io.to(`trip:${trip.id}`).emit("trip:update", snap);
      io.to("admin").emit("trip:update", snap);

      // Persiste de tempos em tempos (a cada ~5s) e ao chegar, para não
      // gravar em disco a cada segundo.
      if (changed || Math.floor(trip.simElapsed) % 5 === 0) {
        save(trip);
      }
    }
  }, TICK_MS);
}
