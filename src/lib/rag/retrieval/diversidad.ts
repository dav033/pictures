import type { CandidatoPuntuado } from "./rerank";

// Palabras que no distinguen una familia de producto de otra (color, forma,
// unidades) — sin filtrarlas, "Globo Redondo Dorado" y "Globo Redondo Rojo"
// compartirían muy pocos tokens realmente informativos y no se agruparían
// como la misma familia, que es justo el caso que hay que agrupar.
const RUIDO_FAMILIA = new Set([
  "globo", "globos", "de", "la", "el", "los", "las", "y", "con", "para", "un", "una",
  "dorado", "plateado", "rojo", "azul", "rosado", "verde", "blanco", "negro", "morado",
  "naranja", "amarillo", "fucsia", "transparente", "multicolor", "surtido",
  "redondo", "redondos", "corazon", "modelar", "metalizado", "plano",
]);

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Tokens significativos de un título — la "familia" es este conjunto, no
 * el título completo (que casi siempre difiere sólo en el color). */
function tokensFamilia(titulo: string): Set<string> {
  const tokens = sinTildes(titulo.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !RUIDO_FAMILIA.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let interseccion = 0;
  for (const t of a) if (b.has(t)) interseccion++;
  const union = a.size + b.size - interseccion;
  return union === 0 ? 0 : interseccion / union;
}

const UMBRAL_MISMA_FAMILIA = 0.6;

/**
 * Reordena por score pero degrada la posición de piezas que son la misma
 * familia que otra YA promovida más arriba (§3, Etapa 3b) — versión barata
 * de MMR: no necesita la matriz de similitud de embeddings, alcanza con
 * comparar tokens de título, y en este catálogo (títulos casi idénticos
 * salvo el color) es la señal que de verdad importa.
 *
 * No elimina nada del pool — sólo reordena. El pool completo sigue
 * disponible para que el LLM ofrezca una alternativa si el cliente pide
 * cambiar una pieza ya elegida.
 */
export function ordenarConDiversidad<T extends CandidatoPuntuado>(candidatos: T[]): T[] {
  const pendientes = [...candidatos];
  const promovidos: T[] = [];
  const familiasPromovidas: Set<string>[] = [];

  while (pendientes.length > 0) {
    let mejorIdx = 0;
    let mejorScoreAjustado = -Infinity;
    for (let i = 0; i < pendientes.length; i++) {
      const candidato = pendientes[i];
      const familia = tokensFamilia(candidato.titulo);
      const yaHayFamiliaParecida = familiasPromovidas.some((f) => jaccard(f, familia) >= UMBRAL_MISMA_FAMILIA);
      const scoreAjustado = candidato.score - (yaHayFamiliaParecida ? 10 : 0); // empuja al fondo, no elimina
      if (scoreAjustado > mejorScoreAjustado) {
        mejorScoreAjustado = scoreAjustado;
        mejorIdx = i;
      }
    }
    const [elegido] = pendientes.splice(mejorIdx, 1);
    promovidos.push(elegido);
    familiasPromovidas.push(tokensFamilia(elegido.titulo));
  }

  return promovidos;
}

/** `true` si `candidato` es de la misma familia que alguno de `yaElegidos` —
 * usado en el ensamblaje (§3, Etapa 4) para no repetir familia ENTRE roles
 * distintos (ej. la misma banderola no debería colarse como soporte y como
 * acento en la misma canasta). */
export function esMismaFamiliaQueAlguno(tituloCandidato: string, yaElegidos: readonly string[]): boolean {
  const familia = tokensFamilia(tituloCandidato);
  return yaElegidos.some((t) => jaccard(familia, tokensFamilia(t)) >= UMBRAL_MISMA_FAMILIA);
}
