export type PontoPoligono = { x: number; y: number };

export type ResultadoPontoPoligono = {
  dentro: boolean;
  na_borda: boolean;
  distancia_borda: number;
  valido: boolean;
};

function distanciaPontoSegmento(p: PontoPoligono, a: PontoPoligono, b: PontoPoligono): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

export function classificarPontoNoPoligono(
  ponto: PontoPoligono,
  poligono: PontoPoligono[],
  tolerancia = 1.5,
): ResultadoPontoPoligono {
  if (poligono.length < 3) {
    return { dentro: false, na_borda: false, distancia_borda: Number.POSITIVE_INFINITY, valido: false };
  }

  let menorDistancia = Number.POSITIVE_INFINITY;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    menorDistancia = Math.min(menorDistancia, distanciaPontoSegmento(ponto, poligono[j], poligono[i]));
  }
  const naBorda = menorDistancia <= tolerancia;
  if (naBorda) {
    return { dentro: false, na_borda: true, distancia_borda: menorDistancia, valido: true };
  }

  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i];
    const b = poligono[j];
    const cruza = (a.y > ponto.y) !== (b.y > ponto.y);
    if (!cruza) continue;
    const xIntersecao = ((b.x - a.x) * (ponto.y - a.y)) / (b.y - a.y) + a.x;
    if (ponto.x < xIntersecao) dentro = !dentro;
  }

  return { dentro, na_borda: false, distancia_borda: menorDistancia, valido: dentro };
}

export function pontoDentroOuNaBordaDoPoligono(
  ponto: PontoPoligono,
  poligono: PontoPoligono[],
  tolerancia = 1.5,
): boolean {
  return classificarPontoNoPoligono(ponto, poligono, tolerancia).valido;
}