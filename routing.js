// Integração com serviços gratuitos do OpenStreetMap e dos Correios:
//  - Nominatim para geocodificação (endereço/comércio -> coordenadas)
//  - ViaCEP para busca por CEP
//  - OSRM para rota, geometria, distância e tempo estimado.

const NOMINATIM = "https://nominatim.openstreetmap.org";
const VIACEP = "https://viacep.com.br/ws";
const OSRM = "https://router.project-osrm.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "RastreadorGuincho/1.0 (sistema de demonstracao)";

// Mapeia categorias de comércio para etiquetas (tags) do OpenStreetMap,
// usadas na busca por tipo de local via Overpass.
const OSM_TAGS = {
  posto: ["[amenity=fuel]"],
  oficina: ["[shop=car_repair]"],
  funilaria: ["[shop=car_repair]"],
  concessionaria: ["[shop=car]"],
  estacionamento: ["[amenity=parking]"],
  borracharia: ["[shop=tyres]"],
  shopping: ["[shop=mall]"],
  hospital: ["[amenity=hospital]"],
  hotel: ["[tourism=hotel]"],
  restaurante: ["[amenity=restaurant]"],
  posto_policia: ["[amenity=police]"],
  // "guincho" não tem etiqueta própria no OSM -> usa busca textual (fallback).
};

// Categorias de comércio -> termo adicionado à busca para filtrar o tipo de local.
export const CATEGORIES = {
  posto: "posto de combustível",
  oficina: "oficina mecânica",
  guincho: "guincho reboque",
  funilaria: "funilaria",
  concessionaria: "concessionária de veículos",
  estacionamento: "estacionamento",
  borracharia: "borracharia",
  shopping: "shopping center",
  hospital: "hospital",
  hotel: "hotel",
  restaurante: "restaurante",
  posto_policia: "delegacia",
};

// Monta o objeto de resultado padrão a partir de um item do Nominatim.
function mapResult(d) {
  const a = d.address || {};
  const cidade = a.city || a.town || a.village || a.municipality || "";
  return {
    label: d.display_name,
    name: d.name || (d.display_name || "").split(",")[0],
    lat: Number(d.lat),
    lng: Number(d.lon),
    cep: a.postcode || "",
    cidade,
    uf: a.state || "",
    tipo: d.type || d.category || "",
  };
}

