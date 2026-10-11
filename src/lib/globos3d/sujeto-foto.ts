import { altoDeCatalogo, escalaDeTelones, escalaDelMontaje } from "./escala-del-montaje";
import { entradaDeCatalogo } from "./fondos-escenografia";
import type { LecturaFoto, PiezaLeida } from "./lectura-foto";

/**
 * **El sujeto de la foto** (caso del dueño 2026-10-10, «quince-mesa»): la decoración es el montaje al que apunta la cámara, no lo que
 * está pegado a ella. Una foto tomada desde una mesa de invitados enseña esa mesa abajo, enorme y cortada por el borde; el lector la
 * leía como `mesa_redonda_mantel`, medía con ella la escala (75 cm) y ponía la línea del piso a sus pies: salía una mesa gigante en
 * el centro y la guirnalda del fondo, chica y flotando a media pared.
 *
 * Una mesa de invitados del catálogo (redonda, imperial, con mantel; nunca la de postres, la de regalos ni el carrito, que son del
 * montaje) es del primer plano (el salón, no la decoración) si se cumplen las tres:
 * - su pie está cortado por el borde de abajo de la foto (`BORDE_DE_ABAJO`) y ocupa buena parte de su ancho (`ANCHO_MINIMO`);
 * - todo lo demás de la decoración acaba muy por encima de él (`DECORACION_MAS_ARRIBA`): el montaje está lejos, al fondo (lo que la
 *   foto también corta por abajo, las sillas de invitados, no cuenta como decoración para esto);
 * - se ve al menos `VECES_MAS_CERCA` veces más grande que lo que mide a la escala del montaje (la leída o la de sus telones).
 * Con ella se va lo que el lector anotó encima (la vajilla, las copas, su centro de mesa) y la línea del piso pasa al pie del montaje.
 *
 * `sujetoDeLaFoto` además contrasta la escala leída con los telones del montaje (`escala-del-montaje.ts`): va antes de medir (el modelado
 * de la foto y la medida con las detecciones). El compilador solo quita el primer plano (`sinPrimerPlano`): la escala ya la decidió la
 * medida. Determinista y sin modelo.
 */

/** Un pie más abajo que esto (fracción del alto de la foto) está cortado por el borde de abajo. */
const BORDE_DE_ABAJO = 0.97;
/** El pie de lo más bajo del resto de la decoración queda al menos esto (fracción del alto) por encima del pie de la pieza. */
const DECORACION_MAS_ARRIBA = 0.3;
/** Cuántas veces más grande que su medida de catálogo se ve una pieza del primer plano, a la escala del montaje. */
const VECES_MAS_CERCA = 2;
/** La mesa de invitados del primer plano ocupa al menos esta parte del ancho de la foto. */
const ANCHO_MINIMO = 0.5;
/** Las mesas en que se sientan los invitados (las de postres, la de regalos y el carrito son del montaje). */
const MESAS_DE_INVITADOS: ReadonlySet<string> = new Set([
  "mesa_mantel", "mesa_redonda", "mesa_redonda_mantel", "mesa_imperial", "mesa_imperial_mantel", "mesa_redonda_sillas", "mesa_redonda10_sillas", "mesa_imperial_sillas",
]);
/** Lo que el lector anota encima de la mesa de invitados: se va con ella (salvo que lleve globos). */
const SOBRE_LA_MESA = /\b(?:vajilla|copas?|vasos?|platos?|servilletas?|cubiertos?|centro de mesa)\b/i;
const CON_GLOBOS = /\bglobos?\b/i;

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;

