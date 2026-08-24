import type { RolPresupuesto } from "../presupuesto/franjas";

/** Candidato con los datos reales del catálogo ya resueltos — lo que el
 * rerank y el ensamblaje necesitan, a diferencia de `ResultadoRetrieval`
 * (que sólo tiene ids y scores). */
export type CandidatoDetallado = {
  rol: RolPresupuesto;
  productId: string;
  variantId: string;
  titulo: string;
  categoria: string | null;
  colores: string[];
  ocasiones: string[];
  acabados: string[];
  disponible: boolean;
  imagen: string | null;
  precio: number;
  inventario: number | null;
  sku: string | null;
  /** `finalScore` de la fusión RRF (retrieval/search.ts) — `Infinity` en un
   * match exacto de SKU. */
  rankRrf: number;
};

export type CandidatoPuntuado = CandidatoDetallado & {
  score: number;
  /** Frases explicables del score (§3, Etapa 3a) — se le pueden mostrar al
   * cliente tal cual ("lo elegí porque..."), no son telemetría interna. */
  porque: string[];
};

export type ContextoRerank = {
  topeCop: number;
  coloresPedidos: readonly string[];
  ocasionesPedidas: readonly string[];
  acabadosPedidos?: readonly string[];
};

// Pesos calibrados a mano sobre el catálogo real (§3, Etapa 3a) — el eval de
// franjas (rag:eval-presupuesto) es lo que debe ajustar estos números con
// datos, no una intuición sin medir. Documentado aquí para que el próximo
// ajuste tenga un punto de partida explícito en vez de empezar de cero.
const PESO_RANK = 1.0;
const PESO_AJUSTE_PRECIO = 0.5;
const PESO_COLOR = 0.35;
const PESO_OCASION = 0.2;
const PESO_COMPLETITUD = 0.15;
const PESO_INVENTARIO_SANO = 0.1;

function normalizarRank(rankRrf: number, posicion: number): number {
  // El match exacto de SKU llega como Infinity: se corta a un techo alto
  // pero finito para que siga sumando en el mismo score lineal que el resto.
  if (!Number.isFinite(rankRrf)) return 1;
  // La magnitud de RRF no es comparable entre consultas (types.ts lo deja
  // dicho); lo único estable es la POSICIÓN dentro del pool de este rol.
  return 1 / (1 + posicion);
}

/** Premia usar bien la banda de precio del rol, castiga quedarse muy por
 * debajo del tope (fondo de gama) sin llegar a excederlo — excederlo ya lo
 * descartó el retrieval por rol (banda a nivel de variante). */
function ajustePrecio(precio: number, topeCop: number): number {
  if (topeCop <= 0) return 0;
  const uso = precio / topeCop;
  if (uso > 1) return 0; // no debería pasar (ya filtrado), defensivo
  // Pico en uso≈0.7 del tope del rol: ni la pieza más barata (que suele ser
  // la de peor calidad visual) ni al límite exacto (deja cero margen para
  // que el ensamblaje repare sin salirse del techo de la franja).
  return 1 - Math.abs(uso - 0.7) / 0.7;
}

function completitud(c: CandidatoDetallado): number {
  let puntos = 0;
  if (c.imagen) puntos += 0.6;
  if (c.categoria) puntos += 0.2;
  if (c.colores.length > 0) puntos += 0.2;
  return puntos;
}

/** Evita paquetes chuecos (ej. 3 paquetes de 50 para un centro de mesa
 * chico) usando el inventario como proxy de "sí es una unidad vendible
 * normal" cuando el dato existe — no penaliza cuando no hay dato. */
function inventarioSano(c: CandidatoDetallado): number {
  if (c.inventario == null) return 0.5;
  return c.inventario > 0 ? 1 : 0;
}

export function puntuarYOrdenar(candidatos: CandidatoDetallado[], contexto: ContextoRerank): CandidatoPuntuado[] {
  // La posición en el pool ya viene ordenada por RRF (retrieval híbrido) —
  // se usa el índice, no `rankRrf` crudo, por la razón de la nota arriba.
  const puntuados = candidatos.map((c, posicion) => {
    const porque: string[] = [];
    let score = PESO_RANK * normalizarRank(c.rankRrf, posicion);

    const sPrecio = ajustePrecio(c.precio, contexto.topeCop);
    score += PESO_AJUSTE_PRECIO * sPrecio;
    if (c.precio <= contexto.topeCop * 0.85) porque.push("usa bien el presupuesto de su rol");

    if (contexto.coloresPedidos.length) {
      const coincide = c.colores.some((col) => contexto.coloresPedidos.includes(col));
      if (coincide) {
        score += PESO_COLOR;
        porque.push("coincide con el color pedido");
      }
    }

    if (contexto.ocasionesPedidas.length) {
      const coincide = c.ocasiones.some((oc) => contexto.ocasionesPedidas.includes(oc));
      if (coincide) {
        score += PESO_OCASION;
        porque.push("coincide con la ocasión pedida");
      }
    }

    if (contexto.acabadosPedidos?.length && c.acabados.some((acabado) => contexto.acabadosPedidos!.includes(acabado))) {
      score += 0.25;
      porque.push("coincide con el acabado pedido");
    }

    score += PESO_COMPLETITUD * completitud(c);
    if (!c.imagen) porque.push("sin foto en el catálogo — mostrar con cautela");

    score += PESO_INVENTARIO_SANO * inventarioSano(c);

    return { ...c, score, porque };
  });

  return puntuados.sort((a, b) => b.score - a.score);
}
