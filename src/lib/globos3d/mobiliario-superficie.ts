import { puntoAlMundo, puntoALocal, type EscenaArmada, type MarcoPieza, type NodoArmado, type NodoEscena } from "./escena";
import { puntosSolido } from "./escenografia";
import { tapaDeMesa } from "./mobiliario-asientos-mesa";
import { dentroDelContorno, elipse } from "./mobiliario-contornos";
import { mesaDePieza } from "./mobiliario-conjunto";
import { superficieDeMesa } from "./mobiliario-mesas-param";
import type { Vec3 } from "./modulos";
import type { Punto2 } from "./trenza";

/**
 * **La superficie de arriba de una mesa** (REQ-012 y REQ-008): dónde puede apoyarse algo sobre ella, en el mundo. Es LA implementación de
 * la cubierta: la usan quien pone algo sobre una mesa (`poner_sobre`, los centros de mesa del salón, la base de pastel) y quien comprueba
 * que algo no quedó metido en ella. `superficieSuperior(nodo, armada)` da el alto de la tapa, el contorno, el centro útil y el radio de un
 * círculo que cabe entero encima, tanto de las mesas paramétricas (por su contorno real: media luna, U, serpentina…) como de las del
 * catálogo (por su geometría armada: la tapa o el sobremantel, no las sillas del conjunto). `null` si la pieza no es una mesa con tapa o no
 * quedó puesta.
 */

export type SuperficieSuperior = {
  nodoId: string;
  forma: "circulo" | "rectangulo" | "contorno";
  /** El centro útil de la tapa: (x, z) del mundo y su alto (y). */
  centro: Vec3;
  /** El mismo centro en el espacio de la mesa (el marco con que se coloca algo `sobre` ella). */
  local: Vec3;
  /** Alto de la tapa sobre el piso (cm). */
  altoCm: number;
  /** Radio de un círculo que cabe entero en la tapa alrededor de `centro` (cm). */
  radioUtilCm: number;
  /** Tamaño de la caja de la tapa en el marco de la mesa (cm). */
  anchoCm: number;
  fondoCm: number;
  /** Lo angosto de la tapa, lo que limita el tamaño de un centro (cm): el diámetro del círculo útil en una mesa paramétrica, el menor lado en una del catálogo. */
  angostoCm: number;
  /** El contorno de la tapa en el mundo, (x, z). */
  contorno: Punto2[];
  /** La caja de la tapa en el mundo (ejes x, z). */
  topeMundo: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** El marco de la mesa puesta (de ahí salen `local` y la normal de lo que se apoya). */
  marco: MarcoPieza;
  /** La mesa ya trae cosas encima de fábrica (regalos, dulces): no admite un centro sin forzar. */
  deFabricaConCosas: boolean;
};

const REDONDAS_DEL_CATALOGO = /redonda|coctel|hexagonal/;

const aMundo = (marco: MarcoPieza, x: number, y: number, z: number): Vec3 => puntoAlMundo(marco, { x, y, z });
const cajaDe = (contorno: readonly Punto2[]) => ({
  minX: Math.min(...contorno.map((p) => p.x)), maxX: Math.max(...contorno.map((p) => p.x)),
  minZ: Math.min(...contorno.map((p) => p.y)), maxZ: Math.max(...contorno.map((p) => p.y)),
});

/**
 * La tapa de una mesa del catálogo armada: entre los sólidos, los que tienen al menos la mitad del área del mayor (la tapa, el sobremantel;
 * no las sillas) y, de ellos, el más alto. Se mide en el espacio de la mesa para que girarla no cambie sus medidas.
 */
