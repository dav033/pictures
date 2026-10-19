import type { LecturaFoto, PiezaLeida } from "./lectura-foto";

/**
 * **El montón de piso al pie de una guirnalda es parte de ella** (`compilar-lectura.ts`): cuando el lector pone el racimo del
 * piso como pieza aparte, su recuadro casi nunca cae justo bajo el último punto de la guirnalda (queda corrido o con un hueco), y
 * armado así el pie parece una mancha suelta. Si el montón está bajo el extremo de abajo de la guirnalda (el pie de su columna) a
 * menos de `HUECO_MAXIMO` del borde de abajo del cuerpo y sus anchos se cruzan, su arriba se sube hasta ese borde: sin hueco. No se corre de lado: centrarlo bajo la columna empeoraba la medida contra los globos detectados (REQ-001). Pura.
 */

/** El hueco entre el borde de abajo del cuerpo y el arriba del montón que aún se cierra (alto de la foto). */
const HUECO_MAXIMO = 0.04;
/** Un extremo es el pie de la columna si está a menos de esto (alto de la foto) del punto más bajo de la guirnalda. */
const PIE_MAS_BAJO = 0.03;

type Guirnalda = Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
type Monton = Extract<PiezaLeida, { tipo: "racimo_piso" }>;

/** El extremo de la guirnalda (primero o último punto) bajo el que cae el montón, si lo toca; el más cercano. */
function extremoQueToca(m: Monton, guirnaldas: readonly Guirnalda[], aspecto: number): Guirnalda["puntos"][number] | null {
  let mejor: Guirnalda["puntos"][number] | null = null, mejorD = Infinity;
  for (const g of guirnaldas) {
    const masBajo = Math.max(...g.puntos.map((q) => q.y));
    for (const e of [g.puntos[0], g.puntos[g.puntos.length - 1]]) {
      // Solo el pie de una columna: el extremo más bajo de la guirnalda (un racimo colgado de la punta de arriba de un arco no es su pie).
      if (!e || e.y < masBajo - PIE_MAS_BAJO) continue;
      const abajo = e.y + e.grosor / 2;
      const hueco = m.yArriba - abajo;
      const dx = Math.abs(e.x - m.x) * aspecto;
      if (hueco > HUECO_MAXIMO || hueco < 0 || e.y >= m.yPie || dx > (e.grosor + m.ancho) / 2) continue;
      const d = Math.hypot(dx, Math.max(0, hueco));
      if (d < mejorD) { mejorD = d; mejor = e; }
    }
  }
  return mejor;
}

/** La lectura con el hueco entre cada montón de piso y el pie de la guirnalda que toca cerrado (el arriba del montón sube hasta el borde de abajo del cuerpo); nota lo que movió. */
export function montonesAlPie(l: LecturaFoto, notas: string[]): LecturaFoto {
  const guirnaldas = l.piezas.filter((p): p is Guirnalda => p.tipo === "guirnalda_organica");
  if (!guirnaldas.length) return l;
  let cambio = false;
  const piezas = l.piezas.map((p, i) => {
    if (p.tipo !== "racimo_piso") return p;
    const e = extremoQueToca(p, guirnaldas, l.aspecto);
    if (!e) return p;
    const yArriba = Math.round((e.y + e.grosor / 2) * 1000) / 1000;
    if (yArriba >= p.yArriba) return p;
    cambio = true;
    notas.push(`Pieza ${i + 1} (racimo_piso): queda a ${Math.round((p.yArriba - yArriba) * 1000) / 1000} del pie de una guirnalda; sube hasta su borde de abajo (arriba ${p.yArriba} → ${yArriba}) para que sea parte de ella.`);
    return { ...p, yArriba };
  });
  return cambio ? { ...l, piezas } : l;
}
