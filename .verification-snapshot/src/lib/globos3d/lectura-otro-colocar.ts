import { armarEscena, type Colocacion, type Escena } from "./escena";
import { esTelon } from "./fondos-escenografia";
import { colocacionPorDefecto } from "./mobiliario-colocar";
import { retiroDe, type FondoCatalogo } from "./mobiliario-tipos";
import type { PistaOtro } from "./lectura-otro";

/**
 * Dónde cae una pieza del catálogo que el lector escribió como `otro` (sin posición en la foto): del lado que nombra («a la izquierda»,
 * «a la derecha»), a la profundidad que dice («al fondo», «delante») y nunca delante ni encima de la estructura: solo en un hueco de
 * ancho libre de todo lo que ya está y llega a la altura de la pieza (una guirnalda colgada arriba no estorba a una mesa debajo).
 * Sin lado, el hueco más cercano al centro. Si el hueco queda fuera de la sala, la sala se ensancha.
 * - Las otras piezas «otro» ya puestas no son estructura: se esquivan en planta (ancho y fondo), y la nueva puede ir en una fila más
 *   cerca de la cámara en vez de apartarse más.
 * - Un telón ancho (pared de lentejuelas, marco, biombo) va pegado a la pared por detrás de todo, y lo plano (un tapete) se tiende en
 *   su sitio de siempre: ninguno esquiva, solo toman el lado.
 * - Con `xFotoCm` (la mesa bajo un pastel que la foto sí sitúa) se queda en esa x: la foto dice que ahí hay algo sobre ella.
 */
export type MedidasDePieza = { anchoCm: number; fondoCm: number; altoCm: number };
export type LugarOtro = Pick<PistaOtro, "lado" | "profundidad"> & { xFotoCm?: number };

/** Cuánto se corre de lado cada intento (cm), el aire que se deja a lo que ya está y lo que sobra de sala a cada lado de la pieza. */
const PASO_CM = 15, AIRE_CM = 10, MARGEN_SALA_CM = 30;
/** Un «delante» va esto (cm) más cerca de la cámara que el sitio de siempre de la pieza. */
const DELANTE_CM = 100;
/** Lo que alto no pasa de esto (cm) es plano (un tapete); un telón ancho mide al menos esto (cm); y las filas hacia la cámara que se prueban antes de apartarse. */
const PLANO_CM = 5, TELON_ANCHO_CM = 100, FILAS = 3;

export function colocarOtro(escena: Escena, entrada: FondoCatalogo, medidas: MedidasDePieza, lugar: LugarOtro, otrosPuestos: ReadonlySet<string>): { escena: Escena; colocacion: Colocacion; aviso?: string } {
  const { anchoCm: ancho, fondoCm: fondo, altoCm: alto } = medidas;
  const sala = escena.sala;
  const muro = -sala.fondoCm / 2;
  const dentroDeLaSala = (x: number) => { const tope = Math.max(0, sala.anchoCm / 2 - ancho / 2); return Math.round(Math.max(-tope, Math.min(tope, x))); };

  // Lo que cuelga de la pared, flota o va sobre una mesa no ocupa el piso: el sitio de siempre (la pared, además, aprende el lado).
  if (entrada.lugar === "pared" || entrada.flotaCm !== undefined || (entrada.clase === "mueble" && entrada.sobreMesa)) {
    const sitio = colocacionPorDefecto(escena, entrada, medidas);
    if (sitio.colocacion.en !== "pared") return { escena, ...sitio };
    return { escena, colocacion: { ...sitio.colocacion, aLoLargoCm: dentroDeLaSala(lugar.lado * Math.max(0, sala.anchoCm / 2 - ancho / 2 - MARGEN_SALA_CM)) } };
  }

  const zSiempre = muro + retiroDe(entrada);
  const z0 = lugar.profundidad === "fondo" ? muro + fondo / 2 + 5 : lugar.profundidad === "delante" ? zSiempre + DELANTE_CM : zSiempre;
  const zEnLaSala = (z: number) => Math.round(Math.min(sala.fondoCm / 2 - fondo / 2, Math.max(muro + fondo / 2, z)));

  const telonAncho = esTelon(entrada.id) && ancho >= TELON_ANCHO_CM;
  if (telonAncho || alto <= PLANO_CM) {
    const z = telonAncho ? muro + fondo / 2 + 2 : z0;
    return { escena, colocacion: { en: "piso", xCm: dentroDeLaSala(lugar.lado * (ancho / 2)), zCm: zEnLaSala(z), giroGrados: 0 } };
  }
  if (lugar.xFotoCm !== undefined) return ponerEn(escena, entrada, ancho, dentroDeLaSala(lugar.xFotoCm), zEnLaSala(z0));

  const armada = armarEscena(escena);
  const ocupado = armada.porNodo.filter((n) => n.copias > 0).map((n) => ({ caja: n.caja, otro: otrosPuestos.has(n.id) }));
  const choca = (x: number, z: number) => ocupado.some(({ caja: c, otro }) =>
    x + ancho / 2 + AIRE_CM > c.min.x && x - ancho / 2 - AIRE_CM < c.max.x && c.max.y > 0 && c.min.y < alto
    && (!otro || (z + fondo / 2 + AIRE_CM > c.min.z && z - fondo / 2 - AIRE_CM < c.max.z)));
  const filas = Array.from({ length: FILAS }, (_, k) => zEnLaSala(z0 + k * (fondo + 2 * AIRE_CM))).filter((z, k, todas) => todas.indexOf(z) === k);
  const alcance = Math.max(sala.anchoCm, ...ocupado.map(({ caja: c }) => Math.max(Math.abs(c.min.x), Math.abs(c.max.x)))) + ancho + 2 * PASO_CM;
  for (let paso = 0; paso <= alcance; paso += PASO_CM) {
    const candidatos = lugar.lado === 0 ? (paso === 0 ? [0] : [paso, -paso]) : [lugar.lado * (ancho / 2 + AIRE_CM + paso)];
    for (const x of candidatos) {
      const z = filas.find((fila) => !choca(x, fila));
      if (z !== undefined) return ponerEn(escena, entrada, ancho, Math.round(x), z);
    }
  }
  return ponerEn(escena, entrada, ancho, dentroDeLaSala(lugar.lado * alcance), zEnLaSala(z0));
}

/** La colocación en el piso en esa x y esa z, con la sala ensanchada si la pieza no cabe. */
function ponerEn(escena: Escena, entrada: FondoCatalogo, ancho: number, x: number, z: number): { escena: Escena; colocacion: Colocacion; aviso?: string } {
  const necesario = Math.ceil(2 * (Math.abs(x) + ancho / 2 + MARGEN_SALA_CM));
  const ensanchada = necesario > escena.sala.anchoCm;
  return {
    escena: ensanchada ? { ...escena, sala: { ...escena.sala, anchoCm: necesario } } : escena,
    colocacion: { en: "piso", xCm: x, zCm: z, giroGrados: 0 },
    ...(ensanchada ? { aviso: `«${entrada.nombre}» no cabe a su lado sin tapar la estructura: la sala se ensanchó a ${necesario} cm.` } : {}),
  };
}
