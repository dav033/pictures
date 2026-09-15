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
 * Una estructura lateral repetida un número PAR de veces se reparte a los dos
 * lados ("dos columnas a los lados", "dos columnas a cada lado"): las
 * instancias impares van a la izquierda y las pares a la derecha, sin importar
 * cuál lateral se declaró. Antes todas las instancias compartían la caja
 * izquierda: el prompt decía "on the left side" y el QA visual marcaba
 * `placement failure EST_02_COLUMNAS#2` cuando la imagen las ponía,
 * correctamente, una a cada lado. Con más de dos repeticiones la caja se
 * partía además en tajadas horizontales de 0,054 de ancho, todas a la
 * izquierda.
 */
export function esParLateral(estructura: EstructuraConUbicacion): boolean {
  return estructura.repeticiones >= 2 && estructura.repeticiones % 2 === 0
    && (estructura.ubicacion === "lateral_izquierdo" || estructura.ubicacion === "lateral_derecho");
}

/**
 * Ubicaciones centradas horizontalmente: su caja cruza x = 0,5, así que dos
 * instancias se leen como un par en espejo y no como "una a la izquierda y
 * otra al centro". `entrada`, `esquina`, `vegetacion` y `pared_lateral` son
 * cajas de un solo lado por definición y no entran aquí.
 */
const UBICACIONES_CENTRADAS = new Set<Ubicacion>(["fondo_pared", "arco_central", "piso_frontal", "mesas_invitados", "zona_central", "recorrido_suelo"]);

/** Ubicación canónica de la instancia `indice` (base 0) de una estructura. */
export function ubicacionDeInstancia(estructura: EstructuraConUbicacion, indice: number): Ubicacion {
  if (!esParLateral(estructura)) return estructura.ubicacion;
  return indice % 2 === 0 ? "lateral_izquierdo" : "lateral_derecho";
}

/** Redondeado a 6 decimales: la geometría entra en el plan_hash y debe ser igual declarando cualquier lateral. */
function espejoHorizontal(layout: UbicacionLayout): UbicacionLayout {
  return { depthLayer: layout.depthLayer, bbox: { ...layout.bbox, x: Number((1 - layout.bbox.x - layout.bbox.width).toFixed(6)) } };
}

function redondear(valor: number): number {
  return Number(valor.toFixed(6));
}

/**
 * Las `cantidad` instancias que le tocan a un mismo lado. Con una sola es la
 * caja del lado tal cual (el caso de dos repeticiones, que no cambia). Con más
 * se separan en profundidad y altura, nunca en tajadas horizontales: dos
 * columnas del mismo lado están una detrás de la otra, no una junto a la otra
 * en un sexto del ancho del salón.
 */
function instanciasDeUnLado(lado: UbicacionLayout, cantidad: number): UbicacionLayout[] {
  if (cantidad <= 1) return [lado];
  const paso = 0.06;
  return Array.from({ length: cantidad }, (_, indice) => ({
    depthLayer: lado.depthLayer + indice,
    bbox: {
      x: lado.bbox.x,
      y: redondear(lado.bbox.y + lado.bbox.height * paso * indice),
      width: lado.bbox.width,
      height: redondear(lado.bbox.height * (1 - paso * indice)),
    },
  }));
}

/** Una caja centrada cruza x = 0,5; una que quedó a un lado (varias estructuras en la misma ubicación) no. */
function cruzaElCentro(layout: UbicacionLayout): boolean {
  return layout.bbox.x < 0.5 && layout.bbox.x + layout.bbox.width > 0.5;
}

/**
 * Dos instancias en espejo alrededor de x = 0,5, cada una con el 46 % del
 * ancho (mismo margen que el reparto entre estructuras). Antes las dos
 * tajadas salían asimétricas: `piso_frontal` daba "left" y "center".
 */
function parEnEspejo(caja: UbicacionLayout): [UbicacionLayout, UbicacionLayout] {
  const izquierda: UbicacionLayout = {
    depthLayer: caja.depthLayer,
    bbox: { ...caja.bbox, width: redondear(caja.bbox.width * 0.46) },
  };
  return [izquierda, espejoHorizontal(izquierda)];
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
        // Se normaliza a la izquierda para que declarar cualquiera de los dos
        // laterales produzca exactamente la misma geometría (entra en el
        // plan_hash). Las impares a la izquierda, las pares a la derecha.
        const izquierda = estructura.ubicacion === "lateral_izquierdo" ? estructuraBox : espejoHorizontal(estructuraBox);
        const porLado = estructura.repeticiones / 2;
        const izquierdas = instanciasDeUnLado(izquierda, porLado);
        const derechas = izquierdas.map(espejoHorizontal);
        for (let instancia = 0; instancia < estructura.repeticiones; instancia += 1) {
          const lado = instancia % 2 === 0 ? izquierdas : derechas;
          resultado[`${estructura.estructura_id}#${instancia + 1}`] = lado[Math.floor(instancia / 2)]!;
        }
        continue;
      }
      if (estructura.repeticiones === 2 && UBICACIONES_CENTRADAS.has(ubicacion) && cruzaElCentro(estructuraBox)) {
        const [izquierda, derecha] = parEnEspejo(estructuraBox);
        resultado[`${estructura.estructura_id}#1`] = izquierda;
        resultado[`${estructura.estructura_id}#2`] = derecha;
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