export type SujetoDeFoto = { lectura: LecturaFoto; notas: string[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Lo más bajo (y) que toca una pieza en la foto, o `null` si no tiene sitio (`otro`). */
function pieDe(p: PiezaLeida): number | null {
  switch (p.tipo) {
    case "guirnalda_organica": return Math.max(...p.puntos.map((q) => q.y + q.grosor / 2));
    case "columna_organica": case "columna_clasica": case "ramo_helio": case "fondo": return p.yBase;
    case "racimo_piso": return p.yPie;
    case "globo": return p.y + p.diametro / 2;
    case "corazon": case "decoracion": case "metalizado": case "guirnalda_clasica": return p.y;
    case "otro": return null;
  }
}

/** ¿Una mesa o un asiento del catálogo cortado por el borde de abajo (lo del salón desde donde se toma la foto)? */
function cortadoAbajo(p: PiezaLeida): boolean {
  if (p.tipo !== "fondo" || p.yBase < BORDE_DE_ABAJO) return false;
  const grupo = entradaDeCatalogo(p.id)?.grupo;
  return grupo === "mesa" || grupo === "asiento";
}

/** ¿La pieza es la mesa de invitados del primer plano, entre la cámara y el montaje? (Ver el comentario del módulo.) */
function esDelPrimerPlano(p: Fondo, resto: readonly PiezaLeida[], aspecto: number, escalaMontaje: number): boolean {
  if (!MESAS_DE_INVITADOS.has(p.id) || p.yBase < BORDE_DE_ABAJO || p.ancho / aspecto < ANCHO_MINIMO) return false;
  const pies = resto.filter((q) => !cortadoAbajo(q)).flatMap((q) => { const y = pieDe(q); return y === null ? [] : [y]; });
  if (!pies.length || Math.max(...pies) > p.yBase - DECORACION_MAS_ARRIBA) return false;
  const alto = altoDeCatalogo(p.id);
  return alto !== null && (p.alto * escalaMontaje) / alto >= VECES_MAS_CERCA;
}

/** La línea del piso al pie del montaje: el pie más bajo de lo que se apoya en el piso, o `null` si todo cuelga (la deduce el encuadre). */
function pisoDelMontaje(piezas: readonly PiezaLeida[]): number | null {
  const apoyadas = piezas.filter((p) => !cortadoAbajo(p)).flatMap((p) => {
    if (p.tipo === "fondo") { const e = entradaDeCatalogo(p.id); return e?.lugar === "piso" && e.flotaCm === undefined ? [p.yBase] : []; }
    if (p.tipo === "columna_organica" || p.tipo === "columna_clasica" || p.tipo === "ramo_helio") return [p.yBase];
    if (p.tipo === "racimo_piso") return [p.yPie];
    return p.tipo === "globo" && p.en === "piso" ? [p.y + p.diametro / 2] : [];
  });
  return apoyadas.length ? r3(Math.max(...apoyadas)) : null;
}

/** La lectura sin la mesa de invitados del primer plano (con lo que tenía encima y la línea del piso al pie del montaje), o la misma. */
export function sinPrimerPlano(l: LecturaFoto): SujetoDeFoto {
  const escalaMontaje = Math.max(l.escala.altoImagenCm, escalaDeTelones(l.piezas, l.pisoY) ?? 0);
  const quitadas = l.piezas.filter((p): p is Fondo => p.tipo === "fondo" && esDelPrimerPlano(p, l.piezas.filter((q) => q !== p), l.aspecto, escalaMontaje));
  if (!quitadas.length) return { lectura: l, notas: [] };
  const deLaMesa = l.piezas.filter((p) => p.tipo === "otro" && SOBRE_LA_MESA.test(p.descripcion) && !CON_GLOBOS.test(p.descripcion));
  const piezas = l.piezas.filter((p) => !quitadas.includes(p as Fondo) && !deLaMesa.includes(p));
  const notas = quitadas.map((p) => `«${entradaDeCatalogo(p.id)?.nombre ?? p.id}» está en el primer plano, cortada por el borde de abajo y mucho más cerca de la cámara que la decoración: es el salón desde donde se tomó la foto (la mesa de invitados), no parte de la decoración. No se armó.`);
  for (const p of deLaMesa) if (p.tipo === "otro") notas.push(`«${p.descripcion}» está sobre la mesa de invitados del primer plano: no es decoración y no se armó.`);
  const piso = pisoDelMontaje(piezas);
  const pisoY = l.pisoY === null || piso === null ? null : Math.min(l.pisoY, piso);
  if (pisoY !== l.pisoY) notas.push(`La línea del piso leída (${l.pisoY}) era la del primer plano: pasa al pie de la decoración (${pisoY ?? "deducida del encuadre"}).`);
  return { lectura: { ...l, pisoY, piezas }, notas };
}

/** La lectura del montaje: sin el primer plano, con su piso y con una escala que cuadra con sus telones. Antes de medir. */
export function sujetoDeLaFoto(l: LecturaFoto): SujetoDeFoto {
  const sujeto = sinPrimerPlano(l);
  const escala = escalaDelMontaje(sujeto.lectura);
  return { lectura: escala.lectura, notas: [...sujeto.notas, ...escala.notas] };
}