function tapaDelCatalogo(hecho: NodoArmado, marco: MarcoPieza): { cx: number; cz: number; alto: number; ancho: number; fondo: number } | null {
  const piezas = hecho.solidos.filter((s) => !s.oculto).map((s) => {
    const local = puntosSolido(s).map((p) => puntoALocal(marco, p));
    const xs = local.map((p) => p.x), zs = local.map((p) => p.z);
    const caja = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), maxY: Math.max(...local.map((p) => p.y)) };
    return { caja, area: (caja.maxX - caja.minX) * (caja.maxZ - caja.minZ) };
  });
  if (!piezas.length) return null;
  const mayor = Math.max(...piezas.map((p) => p.area));
  const grandes = piezas.filter((p) => p.area >= mayor * 0.5);
  const tope = Math.max(...grandes.map((p) => p.caja.maxY));
  const tapa = grandes.filter((p) => p.caja.maxY >= tope - 0.01).sort((a, b) => b.area - a.area)[0]!.caja;
  return { cx: (tapa.minX + tapa.maxX) / 2, cz: (tapa.minZ + tapa.maxZ) / 2, alto: tope, ancho: tapa.maxX - tapa.minX, fondo: tapa.maxZ - tapa.minZ };
}

/** La superficie de arriba de una mesa puesta en la escena, o null si la pieza no es una mesa con tapa o no quedó puesta. */
export function superficieSuperior(nodo: NodoEscena, armada: EscenaArmada): SuperficieSuperior | null {
  const hecho = armada.porNodo.find((n) => n.id === nodo.id);
  const marco = hecho?.puestas[0]?.marco;
  const tapa = tapaDeMesa(nodo);
  if (!hecho || !marco || hecho.copias === 0 || !tapa || nodo.pieza.tipo !== "escenografia") return null;
  const parametrica = mesaDePieza(nodo.pieza);
  if (parametrica) {
    const s = superficieDeMesa(parametrica);
    const centro = aMundo(marco, s.centro.x, s.altoCm, s.centro.y);
    const contorno = s.contorno.map((p) => { const q = aMundo(marco, p.x, s.altoCm, p.y); return { x: q.x, y: q.z }; });
    return {
      nodoId: nodo.id, forma: parametrica.tipo === "redonda" || parametrica.tipo === "coctel" ? "circulo" : parametrica.tipo === "cuadrada" || parametrica.tipo === "rectangular" ? "rectangulo" : "contorno",
      centro, local: { x: s.centro.x, y: s.altoCm, z: s.centro.y }, altoCm: centro.y, radioUtilCm: s.radioUtilCm, anchoCm: parametrica.anchoCm, fondoCm: parametrica.fondoCm,
      angostoCm: 2 * s.radioUtilCm, contorno, topeMundo: cajaDe(contorno), marco, deFabricaConCosas: false,
    };
  }
  const t = tapaDelCatalogo(hecho, marco);
  if (!t) return null;
  const redonda = REDONDAS_DEL_CATALOGO.test(tapa.id);
  const local: Punto2[] = redonda
    ? elipse(t.ancho / 2, t.fondo / 2, 24).map((p) => ({ x: p.x + t.cx, y: p.y + t.cz }))
    : [{ x: t.cx - t.ancho / 2, y: t.cz - t.fondo / 2 }, { x: t.cx + t.ancho / 2, y: t.cz - t.fondo / 2 }, { x: t.cx + t.ancho / 2, y: t.cz + t.fondo / 2 }, { x: t.cx - t.ancho / 2, y: t.cz + t.fondo / 2 }];
  const contorno = local.map((p) => { const q = aMundo(marco, p.x, t.alto, p.y); return { x: q.x, y: q.z }; });
  const centro = aMundo(marco, t.cx, t.alto, t.cz);
  const angosto = Math.min(t.ancho, t.fondo);
  return {
    nodoId: nodo.id, forma: redonda ? "circulo" : "rectangulo", centro, local: { x: t.cx, y: t.alto, z: t.cz }, altoCm: centro.y, radioUtilCm: Math.round((angosto / 2) * 10) / 10,
    anchoCm: t.ancho, fondoCm: t.fondo, angostoCm: angosto, contorno, topeMundo: cajaDe(contorno), marco, deFabricaConCosas: tapa.deFabricaConCosas,
  };
}

/** ¿Cae el punto (x, z) del mundo sobre la tapa (con `margenCm` de tolerancia)? */
export function puntoEnSuperficie(s: SuperficieSuperior, x: number, z: number, margenCm = 0): boolean {
  return dentroDelContorno(s.contorno, x, z, margenCm);
}
