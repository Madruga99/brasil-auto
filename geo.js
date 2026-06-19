// Utilidades geográficas: distância (haversine), interpolação ao longo da rota e rumo (bearing).

const R = 6371000; // raio da Terra em metros
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

// Distância em metros entre dois pontos [lat, lng].
export function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rumo (graus 0-360, 0 = norte) de a para b.
export function bearing(a, b) {
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Recebe uma lista de pontos [lat,lng] e devolve as distâncias acumuladas.
export function cumulativeDistances(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  }
  return cum;
}

// Dado um caminho, distâncias acumuladas e uma distância-alvo, devolve
// a posição interpolada { position:[lat,lng], heading, segmentIndex }.
export function pointAtDistance(points, cum, targetDist) {
  const total = cum[cum.length - 1];
  if (targetDist <= 0) {
    return { position: points[0], heading: points[1] ? bearing(points[0], points[1]) : 0, segmentIndex: 0 };
  }
  if (targetDist >= total) {
    const n = points.length;
    return { position: points[n - 1], heading: bearing(points[n - 2], points[n - 1]), segmentIndex: n - 2 };
  }
  // localiza o segmento que contém a distância-alvo (busca linear simples)
  let i = 1;
  while (i < cum.length && cum[i] < targetDist) i++;
  const segStart = points[i - 1];
  const segEnd = points[i];
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (targetDist - cum[i - 1]) / segLen;
  const lat = segStart[0] + (segEnd[0] - segStart[0]) * t;
  const lng = segStart[1] + (segEnd[1] - segStart[1]) * t;
  return { position: [lat, lng], heading: bearing(segStart, segEnd), segmentIndex: i - 1 };
}
