// Armazenamento das viagens em memória com persistência em arquivo JSON.
// Mantém o estado simples: ao reiniciar o servidor as viagens são recarregadas.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "trips.json");

let trips = new Map();

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function load() {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
      trips = new Map(raw.map((t) => [t.id, t]));
    }
  } catch (err) {
    console.error("Falha ao carregar trips.json:", err.message);
  }
}

export function persist() {
  try {
    ensureDir();
    writeFileSync(DATA_FILE, JSON.stringify([...trips.values()], null, 2));
  } catch (err) {
    console.error("Falha ao salvar trips.json:", err.message);
  }
}

// Código curto e legível para o link do cliente (ex.: GX7K2Q).
export function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (trips.has(code));
  return code;
}

export const all = () => [...trips.values()];
export const get = (id) => trips.get(id);
export function save(trip) {
  trips.set(trip.id, trip);
  persist();
  return trip;
}
export function remove(id) {
  const ok = trips.delete(id);
  if (ok) persist();
  return ok;
}