// Busca avançada de endereços e comércios.
// opts: { category, city, uf, limit }
export async function geocode(query, opts = {}) {
  let q = (query || "").trim();
  if (opts.category && CATEGORIES[opts.category]) {
    q = `${q} ${CATEGORIES[opts.category]}`.trim();
  }
  if (opts.city) q += `, ${opts.city}`;
  if (opts.uf) q += `, ${opts.uf}`;
  if (!q) return [];

  const params = new URLSearchParams({
    format: "jsonv2",
    limit: String(opts.limit || 8),
    "accept-language": "pt-BR",
    countrycodes: "br",
    addressdetails: "1",
    q,
  });
  const res = await fetch(`${NOMINATIM}/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);
  const data = await res.json();
  return data.map(mapResult);
}

// Obtém a caixa delimitadora (bounding box) de uma cidade/área pelo Nominatim.
async function areaBBox(area) {
  const params = new URLSearchParams({
    format: "jsonv2", limit: "1", countrycodes: "br", "accept-language": "pt-BR", q: area,
  });
  const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);
  const data = await res.json();
  if (!data.length || !data[0].boundingbox) return null;
  // boundingbox do Nominatim: [sul, norte, oeste, leste]
  const bb = data[0].boundingbox.map(Number);
  return { s: bb[0], n: bb[1], w: bb[2], e: bb[3] };
}

// Busca comércios/locais de uma categoria dentro de uma cidade/área (via Overpass).
// Para categorias sem etiqueta no OSM, faz busca textual.
export async function searchPlaces(category, area) {
  const tags = OSM_TAGS[category];
  if (!tags) {
    const term = CATEGORIES[category] || "";
    return geocode(`${term} ${area}`.trim());
  }
  const box = await areaBBox(area);
  if (!box) throw new Error("Cidade/área não encontrada. Tente ser mais específico.");

  const bbox = `${box.s},${box.w},${box.n},${box.e}`;
  const clauses = tags.map((t) => `node${t}(${bbox});way${t}(${bbox});`).join("");
  const query = `[out:json][timeout:25];(${clauses});out center 40;`;

  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "text/plain" },
    body: query,
  });
  if (!res.ok) throw new Error(`Overpass respondeu ${res.status}`);
  const data = await res.json();

  const seen = new Set();
  const results = [];
  for (const el of data.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const t = el.tags || {};
    const name = t.name || t.brand || (CATEGORIES[category] || "Local");
    const addr = [t["addr:street"], t["addr:housenumber"], t["addr:suburb"], t["addr:city"]]
      .filter(Boolean).join(", ");
    const key = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      label: addr ? `${name} — ${addr}` : name,
      name,
      lat, lng,
      cep: t["addr:postcode"] || "",
      cidade: t["addr:city"] || "",
      uf: "",
      tipo: category,
    });
    if (results.length >= 25) break;
  }
  return results;
}

// Geocodificação reversa: coordenada -> endereço por extenso (rua · cidade/UF).
export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    format: "jsonv2", lat: String(lat), lon: String(lng),
    "accept-language": "pt-BR", zoom: "16",
  });
  const res = await fetch(`${NOMINATIM}/reverse?${params}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);
  const d = await res.json();
  const a = d.address || {};
  const via = a.road || a.pedestrian || a.neighbourhood || a.suburb || "";
  const cidade = a.city || a.town || a.village || a.municipality || a.county || "";
  const uf = a.state_code || a.state || "";
  const place = [via, a.suburb && a.suburb !== via ? a.suburb : null].filter(Boolean).join(", ");
  const cityUf = [cidade, uf].filter(Boolean).join("/");
  return { label: [place, cityUf].filter(Boolean).join(" · ") || d.display_name || "Em rota", cidade, uf };
}

// Normaliza o CEP para 8 dígitos.
export function normalizeCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

// Busca um endereço a partir do CEP (ViaCEP) e geocodifica para obter lat/lng.
// Devolve { label, lat, lng, cep, logradouro, bairro, cidade, uf }.
export async function lookupCep(rawCep) {
  const cep = normalizeCep(rawCep);
  if (cep.length !== 8) throw new Error("CEP deve ter 8 dígitos.");

  const res = await fetch(`${VIACEP}/${cep}/json/`);
  if (!res.ok) throw new Error(`ViaCEP respondeu ${res.status}`);
  const v = await res.json();
  if (v.erro) throw new Error("CEP não encontrado.");

  // Monta a melhor consulta possível para o Nominatim resolver as coordenadas.
  const parts = [v.logradouro, v.bairro, v.localidade, v.uf].filter(Boolean);
  let coords = { lat: null, lng: null, label: "" };
  const geo = await geocode(parts.join(", "));
  if (geo.length) coords = geo[0];

  const label = parts.length ? `${parts.join(", ")} — ${cep}` : `${v.localidade}/${v.uf} — ${cep}`;
  return {
    label,
    lat: coords.lat,
    lng: coords.lng,
    cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
    logradouro: v.logradouro || "",
    bairro: v.bairro || "",
    cidade: v.localidade || "",
    uf: v.uf || "",
    found: coords.lat != null,
  };
}

// Calcula a rota dirigível entre origem e destino (cada um { lat, lng }).
// Devolve { points:[[lat,lng]...], distance(m), duration(s) }.
export async function getRoute(origin, destination) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`OSRM respondeu ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("Não foi possível traçar uma rota entre os pontos.");
  }
  const route = data.routes[0];
  // OSRM devolve [lng, lat]; convertemos para [lat, lng] usado pelo Leaflet.
  const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  return { points, distance: route.distance, duration: route.duration };
}
