import type { EstructuraPlan, EstructuraPlan1_1 } from "./tipos";
import type { Ubicacion } from "./composicion";

export type BBox = { x: number; y: number; width: number; height: number };
export type UbicacionLayout = { bbox: BBox; depthLayer: number };

const LAYOUT: Record<Ubicacion, UbicacionLayout> = {
  fondo_pared: { bbox: { x: 0.06, y: 0.04, width: 0.88, height: 0.8 }, depthLayer: 1 },
  techo: { bbox: { x: 0.1, y: 0.02, width: 0.8, height: 0.22 }, depthLayer: 2 },
  arco_central: { bbox: { x: 0.12, y: 0.08, width: 0.76, height: 0.62 }, depthLayer: 10 },
  sobre_mesa_principal: { bbox: { x: 0.24, y: 0.12, width: 0.52, height: 0.44 }, depthLayer: 12 },
  lateral_izquierdo: { bbox: { x: 0.04, y: 0.28, width: 0.24, height: 0.62 }, depthLayer: 14 },
  lateral_derecho: { bbox: { x: 0.72, y: 0.28, width: 0.24, height: 0.62 }, depthLayer: 14 },
  entrada: { bbox: { x: 0.04, y: 0.12, width: 0.28, height: 0.74 }, depthLayer: 16 },
  piso_frontal: { bbox: { x: 0.18, y: 0.62, width: 0.64, height: 0.3 }, depthLayer: 20 },
  mesas_invitados: { bbox: { x: 0.08, y: 0.68, width: 0.84, height: 0.26 }, depthLayer: 22 },
  zona_central: { bbox: { x: 0.25, y: 0.18, width: 0.5, height: 0.58 }, depthLayer: 10 },
  fachada: { bbox: { x: 0.03, y: 0.08, width: 0.94, height: 0.78 }, depthLayer: 1 },
  pared_lateral: { bbox: { x: 0.02, y: 0.12, width: 0.26, height: 0.7 }, depthLayer: 4 },
  alrededor_mobiliario: { bbox: { x: 0.16, y: 0.34, width: 0.68, height: 0.48 }, depthLayer: 12 },
  vegetacion: { bbox: { x: 0.02, y: 0.14, width: 0.32, height: 0.72 }, depthLayer: 6 },
  techo_multipunto: { bbox: { x: 0.08, y: 0.02, width: 0.84, height: 0.3 }, depthLayer: 2 },
  recorrido_suelo: { bbox: { x: 0.08, y: 0.66, width: 0.84, height: 0.28 }, depthLayer: 20 },
  esquina: { bbox: { x: 0.02, y: 0.14, width: 0.34, height: 0.7 }, depthLayer: 5 },
};

export function bboxDeUbicacion(ubicacion: Ubicacion): UbicacionLayout {
  return { bbox: { ...LAYOUT[ubicacion].bbox }, depthLayer: LAYOUT[ubicacion].depthLayer };
}

type EstructuraConUbicacion = Pick<EstructuraPlan | EstructuraPlan1_1, "ubicacion" | "repeticiones">;

/**
 * Una estructura lateral repetida exactamente dos veces es un par simétrico
 * ("dos columnas a los lados"): la instancia #1 va a la izquierda y la #2 a la
 * derecha, sin importar cuál lateral se declaró. Antes las dos instancias
 * compartían la caja izquierda: el prompt decía "on the left side" y el QA
 * visual marcaba `placement failure EST_02_COLUMNAS#2` cuando la imagen las
 * ponía, correctamente, una a cada lado.
 */
export function esParLateral(estructura: EstructuraConUbicacion): boolean {
  return estructura.repeticiones === 2 && (estructura.ubicacion === "lateral_izquierdo" || estructura.ubicacion === "lateral_derecho");
}

/** Ubicación canónica de la instancia `indice` (base 0) de una estructura. */
export function ubicacionDeInstancia(estructura: EstructuraConUbicacion, indice: number): Ubicacion {
  if (!esParLateral(estructura)) return estructura.ubicacion;
  return indice === 0 ? "lateral_izquierdo" : "lateral_derecho";
}

/** Redondeado a 6 decimales: la geometría entra en el plan_hash y debe ser igual declarando cualquier lateral. */
function espejoHorizontal(layout: UbicacionLayout): UbicacionLayout {
  return { depthLayer: layout.depthLayer, bbox: { ...layout.bbox, x: Number((1 - layout.bbox.x - layout.bbox.width).toFixed(6)) } };
}

export function cajasDeEstructuras(estructuras: Array<EstructuraPlan | EstructuraPlan1_1>): Record<string, UbicacionLayout> {
  const resultado: Record<string, UbicacionLayout> = {};
  const grupos = new Map<Ubicacion, Array<EstructuraPlan | EstructuraPlan1_1>>();
  for (const estructura of estructuras) grupos.set(estructura.ubicacion, [...(grupos.get(estructura.ubicacion) ?? []), estructura]);
  for (const [ubicacion, grupo] of grupos) {
    const base = bboxDeUbicacion(ubicacion);
    const ordenadas = grupo.slice().sort((a, b) => a.estructura_id.localeCompare(b.estructura_id));
    for (const [index, estructura] of ordenadas.entries()) {
      const anchoEstructura = base.bbox.width / ordenadas.length;
      const estructuraBox = ordenadas.length === 1
        ? base
        : { depthLayer: base.depthLayer, bbox: { x: base.bbox.x + anchoEstructura * index, y: base.bbox.y, width: anchoEstructura * 0.92, height: base.bbox.height } };
      resultado[estructura.estructura_id] = estructuraBox;
      if (estructura.repeticiones <= 1) continue;
      if (esParLateral(estructura)) {
        const izquierda = estructura.ubicacion === "lateral_izquierdo" ? estructuraBox : espejoHorizontal(estructuraBox);
        resultado[`${estructura.estructura_id}#1`] = izquierda;
        resultado[`${estructura.estructura_id}#2`] = espejoHorizontal(izquierda);
        continue;
      }
      const anchoInstancia = estructuraBox.bbox.width / estructura.repeticiones;
      for (let instancia = 0; instancia < estructura.repeticiones; instancia += 1) {
        resultado[`${estructura.estructura_id}#${instancia + 1}`] = {
          depthLayer: estructuraBox.depthLayer,
          bbox: {
            x: estructuraBox.bbox.x + anchoInstancia * instancia,
            y: estructuraBox.bbox.y,
            width: anchoInstancia * 0.9,
            height: estructuraBox.bbox.height,
          },
        };
      }
    }
  }
  return resultado;
}
